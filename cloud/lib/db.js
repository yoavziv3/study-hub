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
  // The student's BGU portal sign-in (encrypted, kept at their request) and the schedule read from it (portal.js).
  `CREATE TABLE IF NOT EXISTS portal_accounts (user_id INTEGER PRIMARY KEY, username TEXT, creds TEXT NOT NULL, token TEXT, ok INTEGER NOT NULL DEFAULT 1, error TEXT, data TEXT, synced_at INTEGER, created_at INTEGER)`,
];

let ready = null;
export function ensureSchema(db) {
  ready ||= db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}
