// Moodle integration (BGU): pulls new lecture presentations from the student's courses into the site.
// Uses the Moodle mobile web-service API — the same access the official Moodle app has.
// Only the web-service token is stored (data/moodle.json); the password is used once to obtain it.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, listCourses, getCourse, listLectures, patchCourse, getLecture, lectureDir, patchLecture, addCourse, saveLinks } from './store.js';
import { addLectureFile, enqueue, numberFromName, ACCEPTED } from './ingest.js';
import { classify, EXCLUDE } from '../../shared/moodle-kind.js';
import { analyzeNotices } from './notices.js';
import { gradeRows } from '../../shared/grades.js';
import { addAnnouncements, syncDeadlines, announceMaterial, adminAlert, pendingAssignments, setSubmission, linkFileKey } from './updates.js';
import { syncCatalog } from './catalog.js';
import { startRun } from './runlog.js';
import { subjectOk } from './courses.js';

const SITE = process.env.MOODLE_URL || 'https://moodle.bgu.ac.il/moodle';
const STATE_FILE = path.join(DATA_DIR, 'moodle.json');
const SERVICE = 'moodle_mobile_app';
// The cloud site (students sign in there). Courses of other students are read through its admin channel,
// so their Moodle tokens never leave Cloudflare. Both come from .env; without them only this Mac's courses sync.
const CLOUD = (process.env.CLOUD_URL || '').replace(/\/$/, '');
const ADMIN_SECRET = process.env.STUDY_ADMIN_SECRET || '';
const cloudEnabled = () => !!(CLOUD && ADMIN_SECRET.length >= 32);

export function htmlToText(html = '') {
  return html
    .replace(/\r/g, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis, (_, href, text) => {
      const t = text.replace(/<[^>]+>/g, '').trim();
      return t && t !== href ? `${t} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h\d|li|tr|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

async function admin(pathname, init = {}) {
  const res = await fetch(`${CLOUD}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${ADMIN_SECRET}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
    signal: init.signal || AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `שרת הענן החזיר ${res.status}`);
  }
  return res;
}

/** Same signature as rest(), but runs in the cloud with the token of a student enrolled in `moodleId`. */
const remoteRest = (moodleId) => async (wsfunction, params = {}) =>
  (await admin('/api/admin/moodle', { method: 'POST', body: JSON.stringify({ course: Number(moodleId), wsfunction, params }) })).json();

async function getToken(username, password) {
  const body = new URLSearchParams({ username, password, service: SERVICE });
  const res = await fetch(`${SITE}/login/token.php`, { method: 'POST', body, signal: AbortSignal.timeout(30000) });
  const data = await res.json();
  if (!data.token) throw new Error(data.error || 'ההתחברות נכשלה');
  return data.token;
}

// ---------- academic terms ----------
// BGU short names: [dept 3][degree 1][course 4][group 2][year 4][semester 1], e.g. 214197110120271 → 2027, sem 1.
export function termFromShortname(shortname = '') {
  const m = String(shortname).match(/^\d{8}\d{2}(\d{4})(\d)$/);
  return m ? { year: Number(m[1]), semester: Number(m[2]) } : null;
}
const academicYear = (d = new Date()) => (d.getMonth() >= 7 ? d.getFullYear() + 1 : d.getFullYear());
/** This year's (or a later) academic course – not the library course, exam guides or old courses. */
const isCurrentAcademic = (mc) => (termFromShortname(mc.shortname)?.year || 0) >= academicYear();

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

// ---------- "report a mistake" from students on the cloud site ----------
export async function cloudReports() {
  if (!cloudEnabled()) return [];
  return (await admin('/api/admin/reports')).json();
}
export async function resolveCloudReport(id) {
  await admin(`/api/admin/reports/${Number(id)}/resolve`, { method: 'POST' });
}

const isNet = (e) => /fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network|timed out/i.test(String(e));

// ---------- health ----------
/** What needs the owner's attention right now (shown red in the sidebar and on the Moodle page). */
function healthProblems() {
  const problems = [];
  if (!state.token) problems.push('המפתח של המודל פג – צריך להתחבר מחדש');
  const noAi = listLectures().filter((l) => (l.aiError || l.notesError) && l.status === 'ready');
  if (noAi.length) problems.push(`${noAi.length} ${noAi.length === 1 ? 'פריט' : 'פריטים'} בלי סיכום AI – כנראה מגבלת השימוש`);
  const errors = state.lastResult?.errors || [];
  // A dropped connection fails every call at once: not worth a red flag unless the next sync fails the same way.
  if (errors.length && (!errors.every(isNet) || (state.netFails || 0) >= 2)) problems.push(`בסנכרון האחרון היו ${errors.length} שגיאות`);
  return problems;
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
    cloud: cloudEnabled() ? CLOUD : null,
    health: { problems: healthProblems() },
    remote: Object.entries(state.remote || {}).map(([mid, siteId]) => ({ moodleId: Number(mid), siteCourse: siteId, lastSync: state.remoteSynced?.[mid] || null })),
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
  // A new semester: this year's courses that aren't on the site yet are created (with AI material), so the
  // site follows Moodle without setup. A course set to "not mapped" on the Moodle page stays out.
  for (const mc of state.courses) {
    if (state.map[mc.id] !== undefined || !isCurrentAcademic(mc)) continue;
    const existing = state.remote?.[mc.id];
    if (existing) {
      // Built earlier for other students – it's yours now too: turn on AI material.
      await patchCourse(existing, { ai: true, remote: false });
      delete state.remote[mc.id];
      state.map[mc.id] = existing;
    } else {
      const course = await createCourseFromMoodle({ moodleId: mc.id, shortname: mc.shortname, fullname: mc.fullname }, { own: true });
      state.map[mc.id] = course.id;
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
  await linkCourses();
  await save();
  return moodleStatus();
}

/** Your grades in a site course (the same shape the cloud's /api/me/grades/:id returns). */
export async function courseGrades(siteId) {
  if (!state.token) throw new Error('המודל לא מחובר');
  const moodleId = Object.entries(state.map).find(([, v]) => v === siteId)?.[0];
  if (!moodleId) return { courseId: siteId, items: [] };
  const data = await rest('gradereport_user_get_grade_items', { courseid: Number(moodleId), userid: state.user.id });
  const items = gradeRows(data.usergrades?.[0]?.gradeitems, { site: SITE, text: htmlToText });
  return { courseId: siteId, items };
}

export async function setOptions({ autoSync, intervalMin }) {
  if (autoSync !== undefined) state.autoSync = !!autoSync;
  if (intervalMin) state.intervalMin = Math.max(10, Math.min(24 * 60, Number(intervalMin)));
  await save();
  schedule();
  return moodleStatus();
}

/** All presentation files in a mapped course, with their sync status. */
// Course page items that aren't lecture files but belong on the site: Zoom, recordings, external links,
// syllabus and pages. Not class-time activities (attendance checks, polls, in-class questions), and not
// forums, assignments or quizzes (those come in as updates and deadlines).
const LINK_TYPES = { url: 'link', zoom: 'zoom', lti: 'online', page: 'page', folder: 'folder', resource: 'file', book: 'page' };

function courseLinks(sections, importedModules) {
  const links = [];
  for (const sec of sections) {
    for (const mod of sec.modules || []) {
      const type = LINK_TYPES[mod.modname];
      if (!type || mod.visible === 0 || importedModules.has(mod.id)) continue;
      const external = mod.modname === 'url' ? (mod.contents || [])[0]?.fileurl : null;
      const href = external || mod.url || `${SITE}/mod/${mod.modname}/view.php?id=${mod.id}`;
      if (!/^https?:\/\//i.test(href)) continue; // never "javascript:" or other schemes
      const file = mod.modname === 'resource' ? (mod.contents || [])[0]?.filename || '' : '';
      links.push({ id: mod.id, type: /syllabus|סילבוס/i.test(`${mod.name} ${file}`) ? 'syllabus' : type, name: mod.name, href, section: sec.name || '', ext: file ? path.extname(file).slice(1).toLowerCase() : '' });
    }
  }
  return links;
}

export async function courseFiles(moodleId, call = rest) {
  const sections = await call('core_course_get_contents', { courseid: Number(moodleId) });
  const out = [];
  const importedModules = new Set();
  for (const sec of sections) {
    for (const mod of sec.modules || []) {
      if (!['resource', 'folder'].includes(mod.modname)) continue;
      for (const f of mod.contents || []) {
        if (f.type !== 'file' || !ACCEPTED.includes(path.extname(f.filename).toLowerCase())) continue;
        const key = `${moodleId}:${mod.id}:${f.filepath || '/'}${f.filename}`;
        const kind = classify(f.filename, mod.name, sec.name);
        if (kind) importedModules.add(mod.id);
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
  // Exercise sheets are often attached to the assignment itself rather than posted as a file.
  const assigns = await call('mod_assign_get_assignments', { courseids: [Number(moodleId)] }).catch(() => ({ courses: [] }));
  for (const c of assigns.courses || []) {
    for (const a of c.assignments || []) {
      for (const f of a.introattachments || []) {
        if (!ACCEPTED.includes(path.extname(f.filename).toLowerCase())) continue;
        const key = `${moodleId}:assign${a.id}:${f.filepath || '/'}${f.filename}`;
        out.push({
          key,
          filename: f.filename,
          section: '',
          module: a.name,
          fileurl: f.fileurl,
          size: f.filesize,
          timemodified: f.timemodified || a.timemodified || 0,
          // Anything attached to an assignment is homework (unless it's an exam/syllabus).
          kind: EXCLUDE.test(`${a.name} ${f.filename}`) ? null : 'homework',
          note: htmlToText(a.intro).slice(0, 600),
          // What the lecturer asked for (e.g. "exercises 1, 2a–c, 4"), the due date and a link – shown on the item.
          assignment: {
            id: a.id,
            name: a.name,
            dueAt: a.duedate ? new Date(a.duedate * 1000).toISOString() : null,
            url: `${SITE}/mod/assign/view.php?id=${a.cmid}`,
            instructions: htmlToText(a.intro).replace(/\n{2,}/g, '\n').trim().slice(0, 1500),
          },
          record: state.files[key] || null,
        });
      }
    }
  }
  out.links = courseLinks(sections, importedModules);
  return out;
}

// "שבוע 3", "הרצאה 3", "lecture 3" in a section name → 3 (dates like 26/10 are ignored).
const sectionNumber = (name = '') => {
  const m = name.match(/(?:הרצאה|שיעור|שבוע|יחידה|lecture|lesson|week|unit)\s*[-–:]?\s*0*(\d{1,2})\b/i);
  return m ? Number(m[1]) : 0;
};

async function download(file, via = null) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moodle-'));
  const dest = path.join(dir, file.filename.replace(/[/\\]/g, '_'));
  const res = via
    ? await admin(`/api/admin/file?course=${via}&url=${encodeURIComponent(file.fileurl)}`, { signal: AbortSignal.timeout(300000) })
    : await fetch(`${file.fileurl}${file.fileurl.includes('?') ? '&' : '?'}token=${encodeURIComponent(state.token)}`, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`הורדה נכשלה (${res.status})`);
  await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function importFile(file, siteCourseId, moodleId, { via = null, initial = false } = {}) {
  const existingKey = state.files[file.key];
  // A newer version of a file we already imported: replace the deck and regenerate the study material.
  if (existingKey?.lectureId && getLecture(existingKey.lectureId)) {
    const meta = getLecture(existingKey.lectureId);
    const tmp = await download(file, via);
    await fsp.copyFile(tmp, path.join(lectureDir(meta.id), meta.originalFile));
    await fsp.rm(path.dirname(tmp), { recursive: true, force: true });
    await fsp.rm(path.join(lectureDir(meta.id), 'slides'), { recursive: true, force: true });
    await patchLecture(meta.id, { status: 'processing', stage: 'queued' });
    enqueue(meta.id, { regenerate: true });
    await announceMaterial(meta, { updated: true }).catch(() => {});
    state.files[file.key] = { ...existingKey, timemodified: file.timemodified, updatedAt: Date.now() };
    return 'updated';
  }
  const tmp = await download(file, via);
  const meta = await addLectureFile({
    filePath: tmp,
    originalName: file.filename,
    courseId: siteCourseId,
    lessonNumber: numberFromName(file.filename) ? undefined : sectionNumber(file.section) || sectionNumber(file.module) || undefined,
    move: true,
    kind: file.kind || undefined,
    source: {
      type: 'moodle',
      courseId: moodleId,
      // The same key the cloud uses when it spots the file first (cloud/lib/moodle-watch.js), so one upload isn't announced twice.
      fileKey: file.key,
      section: file.section,
      module: file.module,
      timemodified: file.timemodified,
      ...(initial ? { initial: true } : {}),
      ...(file.note ? { note: file.note } : {}),
      ...(file.assignment ? { assignment: file.assignment } : {}),
    },
  });
  await fsp.rm(path.dirname(tmp), { recursive: true, force: true });
  state.files[file.key] = { status: 'imported', lectureId: meta.id, timemodified: file.timemodified, at: Date.now() };
  return 'imported';
}

/** Import (or re-import) one specific file chosen by the user. */
/** The course's syllabus file on its Moodle page (a PDF named "סילבוס"), downloaded – or null. For grading (syllabus.js). */
export async function syllabusFile(siteId) {
  const own = Object.entries(state.map || {}).find(([, v]) => v === siteId)?.[0];
  const remote = Object.entries(state.remote || {}).find(([, v]) => v === siteId)?.[0];
  const moodleId = own || remote;
  if (!moodleId || (own ? !state.token : !cloudEnabled())) return null;
  const via = own ? null : moodleId;
  const call = via ? remoteRest(moodleId) : rest;
  const sections = await call('core_course_get_contents', { courseid: Number(moodleId) });
  for (const sec of sections || []) {
    for (const mod of sec.modules || []) {
      const f = mod.modname === 'resource' ? (mod.contents || [])[0] : null;
      if (f && /syllabus|סילבוס/i.test(`${mod.name} ${f.filename}`) && /\.pdf$/i.test(f.filename)) {
        return { path: await download(f, via), href: `${SITE}/mod/resource/view.php?id=${mod.id}` };
      }
    }
  }
  return null;
}

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

/** Course announcements (news forums) and deadlines (assignments, quizzes) for every mapped course. */
async function syncNews(result) {
  const mapped = Object.entries(state.map).filter(([, v]) => v).map(([k, v]) => [Number(k), v]);
  if (!mapped.length) return;
  const courseids = mapped.map(([m]) => m);
  const siteOf = Object.fromEntries(mapped);

  try {
    const forums = await rest('mod_forum_get_forums_by_courses', { courseids });
    const posts = [];
    for (const f of forums.filter((x) => x.type === 'news')) {
      const d = await rest('mod_forum_get_forum_discussions', { forumid: f.id, sortorder: 1, page: 0, perpage: 25 });
      for (const x of d.discussions || []) {
        posts.push({
          id: x.discussion,
          courseId: siteOf[f.course],
          subject: x.name || x.subject,
          body: htmlToText(x.message),
          author: x.userfullname,
          created: x.created,
          url: `${SITE}/mod/forum/discuss.php?d=${x.discussion}`,
        });
      }
    }
    result.announcements = await addAnnouncements(posts);
  } catch (e) {
    result.errors.push(`הודעות: ${e.message}`);
  }

  try {
    const deadlines = [];
    const assigns = await rest('mod_assign_get_assignments', { courseids });
    for (const c of assigns.courses || []) {
      for (const a of c.assignments || []) {
        if (!a.duedate) continue;
        let status = { submitted: false, draft: false };
        try {
          status = submissionOf(await rest('mod_assign_get_submission_status', { assignid: a.id }));
        } catch { /* status unavailable – treat as not submitted */ }
        deadlines.push({
          moodleKey: `assign:${a.id}`,
          courseId: siteOf[c.id],
          title: a.name,
          dueAt: new Date(a.duedate * 1000).toISOString(),
          url: `${SITE}/mod/assign/view.php?id=${a.cmid}`,
          intro: htmlToText(a.intro).slice(0, 600),
          ...status,
        });
      }
    }
    const quizzes = await rest('mod_quiz_get_quizzes_by_courses', { courseids }).catch(() => ({ quizzes: [] }));
    for (const q of quizzes.quizzes || []) {
      if (!q.timeclose) continue;
      deadlines.push({
        moodleKey: `quiz:${q.id}`,
        courseId: siteOf[q.course],
        title: `בוחן: ${q.name}`,
        dueAt: new Date(q.timeclose * 1000).toISOString(),
        url: `${SITE}/mod/quiz/view.php?id=${q.coursemodule}`,
        intro: htmlToText(q.intro).slice(0, 400),
        submitted: false,
      });
    }
    await syncDeadlines(deadlines);
    result.deadlines = deadlines.length;
  } catch (e) {
    result.errors.push(`דדליינים: ${e.message}`);
  }
}

/** Import new or changed files of one Moodle course into its site course. */
async function syncCourse(mid, siteCourseId, { call = rest, via = null, initial = false }, result) {
  let files;
  try {
    files = await courseFiles(mid, call);
  } catch (e) {
    result.errors.push(`${mid}: ${e.message}`);
    return;
  }
  if (files.links) await saveLinks(siteCourseId, files.links);
  const existingNames = new Set(listLectures(siteCourseId).map((l) => nfc(l.originalName)));
  for (const f of files) {
    let rec = state.files[f.key];
    if (rec?.status === 'ignored') continue;
    // Keep the assignment details of an imported item current (the lecturer may edit the instructions or due date).
    if (f.assignment && rec?.lectureId) {
      const meta = getLecture(rec.lectureId);
      if (meta && JSON.stringify(meta.source?.assignment) !== JSON.stringify(f.assignment)) {
        await patchLecture(meta.id, { source: { ...meta.source, assignment: f.assignment, note: f.note } });
      }
    }
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
      await linkKey(lec.id, f.key);
      continue;
    }
    try {
      const r = await importFile(f, siteCourseId, Number(mid), { via, initial });
      result[r === 'updated' ? 'updated' : 'imported'].push(`${getCourse(siteCourseId)?.short}: ${f.filename}`);
    } catch (e) {
      result.errors.push(`${f.filename}: ${e.message}`);
    }
    await save();
  }
}

/** Records that Moodle file `key` is the same as the lecture's own (kept on the lecture and on its feed item). */
async function linkKey(lectureId, key) {
  const meta = getLecture(lectureId);
  if (!meta || meta.source?.fileKey === key) return;
  const linkedKeys = [...new Set([...(meta.source?.linkedKeys || []), key])];
  if (linkedKeys.length !== (meta.source?.linkedKeys || []).length) await patchLecture(lectureId, { source: { ...meta.source, linkedKeys } });
  await linkFileKey(lectureId, key);
}

// ---------- submission status ----------
/** Moodle's submission status → submitted, or a draft (files uploaded but "submit" not pressed yet). */
export function submissionOf(st) {
  const s = st?.lastattempt?.submission?.status || st?.lastattempt?.teamsubmission?.status;
  return { submitted: s === 'submitted', draft: s === 'draft' };
}

let lastCheck = 0;
/**
 * Quick check of assignments still waiting for a submission – every few minutes, and right away when you come
 * back to the site (so homework you just submitted stops counting down).
 */
export async function checkSubmissions({ minGapMs = 20000 } = {}) {
  if (!state.token || Date.now() - lastCheck < minGapMs) return 0;
  lastCheck = Date.now();
  let changed = 0;
  for (const d of pendingAssignments()) {
    try {
      const st = submissionOf(await rest('mod_assign_get_submission_status', { assignid: Number(d.moodleKey.split(':')[1]) }));
      if (await setSubmission(d.moodleKey, st)) changed++;
    } catch (e) {
      if (e.code === 'invalidtoken') throw e;
    }
  }
  return changed;
}

// ---------- courses of other students (through the cloud) ----------
const PALETTE = ['sky', 'violet', 'rose', 'amber', 'emerald'];

/** Every site course knows which Moodle course(s) it mirrors – the cloud uses this to check enrollment. */
async function linkCourses() {
  const links = {};
  for (const [mid, siteId] of [...Object.entries(state.map), ...Object.entries(state.remote || {})]) {
    if (siteId) (links[siteId] ||= []).push(Number(mid));
  }
  const shortnameOf = (mid) => state.courses.find((c) => c.id === Number(mid))?.shortname || state.remoteInfo?.[mid]?.shortname;
  for (const c of listCourses()) {
    const ids = (links[c.id] || []).sort((a, b) => a - b);
    const patch = {};
    if (JSON.stringify(ids) !== JSON.stringify(c.moodleIds || [])) patch.moodleIds = ids;
    const term = ids.map(shortnameOf).map(termFromShortname).find(Boolean);
    if (term && JSON.stringify(term) !== JSON.stringify(c.term)) patch.term = term;
    if (Object.keys(patch).length) await patchCourse(c.id, patch);
  }
}

/**
 * A site course built from a Moodle course: your own new course (with AI material), or one a signed-in
 * student is enrolled in but this Mac isn't (slides and files only, no AI).
 */
async function createCourseFromMoodle(mc, { own = false } = {}) {
  const m = mc.shortname.match(/^(\d{3})(\d)(\d{4})/);
  const name = mc.fullname
    .replace(/\s*\(.*?\)\s*$/, '')
    .replace(/\s+(קב|סמ|קבוצה|סמסטר)['׳]?\s*\d+.*$/, '')
    .replace(/\s+-\s+.*$/, '')
    .trim() || mc.fullname;
  const id = `m${mc.moodleId}`;
  return addCourse({
    id,
    code: m ? `${m[1]}-${m[2]}-${m[3]}` : '',
    name,
    short: name.length > 22 ? `${name.slice(0, 20).trim()}…` : name,
    color: PALETTE[mc.moodleId % PALETTE.length],
    icon: /אלגברה|מתמטיק|חדו|חשבון|סטטיסט|הסתברות/.test(name) ? 'Sigma' : 'BookOpen',
    staff: [],
    unitLabel: 'הרצאה',
    tagline: '',
    keywords: [],
    ai: own,
    remote: !own,
    moodleIds: [mc.moodleId],
    term: termFromShortname(mc.shortname),
  });
}

async function syncRemote(result) {
  let list;
  try {
    list = await (await admin('/api/admin/courses')).json();
  } catch (e) {
    result.errors.push(`ענן: ${e.message}`);
    return;
  }
  state.remote ||= {};
  state.remoteSynced ||= {};
  result.remote = 0;
  state.remoteInfo ||= {};
  for (const mc of list) {
    if (state.map[mc.moodleId] || (state.remoteIgnore || []).includes(mc.moodleId)) continue;
    if (!subjectOk(mc.fullname, mc.shortname)) continue; // not one of the site's subjects (courses.js)
    state.remoteInfo[mc.moodleId] = { shortname: mc.shortname, fullname: mc.fullname };
    if (!state.remote[mc.moodleId]) {
      const course = await createCourseFromMoodle(mc);
      state.remote[mc.moodleId] = course.id;
      await linkCourses();
      await save();
    }
    const siteId = state.remote[mc.moodleId];
    const call = remoteRest(mc.moodleId);
    const initial = !state.remoteSynced[mc.moodleId];
    await syncCourse(mc.moodleId, siteId, { call, via: mc.moodleId, initial }, result);
    await remoteNews(mc.moodleId, siteId, call, initial, result);
    state.remoteSynced[mc.moodleId] = new Date().toISOString();
    result.remote++;
    await save();
  }
}

/** Announcements of a remote course (personal deadlines come to each student straight from Moodle). */
async function remoteNews(moodleId, siteId, call, initial, result) {
  try {
    const forums = await call('mod_forum_get_forums_by_courses', { courseids: [Number(moodleId)] });
    const posts = [];
    for (const f of forums.filter((x) => x.type === 'news')) {
      const d = await call('mod_forum_get_forum_discussions', { forumid: f.id, sortorder: 1, page: 0, perpage: 25 });
      for (const x of d.discussions || []) {
        posts.push({
          id: x.discussion,
          courseId: siteId,
          subject: x.name || x.subject,
          body: htmlToText(x.message),
          author: x.userfullname,
          created: x.created,
          url: `${SITE}/mod/forum/discuss.php?d=${x.discussion}`,
        });
      }
    }
    await addAnnouncements(posts, { history: initial });
  } catch (e) {
    result.errors.push(`הודעות ${siteId}: ${e.message}`);
  }
}

export async function sync({ trigger = 'schedule' } = {}) {
  if (!state.token || syncing) return state.lastResult;
  syncing = true;
  const result = { imported: [], updated: [], skipped: 0, errors: [] };
  const run = startRun('moodle-sync', { trigger, input: { courses: Object.values(state.map).filter(Boolean).length, remote: Object.keys(state.remote || {}).length } });
  try {
    await refreshCourses().catch(() => {});
    for (const [mid, siteCourseId] of Object.entries(state.map)) {
      if (siteCourseId) await syncCourse(mid, siteCourseId, {}, result);
    }
    await syncNews(result);
    await linkCourses();
    if (cloudEnabled()) await syncRemote(result);
    // Exam dates and class times from the university's course catalog (every 12 hours per course).
    const catalog = await syncCatalog();
    result.errors.push(...catalog.errors.map((x) => `קובץ הקורסים – ${x}`));
  } catch (e) {
    if (e.code === 'invalidtoken') {
      state.token = null;
      result.errors.push('המפתח של מודל פג תוקף – יש להתחבר מחדש');
    } else result.errors.push(e.message);
  } finally {
    syncing = false;
    state.lastSync = new Date().toISOString();
    state.lastResult = result;
    // Every error a dropped connection: look again soon instead of waiting for the next round.
    const netOnly = result.errors.length > 0 && result.errors.every(isNet);
    state.netFails = netOnly ? (state.netFails || 0) + 1 : 0;
    if (netOnly && state.netFails < 3) setTimeout(() => sync({ trigger: 'retry' }).catch(() => {}), 3 * 60000).unref?.();
    await save();
    run.ok({ imported: result.imported.length, updated: result.updated.length, skipped: result.skipped, errors: result.errors.slice(0, 10) });
  }
  if (result.imported.length || result.updated.length) console.log(`[moodle] imported ${result.imported.length}, updated ${result.updated.length}`);
  for (const p of healthProblems()) adminAlert(p);
  // New announcements: Claude reads them (kind, groups, what changed) – in the background, the sync doesn't wait.
  analyzeNotices({ trigger: 'moodle-sync' }).catch(() => {});
  return result;
}

let submissionTimer = null;
export function schedule() {
  clearInterval(timer);
  clearInterval(submissionTimer);
  if (!state.token || !state.autoSync) return;
  timer = setInterval(() => sync().catch((e) => console.error('[moodle]', e.message)), state.intervalMin * 60000);
  submissionTimer = setInterval(() => checkSubmissions().catch((e) => console.error('[moodle] submissions:', e.message)), 5 * 60000);
}

export function startMoodle() {
  // Files linked before linked keys were recorded (once; cheap when nothing is missing).
  setTimeout(async () => {
    for (const [key, rec] of Object.entries(state.files || {})) if (rec.linked && rec.lectureId) await linkKey(rec.lectureId, key).catch(() => {});
  }, 15000).unref?.();
  linkCourses().catch((e) => console.error('[moodle] link courses:', e.message));
  if (!state.token) {
    // Exam dates and class times come from the public course catalog, so they update even without Moodle.
    setTimeout(() => syncCatalog().catch((e) => console.error('[catalog]', e.message)), 30000);
    return;
  }
  schedule();
  setTimeout(() => sync().catch((e) => console.error('[moodle]', e.message)), 20000);
}
