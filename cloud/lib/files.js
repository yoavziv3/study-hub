// The student's own files (lectures and tutorials they add for themselves), kept in D1 in chunks. They are private to
// the student, never part of the published course data, and nothing reads them with AI: summaries and questions are
// only built for what comes from Moodle or what the site's owner adds himself.
//
// The browser cuts a file into chunks and encodes each as base64 (and decodes them back to view it), so the Function
// only stores and returns text and does no per-byte work.
import { json, fail, readJson, HttpError, randomId } from './util.js';
import { siteCourses, allowedCourseIds } from './account.js';

export const LIMITS = { file: 20 * 1024 * 1024, total: 100 * 1024 * 1024, files: 60, chunkChars: 800_000, maxChunks: 80, title: 120 };
export const KINDS = ['lecture', 'tutorial'];
// Only types the page can show or hand back as a download. The browser rebuilds the file with the type chosen here.
export const TYPES = {
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const DAY = 86400000;
const ext = (name) => String(name).split('.').pop().toLowerCase();
const view = (r) => ({ id: r.id, courseId: r.course_id, kind: r.kind, title: r.title, name: r.name, size: r.size, chunks: r.chunks, type: TYPES[ext(r.name)] || null, createdAt: r.created_at });

async function mine(env, user, id) {
  if (!/^[0-9a-f]{16}$/.test(id)) throw new HttpError(404, 'הקובץ לא נמצא');
  const row = await env.DB.prepare('SELECT * FROM user_files WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!row) throw new HttpError(404, 'הקובץ לא נמצא');
  return row;
}

export async function deleteFile(env, id) {
  await env.DB.batch([env.DB.prepare('DELETE FROM user_file_chunks WHERE file_id = ?').bind(id), env.DB.prepare('DELETE FROM user_files WHERE id = ?').bind(id)]);
}

const cleanTitle = (t, fallback) => String(t || fallback || '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.title);

export async function personalFiles({ request, env, user, path, method }) {
  const rest = path.replace(/^\/api\/me\/files\/?/, '');

  // The courses a file can be added to: every course the site carries, the student's own first.
  if (rest === 'courses' && method === 'GET') {
    const courses = await siteCourses(env, request);
    const enrolled = new Set(allowedCourseIds(user, courses));
    return json({ courses: courses.map((c) => ({ id: c.id, name: c.name, short: c.short, code: c.code, color: c.color, icon: c.icon, term: c.term || null, enrolled: enrolled.has(c.id) })) });
  }

  if (rest === '' && method === 'GET') {
    // An upload that was never finished (the tab was closed) is dropped after a day.
    const stale = await env.DB.prepare('SELECT id FROM user_files WHERE user_id = ? AND ready = 0 AND created_at < ?').bind(user.id, Date.now() - DAY).all();
    for (const r of stale.results || []) await deleteFile(env, r.id);
    const rows = await env.DB.prepare('SELECT * FROM user_files WHERE user_id = ? AND ready = 1 ORDER BY created_at DESC').bind(user.id).all();
    const files = (rows.results || []).map(view);
    return json({ files, quota: { used: files.reduce((s, f) => s + f.size, 0), max: LIMITS.total, maxFile: LIMITS.file } });
  }

  // Start an upload: the file's details; the chunks follow one by one.
  if (rest === '' && method === 'POST') {
    const b = await readJson(request, 4000);
    const name = String(b.name || '').slice(0, 200);
    const size = Number(b.size);
    const chunks = Number(b.chunks);
    if (!TYPES[ext(name)]) throw new HttpError(400, 'אפשר להעלות PDF, PowerPoint או Word');
    if (!KINDS.includes(b.kind)) throw new HttpError(400, 'צריך לבחור הרצאה או תרגול');
    if (!(await siteCourses(env, request)).some((c) => c.id === b.courseId)) throw new HttpError(400, 'הקורס לא נמצא');
    if (!Number.isInteger(size) || size <= 0 || size > LIMITS.file) throw new HttpError(413, `הקובץ גדול מדי – עד ${LIMITS.file / 1048576} MB`);
    if (!Number.isInteger(chunks) || chunks < 1 || chunks > LIMITS.maxChunks) throw new HttpError(400, 'בקשה לא תקינה');
    const usage = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS used, COUNT(*) AS n FROM user_files WHERE user_id = ?').bind(user.id).first();
    if (usage.used + size > LIMITS.total) throw new HttpError(413, `נגמר המקום (${LIMITS.total / 1048576} MB לכל סטודנט). אפשר למחוק קבצים ישנים.`);
    if (usage.n >= LIMITS.files) throw new HttpError(413, `אפשר לשמור עד ${LIMITS.files} קבצים`);
    const id = randomId(8);
    await env.DB.prepare('INSERT INTO user_files (id, user_id, course_id, kind, title, name, size, chunks, ready, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .bind(id, user.id, b.courseId, b.kind, cleanTitle(b.title, name.replace(/\.[^.]+$/, '')) || 'קובץ', name, size, chunks, Date.now())
      .run();
    return json({ id });
  }

  const m = rest.match(/^([0-9a-f]{16})(?:\/(done)|\/chunks\/(\d+))?$/);
  if (!m) throw new HttpError(404, 'לא נמצא');
  const row = await mine(env, user, m[1]);

  // One chunk of the file (base64 text), in either direction.
  if (m[3] != null) {
    const n = Number(m[3]);
    if (n < 0 || n >= row.chunks) throw new HttpError(404, 'לא נמצא');
    if (method === 'PUT') {
      if (row.ready) throw new HttpError(409, 'הקובץ כבר הועלה');
      const { data } = await readJson(request, LIMITS.chunkChars + 1000);
      if (typeof data !== 'string' || !data.length || data.length > LIMITS.chunkChars) throw new HttpError(400, 'בקשה לא תקינה');
      await env.DB.prepare('INSERT OR REPLACE INTO user_file_chunks (file_id, n, data) VALUES (?, ?, ?)').bind(row.id, n, data).run();
      return json({ ok: true });
    }
    if (method === 'GET') {
      if (!row.ready) throw new HttpError(404, 'לא נמצא');
      const c = await env.DB.prepare('SELECT data FROM user_file_chunks WHERE file_id = ? AND n = ?').bind(row.id, n).first();
      if (!c) throw new HttpError(404, 'לא נמצא');
      return json({ data: c.data });
    }
  }

  // All chunks arrived: the file becomes visible.
  if (m[2] && method === 'POST') {
    const have = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_file_chunks WHERE file_id = ?').bind(row.id).first();
    if (have.n !== row.chunks) throw new HttpError(409, 'ההעלאה לא הושלמה – נסו שוב');
    await env.DB.prepare('UPDATE user_files SET ready = 1 WHERE id = ?').bind(row.id).run();
    return json({ file: view({ ...row, ready: 1 }) });
  }

  if (method === 'PATCH') {
    const b = await readJson(request, 4000);
    const title = b.title == null ? row.title : cleanTitle(b.title, row.title) || row.title;
    const kind = b.kind == null ? row.kind : b.kind;
    const courseId = b.courseId == null ? row.course_id : b.courseId;
    if (!KINDS.includes(kind)) throw new HttpError(400, 'בקשה לא תקינה');
    if (courseId !== row.course_id && !(await siteCourses(env, request)).some((c) => c.id === courseId)) throw new HttpError(400, 'הקורס לא נמצא');
    await env.DB.prepare('UPDATE user_files SET title = ?, kind = ?, course_id = ? WHERE id = ?').bind(title, kind, courseId, row.id).run();
    return json({ file: view({ ...row, title, kind, course_id: courseId }) });
  }

  if (method === 'DELETE') {
    await deleteFile(env, row.id);
    return json({ ok: true });
  }

  return fail(405, 'שיטה לא נתמכת');
}
