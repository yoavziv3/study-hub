// Spots new material and course announcements in Moodle from the cloud, so students hear about them even while the
// Mac is off. It only notices and tells: the Mac still downloads, converts and summarises the files when it's back
// (server/lib/moodle.js), and its own update then shows the summary. Runs inside the notification tick (notify.js),
// a few Moodle courses per tick, through the token of a student enrolled in each (asCourseMember).
//
// State: moodle_watch (per Moodle course: what it has already seen) and cloud_updates (what it found). The first
// look at a course only records what's there, so nothing old is announced.
import { asCourseMember } from './account.js';
import { rest, moodleSite } from './moodle.js';
import { classify, accepted } from '../../shared/moodle-kind.js';

const MIN = 60000;
const DAY = 86400000;
const EVERY = 10 * MIN; // each Moodle course is looked at about this often
const PER_TICK = 3; // courses per tick (each is three Moodle calls)
const KIND_LABEL = { lecture: 'הרצאה חדשה', tutorial: 'תרגול חדש', homework: 'שיעורי בית / תרגילים חדשים', exam: 'מבחן קודם חדש' };

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const htmlToText = (html = '') => decode(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const fileTitle = (mod, f) => (mod.name && mod.name.length > 2 ? mod.name : f.filename.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ')).trim();

/** Everything worth announcing on one Moodle course right now: { key → item }. */
async function lookAt(env, moodleId, course) {
  const site = moodleSite(env);
  return asCourseMember(env, moodleId, async (token) => {
    const found = new Map();
    const sections = await rest(env, token, 'core_course_get_contents', { courseid: moodleId });
    for (const sec of sections || []) {
      for (const mod of sec.modules || []) {
        if (!['resource', 'folder'].includes(mod.modname) || mod.visible === 0) continue;
        for (const f of mod.contents || []) {
          if (f.type !== 'file' || !accepted(f.filename)) continue;
          // The Mac's key for the same file (moodle.js courseFiles), so its own announcement can be matched.
          const fileKey = `${moodleId}:${mod.id}:${f.filepath || '/'}${f.filename}`;
          const kind = classify(f.filename, mod.name, sec.name);
          if (!kind) continue;
          found.set(`moodlefile:${fileKey}`, {
            type: 'material', kind, fileKey,
            title: `${KIND_LABEL[kind]} ב${course.short}: ${fileTitle(mod, f)}`,
            body: course.ai === false ? 'עלה למודל' : 'עלה למודל – הסיכום, השאלות והכרטיסיות יגיעו בקרוב',
            url: `${site}/mod/${mod.modname}/view.php?id=${mod.id}`,
          });
        }
      }
    }
    const forums = await rest(env, token, 'mod_forum_get_forums_by_courses', { courseids: [moodleId] }).catch(() => []);
    for (const forum of (forums || []).filter((x) => x.type === 'news')) {
      const d = await rest(env, token, 'mod_forum_get_forum_discussions', { forumid: forum.id, sortorder: 1, page: 0, perpage: 10 }).catch(() => ({}));
      for (const x of d.discussions || []) {
        // Same key as the Mac's announcement items (updates.js addAnnouncements).
        found.set(`announcement:${x.discussion}`, {
          type: 'announcement',
          title: x.name || x.subject || 'הודעה חדשה',
          body: htmlToText(x.message).slice(0, 1500),
          author: x.userfullname || '',
          url: `${site}/mod/forum/discuss.php?d=${x.discussion}`,
        });
      }
    }
    return found;
  });
}

const FORCE_EVERY = MIN; // "refresh now" (a student's button): a course isn't looked at again within this, however often it's pressed
const FORCE_MAX = 6; // courses per such request

/**
 * One step of watching: the few Moodle courses looked at longest ago. Returns how many new items it found.
 * force: the student pressed "refresh" – look at their courses now (each at most once a minute) instead of waiting.
 */
export async function watchMoodle(env, courses, now = Date.now(), { force = false } = {}) {
  const db = env.DB;
  const links = courses.flatMap((c) => (c.moodleIds || []).map((m) => ({ moodleId: Number(m), course: c })));
  if (!links.length) return 0;
  const rows = (await db.prepare('SELECT moodle_id, checked_at, seen FROM moodle_watch').all()).results;
  const state = new Map(rows.map((r) => [r.moodle_id, r]));
  const due = links
    .filter((l) => now - (state.get(l.moodleId)?.checked_at || 0) > (force ? FORCE_EVERY : EVERY))
    .sort((a, b) => (state.get(a.moodleId)?.checked_at || 0) - (state.get(b.moodleId)?.checked_at || 0))
    .slice(0, force ? FORCE_MAX : PER_TICK);
  let added = 0;
  for (const { moodleId, course } of due) {
    let found;
    try {
      found = await lookAt(env, moodleId, course);
    } catch (e) {
      // No signed-in student in this course, or Moodle is down: try again next round (the owner's status page says why).
      await db.batch([
        db.prepare('INSERT INTO moodle_watch (moodle_id, checked_at) VALUES (?, ?) ON CONFLICT(moodle_id) DO UPDATE SET checked_at = excluded.checked_at').bind(moodleId, now),
        db.prepare('INSERT INTO health (key, at, data) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, data = excluded.data')
          .bind(`watch:${moodleId}`, now, JSON.stringify({ error: String(e?.message || e).slice(0, 200) })),
      ]);
      continue;
    }
    const prev = state.get(moodleId);
    const seen = new Set(prev?.seen ? JSON.parse(prev.seen) : []);
    const writes = [db.prepare('DELETE FROM health WHERE key = ?').bind(`watch:${moodleId}`)];
    // The first look only records what's already there.
    if (prev?.seen) {
      for (const [key, it] of found) {
        if (seen.has(key)) continue;
        added++;
        writes.push(db.prepare(
          'INSERT OR IGNORE INTO cloud_updates (key, course_id, type, kind, title, body, url, file_key, author, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(key, course.id, it.type, it.kind || null, it.title.slice(0, 300), it.body.slice(0, 1500), it.url, it.fileKey || null, it.author || null, now));
      }
    }
    for (const key of found.keys()) seen.add(key);
    writes.push(db.prepare('INSERT INTO moodle_watch (moodle_id, checked_at, seen) VALUES (?, ?, ?) ON CONFLICT(moodle_id) DO UPDATE SET checked_at = excluded.checked_at, seen = excluded.seen')
      .bind(moodleId, now, JSON.stringify([...seen])));
    await db.batch(writes);
  }
  if (Math.random() < 0.05) await db.prepare('DELETE FROM cloud_updates WHERE added_at < ?').bind(now - 30 * DAY).run();
  return added;
}

/** What the watcher found lately, as items of the updates feed (same shape as the Mac's in updates.json). */
export async function cloudUpdates(env, courseIds, { since = Date.now() - 30 * DAY } = {}) {
  if (!courseIds.length) return [];
  const rows = (await env.DB.prepare(
    `SELECT * FROM cloud_updates WHERE added_at > ? AND course_id IN (${courseIds.map(() => '?').join(',')}) ORDER BY added_at DESC LIMIT 200`
  ).bind(since, ...courseIds).all()).results;
  return rows.map((r) => ({
    id: r.key, key: r.key, type: r.type, kind: r.kind || undefined, courseId: r.course_id, title: r.title, body: r.body,
    url: r.url, author: r.author || undefined, fileKey: r.file_key || undefined, cloud: true,
    addedAt: new Date(r.added_at).toISOString(), createdAt: new Date(r.added_at).toISOString(),
  }));
}

/** The Mac's feed plus the watcher's items it hasn't caught up with yet (same file, same post = one item). */
export function mergeUpdates(macItems, cloudItems) {
  const keys = new Set(macItems.map((i) => i.key).filter(Boolean));
  // A file uploaded again under another module is linked by the Mac to the item it already has (fileKeys).
  const files = new Set(macItems.flatMap((i) => [i.fileKey, ...(i.fileKeys || [])]).filter(Boolean));
  return [...macItems, ...cloudItems.filter((i) => !keys.has(i.key) && !(i.fileKey && files.has(i.fileKey)))];
}
