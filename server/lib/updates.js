// Updates center: new material, Moodle announcements, deadlines and deadline reminders.
// Everything lives in data/updates.json (published to the cloud site with the rest of data/).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { DATA_DIR, getCourse, listLectures, patchLecture } from './store.js';
import { schedulePublish } from './publish.js';
import { NOTICE_VERSION } from '../../shared/notices.js';

const FILE = path.join(DATA_DIR, 'updates.json');
const DAY = 86400000;
const KIND_LABEL = { lecture: 'הרצאה חדשה', tutorial: 'תרגול חדש', homework: 'שיעורי בית / תרגילים חדשים', exam: 'מבחן קודם חדש', prep: 'חומר חדש להכנה למבחן' };

let state = load();
let timer = null;

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function save() {
  const tmp = `${FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
  await fsp.rename(tmp, FILE);
  schedulePublish('עדכונים');
}

const iso = (t = Date.now()) => new Date(t).toISOString();
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- macOS notification ----------
const NOTIFY_SCRIPT = ['on run argv', 'display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv) sound name "Glass"', 'end run'];
function notify(title, message, subtitle = '') {
  if (!state?.settings?.notify || process.platform !== 'darwin') return;
  const args = NOTIFY_SCRIPT.flatMap((l) => ['-e', l]);
  execFile('/usr/bin/osascript', [...args, message.slice(0, 220), title, subtitle], { timeout: 10000 }, () => {});
}

/** A problem the site owner should know about (sync broken, AI limit…): a Mac notification, at most hourly per problem. */
const alerted = new Map();
export function adminAlert(message) {
  const last = alerted.get(message) || 0;
  if (Date.now() - last < 3600000) return;
  alerted.set(message, Date.now());
  notify('IEMprove – צריך תשומת לב', message, '');
}

// ---------- public API ----------
/** Called once at server start. The first run marks everything that already exists as history. */
export async function initUpdates() {
  if (!state) {
    state = { since: iso(), items: [], deadlines: [], reminded: {}, settings: { notify: true, reminderDays: [3, 1] }, bootstrapped: { announcements: false } };
    // Existing material becomes history (not unread), so the feed starts populated but quiet.
    for (const l of listLectures().filter((x) => x.status === 'ready')) {
      state.items.push(materialItem(l, { addedAt: l.createdAt }));
      await patchLecture(l.id, { announced: true });
    }
    await save();
  }
  clearInterval(timer);
  timer = setInterval(() => checkReminders().catch((e) => console.error('[updates]', e.message)), 10 * 60000);
  setTimeout(() => checkReminders().catch(() => {}), 15000);
}

export function updatesView() {
  if (!state) return { since: iso(), items: [], deadlines: [], settings: { notify: false, reminderDays: [3, 1] } };
  const now = Date.now();
  // New-material items of lessons that are held back or gone (listLectures leaves them out) would link nowhere.
  const shown = new Set(listLectures().map((l) => l.id));
  const items = state.items.filter((i) => !(i.type === 'material' && i.lectureId && !shown.has(i.lectureId))).sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 300);
  const deadlines = state.deadlines
    .filter((d) => new Date(d.dueAt).getTime() > now - 7 * DAY)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return { since: state.since, items, deadlines, settings: state.settings };
}

function materialItem(l, { addedAt, updated = false } = {}) {
  const course = getCourse(l.courseId);
  const kind = l.kind || 'lecture';
  return {
    id: newId(),
    key: `material:${l.id}${updated ? `:${Date.now()}` : ''}`,
    type: 'material',
    kind,
    courseId: l.courseId,
    title: `${updated ? 'עודכן' : KIND_LABEL[kind]} ב${course?.short || ''}: ${l.title}`,
    body: '',
    lectureId: l.id,
    source: l.source?.type || 'upload',
    ...(l.source?.fileKey ? { fileKey: l.source.fileKey } : {}),
    ...(l.source?.linkedKeys?.length ? { fileKeys: [l.source.fileKey, ...l.source.linkedKeys].filter(Boolean) } : {}),
    createdAt: l.createdAt || iso(),
    addedAt: addedAt || (l.source?.initial && l.source?.timemodified ? iso(l.source.timemodified * 1000) : iso()),
  };
}

function push(item, { silent = false } = {}) {
  if (state.items.some((x) => x.key === item.key)) return false;
  state.items.push(item);
  // Courses built for other students appear in their feed but never pop up on this Mac.
  const course = getCourse(item.courseId);
  if (!silent && !course?.remote) notify('IEMprove', item.title, course?.short || '');
  return true;
}

/**
 * A Moodle file that turned out to be one the site already has (the same file uploaded again under another module):
 * its key joins the item's, so the cloud's Moodle watcher – which spotted it as new – knows it's already here.
 */
export async function linkFileKey(lectureId, fileKey) {
  if (!state) return;
  let changed = false;
  for (const it of state.items) {
    if (it.type !== 'material' || it.lectureId !== lectureId) continue;
    const keys = new Set([...(it.fileKeys || []), ...(it.fileKey ? [it.fileKey] : [])]);
    if (keys.has(fileKey)) continue;
    keys.add(fileKey);
    it.fileKeys = [...keys];
    changed = true;
  }
  if (changed) await save();
}

/** The weekly load report is out (weekly.js): one feed item per week; a rerun of the same week doesn't add another. */
export async function announceWeekly(report) {
  if (!state) return;
  push({
    id: newId(),
    key: `weekly:${report.week}`,
    type: 'report',
    courseId: null,
    title: `דוח העומס השבועי (${report.range}): ${report.levelLabel}`,
    body: report.headline,
    url: '/weekly',
    createdAt: report.generatedAt,
    addedAt: report.generatedAt,
  });
  await save();
}

/** A lecture / tutorial / homework finished processing for the first time (or was replaced by a newer version). */
export async function announceMaterial(meta, { updated = false } = {}) {
  if (!state || (!updated && meta.announced)) return;
  push(materialItem(meta, { updated }));
  await patchLecture(meta.id, { announced: true });
  await save();
}

/** Moodle news-forum posts. On the very first sync, only the last 3 days count as new. */
export async function addAnnouncements(posts, { history = false } = {}) {
  if (!state) return 0;
  const first = history || !state.bootstrapped?.announcements;
  let added = 0;
  for (const p of posts) {
    const created = iso(p.created * 1000);
    const fresh = !first || Date.now() - p.created * 1000 < 3 * DAY;
    const ok = push(
      {
        id: newId(),
        key: `announcement:${p.id}`,
        type: 'announcement',
        courseId: p.courseId,
        title: p.subject,
        body: p.body,
        author: p.author,
        url: p.url,
        createdAt: created,
        addedAt: fresh ? iso() : created,
      },
      { silent: !fresh }
    );
    if (ok) added++;
  }
  state.bootstrapped = { ...state.bootstrapped, announcements: true };
  if (added || first) await save();
  return added;
}

// ---------- Claude's reading of announcements (notices.js) ----------
const NOTICE_WINDOW = 14 * DAY;
const NOTICE_TRIES = 3;
/** Recent announcements not read yet (each gets a few tries). */
export function pendingNotices() {
  if (!state) return [];
  const since = Date.now() - NOTICE_WINDOW;
  return state.items.filter((i) => i.type === 'announcement' && (!i.analysis || (i.analysis.v || 1) < NOTICE_VERSION) && (i.analysisTries || 0) < NOTICE_TRIES && Date.parse(i.addedAt) > since);
}
/** Saves the reading on the feed item (published with the feed); null records a failed try. */
export async function setNoticeAnalysis(id, analysis) {
  const it = state?.items.find((i) => i.id === id);
  if (!it) return;
  if (analysis) it.analysis = analysis;
  else it.analysisTries = (it.analysisTries || 0) + 1;
  await save();
}

/** Upsert Moodle assignments/quizzes. New future deadlines are announced. */
export async function syncDeadlines(list) {
  if (!state) return;
  let changed = false;
  for (const d of list) {
    const existing = state.deadlines.find((x) => x.source === 'moodle' && x.moodleKey === d.moodleKey);
    if (existing) {
      const next = { ...existing, title: d.title, dueAt: d.dueAt, url: d.url, intro: d.intro, submitted: d.submitted, draft: !!d.draft, courseId: d.courseId };
      if (JSON.stringify(next) !== JSON.stringify(existing)) {
        if (existing.dueAt !== d.dueAt) state.reminded[existing.id] = [];
        Object.assign(existing, next);
        changed = true;
      }
      continue;
    }
    const deadline = { id: newId(), source: 'moodle', ...d, done: false };
    state.deadlines.push(deadline);
    changed = true;
    if (new Date(d.dueAt).getTime() > Date.now()) {
      push({
        id: newId(),
        key: `deadline:${d.moodleKey}`,
        type: 'deadline',
        courseId: d.courseId,
        title: `הגשה חדשה ב${getCourse(d.courseId)?.short || ''}: ${d.title}`,
        body: d.intro || '',
        url: d.url,
        dueAt: d.dueAt,
        deadlineId: deadline.id,
        createdAt: iso(),
        addedAt: iso(),
      });
    }
  }
  if (changed) await save();
  await checkReminders();
}

/** Exam dates were published (or changed) in the university's course catalog. */
export async function announceExamDates(courseId, { first, text }) {
  if (!state) return;
  const course = getCourse(courseId);
  push({
    id: newId(),
    key: `exams:${courseId}:${text}`,
    type: 'exam',
    courseId,
    title: `${first ? 'פורסמו תאריכי המבחנים' : 'עודכנו תאריכי המבחנים'} ב${course?.short || ''}`,
    body: text,
    createdAt: iso(),
    addedAt: iso(),
  });
  await save();
}

/** A class group's weekly time or room changed in the course catalog. */
export async function announceClassChange(courseId, { type, group, before, after }) {
  if (!state) return;
  const course = getCourse(courseId);
  const label = type === 'שעור' ? 'שיעור' : type;
  push({
    id: newId(),
    key: `class:${courseId}:${type}:${group}:${after}`,
    type: 'class-change',
    courseId,
    classType: type,
    group,
    title: `שינוי ב${course?.short || ''}: ${label} ${group}`,
    body: `לפני: ${before}\nעכשיו: ${after}`,
    createdAt: iso(),
    addedAt: iso(),
  }, { silent: !!course?.remote });
  await save();
}

/** Moodle assignments still waiting for a submission (due from 3 days ago on) – for the quick status check. */
export function pendingAssignments() {
  if (!state) return [];
  const from = Date.now() - 3 * DAY;
  return state.deadlines.filter((d) => d.source === 'moodle' && d.moodleKey?.startsWith('assign:') && !d.submitted && new Date(d.dueAt).getTime() > from);
}

/** The submission status of one assignment changed in Moodle (submitted, or a draft that wasn't sent yet). */
export async function setSubmission(moodleKey, { submitted, draft }) {
  const d = state?.deadlines.find((x) => x.source === 'moodle' && x.moodleKey === moodleKey);
  if (!d || (d.submitted === submitted && !!d.draft === draft)) return false;
  d.submitted = submitted;
  d.draft = draft;
  await save();
  return true;
}

export async function addManualDeadline({ courseId, title, dueAt, note }) {
  if (!title?.trim() || !dueAt || Number.isNaN(new Date(dueAt).getTime())) throw new Error('צריך כותרת ותאריך');
  const d = { id: newId(), source: 'manual', courseId: courseId || null, title: title.trim(), dueAt: new Date(dueAt).toISOString(), intro: note || '', submitted: false, done: false };
  state.deadlines.push(d);
  await save();
  await checkReminders();
  return d;
}

export async function patchDeadline(id, { done }) {
  const d = state.deadlines.find((x) => x.id === id);
  if (!d) throw new Error('לא נמצא');
  d.done = !!done;
  await save();
  return d;
}

export async function deleteDeadline(id) {
  state.deadlines = state.deadlines.filter((x) => !(x.id === id && x.source === 'manual'));
  await save();
}

export async function setSettings({ notify: n, reminderDays }) {
  if (n !== undefined) state.settings.notify = !!n;
  if (Array.isArray(reminderDays)) state.settings.reminderDays = [...new Set(reminderDays.map(Number).filter((x) => x > 0 && x <= 14))].sort((a, b) => b - a);
  await save();
  return state.settings;
}

export function testNotification() {
  const was = state.settings.notify;
  state.settings.notify = true;
  notify('IEMprove', 'כך ייראו התזכורות לדדליינים 🔔', 'בדיקה');
  state.settings.notify = was;
}

const whenText = (ms) => {
  const days = Math.round(ms / DAY);
  if (ms < DAY) {
    const h = Math.max(1, Math.round(ms / 3600000));
    return h === 1 ? 'בעוד שעה' : h === 2 ? 'בעוד שעתיים' : `בעוד ${h} שעות`;
  }
  return days === 1 ? 'בעוד יום' : days === 2 ? 'בעוד יומיים' : `בעוד ${days} ימים`;
};

/** Fire a reminder when a deadline crosses one of the thresholds (default: 3 days and 1 day before). */
export async function checkReminders() {
  if (!state) return;
  const now = Date.now();
  const days = state.settings.reminderDays || [3, 1];
  let changed = false;
  for (const d of state.deadlines) {
    if (d.submitted || d.done) continue;
    const left = new Date(d.dueAt).getTime() - now;
    if (left <= 0) continue;
    const crossed = days.filter((x) => left <= x * DAY);
    if (!crossed.length) continue;
    const done = state.reminded[d.id] || [];
    const pending = crossed.filter((x) => !done.includes(x));
    if (!pending.length) continue;
    // Only the closest threshold is announced; earlier ones that were skipped are marked as done.
    const course = getCourse(d.courseId)?.short || '';
    const due = new Date(d.dueAt).toLocaleString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
    push({
      id: newId(),
      key: `reminder:${d.id}:${Math.min(...pending)}:${d.dueAt}`,
      type: 'reminder',
      courseId: d.courseId,
      title: `⏰ ${whenText(left)}: ${d.title}${course ? ` (${course})` : ''}`,
      body: `להגשה עד ${due}`,
      url: d.url,
      dueAt: d.dueAt,
      deadlineId: d.id,
      createdAt: iso(),
      addedAt: iso(),
    });
    state.reminded[d.id] = [...new Set([...done, ...crossed])];
    changed = true;
  }
  if (changed) await save();
}
