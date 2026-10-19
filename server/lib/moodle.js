// Moodle integration (BGU): pulls new lecture presentations from the student's courses into the site.
// Uses the Moodle mobile web-service API — the same access the official Moodle app has.
// Only the web-service token is stored (data/moodle.json); the password is used once to obtain it.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, listCourses, getCourse, listLectures, patchCourse, getLecture, lectureDir, patchLecture } from './store.js';
import { addLectureFile, enqueue, numberFromName, detectKind, ACCEPTED } from './ingest.js';

const SITE = process.env.MOODLE_URL || 'https://moodle.bgu.ac.il/moodle';
const STATE_FILE = path.join(DATA_DIR, 'moodle.json');
const SERVICE = 'moodle_mobile_app';

// Which files in a course page become site items, and of which type.
const LECTURE_HINT = /הרצא|שיעור(?!י בית)|יחידה|מצגת|שקפים|lecture|slides?|presentation|week|שבוע|chapter|פרק/i;
const EXCLUDE = /מבחן|מבחנים|בוחן|סילבוס|syllabus|\bexam|quiz|דף נוסחאות|formula sheet|ציונים|grades|נהלי|לוח זמנים/i;

/** 'lecture' | 'tutorial' | 'homework' | null (not imported automatically). */
function classify(filename, moduleName, sectionName) {
  const own = `${moduleName || ''} ${filename}`;
  if (EXCLUDE.test(own)) return null;
  const ownKind = detectKind(own);
  if (ownKind !== 'lecture') return ownKind;
  const secKind = detectKind(sectionName || '');
  const isDeck = /\.pptx?$/i.test(filename);
  // Section titles are broad ("מצגת וחוברת תרגילים"), so they only decide when the file itself says nothing.
  if (isDeck) return secKind === 'tutorial' && !LECTURE_HINT.test(sectionName || '') ? 'tutorial' : 'lecture';
  if (LECTURE_HINT.test(own)) return 'lecture';
  if (secKind !== 'lecture') return secKind;
  return LECTURE_HINT.test(sectionName || '') ? 'lecture' : null;
}

let state = load();
let syncing = false;
let timer = null;

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { token: null, courses: [], map: {}, files: {}, autoSync: true, intervalMin: 30, lastSync: null, lastResult: null };
  }
}

async function save() {
  const tmp = `${STATE_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, STATE_FILE);
}

// ---------- HTTP ----------
async function rest(wsfunction, params = {}) {
  const body = new URLSearchParams({ wstoken: state.token, wsfunction, moodlewsrestformat: 'json' });
  const flat = (prefix, v) => {
    if (Array.isArray(v)) v.forEach((x, i) => flat(`${prefix}[${i}]`, x));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => flat(`${prefix}[${k}]`, x));
    else body.append(prefix, String(v));
  };
  Object.entries(params).forEach(([k, v]) => flat(k, v));
  const res = await fetch(`${SITE}/webservice/rest/server.php`, { method: 'POST', body, signal: AbortSignal.timeout(60000) });
  const data = await res.json();
  if (data && data.exception) {
    const err = new Error(data.message || data.errorcode);
    err.code = data.errorcode;
    throw err;
  }
  return data;
}

async function getToken(username, password) {
  const body = new URLSearchParams({ username, password, service: SERVICE });
  const res = await fetch(`${SITE}/login/token.php`, { method: 'POST', body, signal: AbortSignal.timeout(30000) });
  const data = await res.json();
  if (!data.token) throw new Error(data.error || 'ההתחברות נכשלה');
  return data.token;
}

// ---------- course matching ----------
const digits = (s) => String(s || '').replace(/\D/g, '');

function guessSiteCourse(mc) {
  const text = `${mc.shortname} ${mc.fullname} ${mc.idnumber || ''}`;
  const textDigits = digits(text);
  let best = null;
  for (const c of listCourses()) {
    let score = 0;
    const code = digits(c.code);
    if (code && textDigits.includes(code)) score += 100;
    // BGU course numbers sometimes appear without the middle digit group (e.g. 1423141).
    if (code.length === 8 && textDigits.includes(code.slice(0, 3) + code.slice(4))) score += 60;
    if (text.includes(c.name)) score += 40;
    if (text.includes(c.short)) score += 25;
    if (c.id === 'phys' && /פיזיק|פיסיק|physics/i.test(text)) score += 30;
    if (c.id === 'calc' && /חדו"?א|חשבון דיפרנציאלי|calculus/i.test(text)) score += 30;
    if (score > (best?.score || 0)) best = { id: c.id, score };
  }
  return best && best.score >= 25 ? best.id : null;
}

// ---------- public API ----------
export function moodleStatus() {
  return {
    connected: !!state.token,
    site: SITE,
    user: state.user || null,
    courses: state.courses.map((c) => ({ ...c, siteCourse: state.map[c.id] || null })),
    autoSync: state.autoSync,
    intervalMin: state.intervalMin,
    lastSync: state.lastSync,
    lastResult: state.lastResult,
    syncing,
  };
}

export async function connect({ username, password, token }) {
  state.token = token ? token.trim() : await getToken(username.trim(), password);
  try {
    const info = await rest('core_webservice_get_site_info');
    state.user = { id: info.userid, fullname: info.fullname, username: info.username };
  } catch (e) {
    state.token = null;
    throw new Error(e.code === 'invalidtoken' ? 'המפתח לא תקין' : e.message);
  }
  await refreshCourses();
  await save();
  schedule();
  // First sync in the background so the UI returns immediately.
  sync().catch((e) => console.error('[moodle] first sync failed:', e.message));
  return moodleStatus();
}

export async function disconnect() {
  state = { ...load(), token: null, user: null };
  await save();
  clearInterval(timer);
  return moodleStatus();
}

export async function refreshCourses() {
  const list = await rest('core_enrol_get_users_courses', { userid: state.user.id });
  const now = Date.now() / 1000;
  state.courses = list
    .map((c) => ({
      id: c.id,
      shortname: c.shortname,
      fullname: c.fullname,
      idnumber: c.idnumber || '',
      current: !c.enddate || c.enddate > now - 60 * 86400,
      lastaccess: c.lastaccess || 0,
    }))
    .sort((a, b) => b.current - a.current || b.lastaccess - a.lastaccess);
  // Auto-map courses that clearly match a site course; never overwrite a manual choice.
  for (const mc of state.courses) {
    if (state.map[mc.id] !== undefined) continue;
    const guess = mc.current ? guessSiteCourse(mc) : null;
    if (guess && !Object.values(state.map).includes(guess)) {
      state.map[mc.id] = guess;
      await fillCourseDetails(guess, mc);
    }
  }
}

// A course added without a code (e.g. physics) takes its name and number from Moodle.
async function fillCourseDetails(siteId, mc) {
  const c = getCourse(siteId);
  if (!c || c.code) return;
  // BGU short names start with the 8-digit course number (e.g. 500500060120271 → 500-5-0006).
  const m = mc.shortname.match(/^(\d{3})(\d)(\d{4})/);
  const code = m ? `${m[1]}-${m[2]}-${m[3]}` : mc.shortname;
  const name = mc.fullname
    .replace(/\s*\(.*?\)\s*$/, '')
    .replace(/\s+(קב|סמ|קבוצה|סמסטר)\s*\d+.*$/, '')
    .replace(/\s+-\s+/g, ' – ')
    .trim();
  await patchCourse(siteId, { code, name: name || c.name });
}

export async function mapCourse(moodleId, siteId) {
  state.map[moodleId] = siteId || null;
  const mc = state.courses.find((c) => c.id === Number(moodleId));
  if (siteId && mc) await fillCourseDetails(siteId, mc);
  await save();
  return moodleStatus();
}

export async function setOptions({ autoSync, intervalMin }) {
  if (autoSync !== undefined) state.autoSync = !!autoSync;
  if (intervalMin) state.intervalMin = Math.max(10, Math.min(24 * 60, Number(intervalMin)));
  await save();
  schedule();
  return moodleStatus();
}

/** All presentation files in a mapped course, with their sync status. */
export async function courseFiles(moodleId) {
  const sections = await rest('core_course_get_contents', { courseid: moodleId });
  const out = [];
  for (const sec of sections) {
    for (const mod of sec.modules || []) {
      if (!['resource', 'folder'].includes(mod.modname)) continue;
      for (const f of mod.contents || []) {
        if (f.type !== 'file' || !ACCEPTED.includes(path.extname(f.filename).toLowerCase())) continue;
        const key = `${moodleId}:${mod.id}:${f.filepath || '/'}${f.filename}`;
        const kind = classify(f.filename, mod.name, sec.name);
        out.push({
          key,
          filename: f.filename,
          section: sec.name,
          module: mod.name,
          fileurl: f.fileurl,
          size: f.filesize,
          timemodified: f.timemodified || mod.timemodified || 0,
          kind,
          record: state.files[key] || null,
        });
      }
    }
  }
  return out;
}

// "שבוע 3", "הרצאה 3", "lecture 3" in a section name → 3 (dates like 26/10 are ignored).
const sectionNumber = (name = '') => {
  const m = name.match(/(?:הרצאה|שיעור|שבוע|יחידה|lecture|lesson|week|unit)\s*[-–:]?\s*0*(\d{1,2})\b/i);
  return m ? Number(m[1]) : 0;
};

async function download(file) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moodle-'));
  const dest = path.join(dir, file.filename.replace(/[/\\]/g, '_'));
  const url = `${file.fileurl}${file.fileurl.includes('?') ? '&' : '?'}token=${encodeURIComponent(state.token)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`הורדה נכשלה (${res.status})`);
  await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function importFile(file, siteCourseId, moodleId) {
  const existingKey = state.files[file.key];
  // A newer version of a file we already imported: replace the deck and regenerate the study material.
  if (existingKey?.lectureId && getLecture(existingKey.lectureId)) {
    const meta = getLecture(existingKey.lectureId);
    const tmp = await download(file);
    await fsp.copyFile(tmp, path.join(lectureDir(meta.id), meta.originalFile));
    await fsp.rm(path.dirname(tmp), { recursive: true, force: true });
    await fsp.rm(path.join(lectureDir(meta.id), 'slides'), { recursive: true, force: true });
    await patchLecture(meta.id, { status: 'processing', stage: 'queued' });
    enqueue(meta.id, { regenerate: true });
    state.files[file.key] = { ...existingKey, timemodified: file.timemodified, updatedAt: Date.now() };
    return 'updated';
  }
  const tmp = await download(file);
  const meta = await addLectureFile({
    filePath: tmp,
    originalName: file.filename,
    courseId: siteCourseId,
    lessonNumber: numberFromName(file.filename) ? undefined : sectionNumber(file.section) || sectionNumber(file.module) || undefined,
    move: true,
    kind: file.kind || undefined,
    source: { type: 'moodle', courseId: moodleId, section: file.section, module: file.module },
  });
  await fsp.rm(path.dirname(tmp), { recursive: true, force: true });
  state.files[file.key] = { status: 'imported', lectureId: meta.id, timemodified: file.timemodified, at: Date.now() };
  return 'imported';
}

/** Import (or re-import) one specific file chosen by the user. */
export async function importOne(moodleId, key) {
  const siteCourseId = state.map[moodleId];
  if (!siteCourseId) throw new Error('הקורס לא משויך לקורס באתר');
  const file = (await courseFiles(moodleId)).find((f) => f.key === key);
  if (!file) throw new Error('הקובץ לא נמצא במודל');
  if (state.files[key]?.status === 'ignored') delete state.files[key];
  const r = await importFile(file, siteCourseId, Number(moodleId));
  await save();
  return r;
}

export async function ignoreOne(key) {
  state.files[key] = { ...(state.files[key] || {}), status: 'ignored', at: Date.now() };
  await save();
}

const nfc = (s) => s.normalize('NFC').trim();

export async function sync() {
  if (!state.token || syncing) return state.lastResult;
  syncing = true;
  const result = { imported: [], updated: [], skipped: 0, errors: [] };
  try {
    await refreshCourses().catch(() => {});
    for (const [mid, siteCourseId] of Object.entries(state.map)) {
      if (!siteCourseId) continue;
      let files;
      try {
        files = await courseFiles(mid);
      } catch (e) {
        result.errors.push(`${mid}: ${e.message}`);
        continue;
      }
      const existingNames = new Set(listLectures(siteCourseId).map((l) => nfc(l.originalName)));
      for (const f of files) {
        let rec = state.files[f.key];
        if (rec?.status === 'ignored') continue;
        // Re-check files previously judged "not a lecture" – the rule may have changed.
        if (rec?.status === 'not-lecture') {
          if (!f.kind) continue;
          delete state.files[f.key];
          rec = undefined;
        }
        if (rec && (rec.timemodified || 0) >= f.timemodified) continue;
        if (!rec && !f.kind) {
          state.files[f.key] = { status: 'not-lecture', timemodified: f.timemodified, at: Date.now() };
          result.skipped++;
          continue;
        }
        // Already uploaded by hand before Moodle was connected – link instead of duplicating.
        if (!rec && existingNames.has(nfc(f.filename))) {
          const lec = listLectures(siteCourseId).find((l) => nfc(l.originalName) === nfc(f.filename));
          state.files[f.key] = { status: 'imported', lectureId: lec.id, timemodified: f.timemodified, at: Date.now(), linked: true };
          continue;
        }
        try {
          const r = await importFile(f, siteCourseId, Number(mid));
          result[r === 'updated' ? 'updated' : 'imported'].push(`${getCourse(siteCourseId)?.short}: ${f.filename}`);
        } catch (e) {
          result.errors.push(`${f.filename}: ${e.message}`);
        }
        await save();
      }
    }
  } catch (e) {
    if (e.code === 'invalidtoken') {
      state.token = null;
      result.errors.push('המפתח של מודל פג תוקף – יש להתחבר מחדש');
    } else result.errors.push(e.message);
  } finally {
    syncing = false;
    state.lastSync = new Date().toISOString();
    state.lastResult = result;
    await save();
  }
  if (result.imported.length || result.updated.length) console.log(`[moodle] imported ${result.imported.length}, updated ${result.updated.length}`);
  return result;
}

export function schedule() {
  clearInterval(timer);
  if (!state.token || !state.autoSync) return;
  timer = setInterval(() => sync().catch((e) => console.error('[moodle]', e.message)), state.intervalMin * 60000);
}

export function startMoodle() {
  if (!state.token) return;
  schedule();
  setTimeout(() => sync().catch((e) => console.error('[moodle]', e.message)), 20000);
}
