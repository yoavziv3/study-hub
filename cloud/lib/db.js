// D1 schema. Created lazily (CREATE … IF NOT EXISTS) the first time each isolate touches the database.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    moodle_userid INTEGER UNIQUE NOT NULL,
    username TEXT,
    fullname TEXT,
    token TEXT,
    token_ok INTEGER NOT NULL DEFAULT 1,
    courses TEXT NOT NULL DEFAULT '[]',
    courses_at INTEGER NOT NULL DEFAULT 0,
    cal_key TEXT UNIQUE,
    reminder_days TEXT NOT NULL DEFAULT '3,1',
    created_at INTEGER,
    last_login INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER, expires_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS progress (user_id INTEGER PRIMARY KEY, data TEXT, updated_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS cache (user_id INTEGER NOT NULL, key TEXT NOT NULL, data TEXT, at INTEGER, PRIMARY KEY (user_id, key))`,
  `CREATE TABLE IF NOT EXISTS attempts (key TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS attempts_key ON attempts(key, at)`,
  // "Report a mistake" on a summary section; read by the site owner through the admin channel.
  `CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, lecture_id TEXT NOT NULL, section TEXT, text TEXT NOT NULL, created_at INTEGER, status TEXT NOT NULL DEFAULT 'open')`,
  `CREATE INDEX IF NOT EXISTS reports_status ON reports(status, created_at)`,
  // Phone notifications: each device's Web Push subscription, and which notifications were already sent.
  `CREATE TABLE IF NOT EXISTS push_subs (endpoint TEXT PRIMARY KEY, user_id INTEGER NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT, created_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs(user_id)`,
  `CREATE TABLE IF NOT EXISTS push_sent (user_id INTEGER NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (user_id, key))`,
  // When the notification tick last ran (and from where: the cron Worker or the Mac).
  `CREATE TABLE IF NOT EXISTS push_meta (key TEXT PRIMARY KEY, value INTEGER)`,
  // The student's link to the BGU portal: their sign-in sealed for the Mac (the cloud can't open it), and the
  // schedule and groups the Mac read from it (portal.js).
  `CREATE TABLE IF NOT EXISTS portal_links (user_id INTEGER PRIMARY KEY, username TEXT, sealed TEXT NOT NULL, ok INTEGER NOT NULL DEFAULT 1, error TEXT, data TEXT, groups TEXT, synced_at INTEGER, requested_at INTEGER, created_at INTEGER)`,
  // The reader's portal session per student (encrypted by the reader, opaque here) and when a read last failed.
  `CREATE TABLE IF NOT EXISTS portal_state (user_id INTEGER PRIMARY KEY, session TEXT, failed_at INTEGER)`,
  // Moodle as the cloud watches it (moodle-watch.js): what each course page already had, and the new material and
  // announcements found there before the Mac has processed them.
  `CREATE TABLE IF NOT EXISTS moodle_watch (moodle_id INTEGER PRIMARY KEY, checked_at INTEGER, seen TEXT)`,
  `CREATE TABLE IF NOT EXISTS cloud_updates (key TEXT PRIMARY KEY, course_id TEXT NOT NULL, type TEXT NOT NULL, kind TEXT, title TEXT, body TEXT, url TEXT, file_key TEXT, author TEXT, added_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS cloud_updates_course ON cloud_updates(course_id, added_at)`,
  // The owner's system status (health.js): the Mac's last heartbeat ('mac') and the watcher's errors ('watch:<id>').
  `CREATE TABLE IF NOT EXISTS health (key TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT)`,
  // Claude's reading of the portal's notices (the Mac's notices.js), by the notice's key (shared/notices.js noticeKey).
  `CREATE TABLE IF NOT EXISTS notice_analysis (key TEXT PRIMARY KEY, analysis TEXT, at INTEGER NOT NULL)`,
  // The student's own files (files.js): private lectures and tutorials, stored as base64 chunks of ~0.5 MB.
  `CREATE TABLE IF NOT EXISTS user_files (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, course_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, chunks INTEGER NOT NULL, ready INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS user_files_user ON user_files(user_id, course_id)`,
  `CREATE TABLE IF NOT EXISTS user_file_chunks (file_id TEXT NOT NULL, n INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (file_id, n))`,
];

let ready = null;
export function ensureSchema(db) {
  ready ||= db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}
