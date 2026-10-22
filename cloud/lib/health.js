// The owner's system status: whether each moving part ran lately and what is waiting on it – the cron Worker that
// sends notifications, the Moodle watcher, the portal readers (phone / VM / Mac), the Mac (heartbeat with each of its
// ticks) and its publishing, files waiting for a summary, and the students' connections. Shown on /system to the
// owner only (the Moodle user the Mac is signed in as), and checked on every notification tick: a check's alerts go
// to the owner's phone (notify.js ownerAlerts).
import { pushConfigured } from './webpush.js';
import { cloudUpdates, mergeUpdates } from './moodle-watch.js';
import { macChecks, ago, worst } from '../../shared/system-checks.js';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const READER = { phone: 'הטלפון', vm: 'השרת בישראל', mac: 'המחשב' };

/** The Mac's heartbeat (server/lib/health.js); it also says who the owner is. */
export async function saveHeartbeat(env, mac, now = Date.now()) {
  const stmts = [
    env.DB.prepare('INSERT INTO health (key, at, data) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, data = excluded.data')
      .bind('mac', now, JSON.stringify(mac).slice(0, 20000)),
  ];
  const owner = Number(mac?.owner);
  if (owner > 0) {
    stmts.push(env.DB.prepare("INSERT INTO push_meta (key, value) VALUES ('owner', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(owner));
  }
  await env.DB.batch(stmts);
}

/** The site user the owner signs in as, or null. */
export async function ownerUserId(env) {
  const r = await env.DB.prepare("SELECT u.id FROM push_meta m JOIN users u ON u.moodle_userid = m.value WHERE m.key = 'owner'").first();
  return r?.id || null;
}

/** What this deployment was built from (data/build.json: commit and time). */
export async function buildInfo(env, request) {
  const res = await env.ASSETS.fetch(new URL('/data/build.json', request.url));
  if (!res.ok || !(res.headers.get('Content-Type') || '').includes('json')) return null;
  return res.json();
}

/** The Mac's published feed (data/updates.json in the static build). */
export async function publishedItems(env, request) {
  const res = await env.ASSETS.fetch(new URL('/data/updates.json', request.url));
  if (!res.ok || !(res.headers.get('Content-Type') || '').includes('json')) return [];
  return (await res.json()).items || [];
}

const parse = (s) => {
  try { return JSON.parse(s || 'null'); } catch { return null; }
};

export async function systemStatus(env, { courses, macItems, build = null, now = Date.now() }) {
  const db = env.DB;
  const [meta, watch, users, subs, links, portalFails, health, cloudItems] = await Promise.all([
    db.prepare('SELECT key, value FROM push_meta').all(),
    db.prepare('SELECT moodle_id, checked_at FROM moodle_watch').all(),
    db.prepare('SELECT token_ok FROM users').all(),
    db.prepare('SELECT COUNT(*) AS devices, COUNT(DISTINCT user_id) AS users FROM push_subs').first(),
    db.prepare('SELECT ok, synced_at FROM portal_links').all(),
    db.prepare('SELECT COUNT(*) AS n FROM portal_state WHERE failed_at > ?').bind(now - HOUR).first(),
    db.prepare('SELECT key, at, data FROM health').all(),
    cloudUpdates(env, courses.map((c) => c.id), { since: now - 7 * DAY }),
  ]);
  const m = Object.fromEntries(meta.results.map((r) => [r.key, r.value]));
  const healthOf = new Map(health.results.map((r) => [r.key, r]));
  const checks = [];

  // ---------- the cron Worker (notifications and everything else on the tick) ----------
  const cron = m['last_tick:cron'] || 0;
  const macTick = now - (m['last_tick:mac'] || 0) < 10 * MIN;
  if (!pushConfigured(env)) {
    checks.push({ id: 'cron', title: 'שליחת ההתראות', state: 'bad', text: 'חסר מפתח VAPID בענן', detail: [], alerts: [] });
  } else if (now - cron < 10 * MIN) {
    checks.push({ id: 'cron', title: 'שליחת ההתראות', state: 'ok', text: `ה Worker רץ ${ago(cron, now)}`, detail: [], alerts: [] });
  } else {
    checks.push({
      id: 'cron',
      title: 'שליחת ההתראות',
      state: 'bad',
      text: `ה Worker רץ לאחרונה ${ago(cron, now)}`,
      detail: [macTick ? 'המחשב שולח את ההתראות במקומו בינתיים' : 'אף אחד לא שולח התראות כרגע'],
      alerts: now - cron > 20 * MIN ? [{ key: 'cron', text: `ה Worker ששולח את ההתראות הפסיק לרוץ${macTick ? ' – המחשב מחליף אותו בינתיים' : ''}` }] : [],
    });
  }

  // ---------- the Moodle watcher ----------
  const shortOf = new Map(courses.flatMap((c) => (c.moodleIds || []).map((id) => [Number(id), c.short])));
  const linked = [...shortOf.keys()];
  const checked = new Map(watch.results.map((r) => [r.moodle_id, r.checked_at]));
  if (!linked.length) {
    checks.push({ id: 'watch', title: 'מעקב המודל', state: 'off', text: 'אין קורסים שמקושרים למודל', detail: [], alerts: [] });
  } else {
    const oldest = Math.min(...linked.map((id) => checked.get(id) || 0));
    const newest = Math.max(...linked.map((id) => checked.get(id) || 0));
    const errors = linked.map((id) => [id, parse(healthOf.get(`watch:${id}`)?.data)?.error]).filter(([, e]) => e);
    const stuck = now - oldest > 45 * MIN;
    const ticking = now - (m.last_tick || 0) < 10 * MIN;
    checks.push({
      id: 'watch',
      title: 'מעקב המודל',
      state: stuck ? 'bad' : errors.length ? 'warn' : 'ok',
      text: `${linked.length} קורסים · נבדק לאחרונה ${ago(newest, now)}`,
      detail: [
        ...(stuck ? [`יש קורס שלא נבדק ${ago(oldest, now).replace('לפני', 'כבר')}`] : []),
        ...errors.map(([id, e]) => `${shortOf.get(id)}: ${e}`),
      ],
      // A stopped tick is the cron check's alert; this one is for a watcher stuck while ticks run.
      alerts: stuck && ticking ? [{ key: 'watch', text: 'מעקב המודל בענן נתקע – יש קורס שלא נבדק כבר יותר מ 45 דקות' }] : [],
    });
  }

  // ---------- the portal readers ----------
  const readers = Object.entries(m)
    .filter(([k]) => k.startsWith('portal_relay:'))
    .map(([k, at]) => ({ name: k.slice('portal_relay:'.length), at }))
    .sort((a, b) => b.at - a.at);
  const label = (n) => READER[n] || n;
  if (!links.results.length) {
    checks.push({ id: 'portal', title: 'קריאת הפורטל', state: 'off', text: 'אף סטודנט עוד לא חיבר את הפורטל', detail: [], alerts: [] });
  } else {
    const okLinks = links.results.filter((l) => l.ok);
    const badLogins = links.results.length - okLinks.length;
    const stale = okLinks.filter((l) => now - (l.synced_at || 0) > 2 * HOUR).length;
    const main = readers.find((r) => r.name !== 'mac' && now - r.at < 30 * DAY);
    // The Mac checks in every minute too, as the backup: name the main reader (phone/VM) while it's active.
    const fresh = readers.filter((r) => now - r.at < 5 * MIN);
    const active = fresh.find((r) => r.name !== 'mac') || fresh[0];
    const mainDown = main && now - main.at > 30 * MIN;
    const detail = [];
    if (mainDown) detail.push(active ? `${label(active.name)} קורא במקומו בינתיים` : 'אף קורא לא פעיל כרגע');
    if (!main) detail.push('רק המחשב קורא את הפורטל, אז כשהוא כבוי אין עדכונים. אפשר להתקין את הקורא בטלפון ישן בבית.');
    if (stale) detail.push(`${stale} ${stale === 1 ? 'סטודנט לא התעדכן' : 'סטודנטים לא התעדכנו'} יותר משעתיים`);
    if (badLogins) detail.push(`${badLogins} עם פרטי כניסה שגויים לפורטל (צריכים להתחבר אליו מחדש)`);
    if (portalFails?.n) detail.push(`${portalFails.n} קריאות נכשלו בשעה האחרונה`);
    checks.push({
      id: 'portal',
      title: 'קריאת הפורטל',
      state: mainDown ? 'bad' : !active || stale ? 'warn' : 'ok',
      text: active
        ? `${label(active.name)} קורא · ${okLinks.length} ${okLinks.length === 1 ? 'סטודנט מחובר' : 'סטודנטים מחוברים'}`
        : `אף קורא לא פעיל – ${readers[0] ? `${label(readers[0].name)} פנה לאחרונה ${ago(readers[0].at, now)}` : 'אף אחד עוד לא פנה'}`,
      detail,
      alerts: mainDown ? [{ key: `portal:${main.name}`, text: `${label(main.name)} הפסיק לקרוא את הפורטל (פנה לאחרונה ${ago(main.at, now)})` }] : [],
    });
  }

  // ---------- the Mac and its publishing ----------
  const mac = healthOf.get('mac');
  const macData = parse(mac?.data);
  checks.push(...macChecks(macData, mac?.at || 0, now));

  // ---------- is this deployment the latest? ----------
  // The Mac reports the commit it last pushed (origin/main). A Cloudflare build that fails leaves the old site up,
  // quietly – this notices when the live build stays behind that commit.
  const git = macData?.git;
  if (git?.head && build?.commit && build.commit !== 'local') {
    // Behind = a different commit AND built before the Mac's commit existed. A build newer than that commit is the
    // cloud being ahead of a heartbeat sent just before a push (the Mac reports every 5 minutes), not behind it.
    const behind = build.commit !== git.head && Date.parse(build.builtAt) < git.headAt + 15 * MIN;
    const late = behind && now - git.headAt > 30 * MIN;
    checks.push({
      id: 'deploy',
      title: 'עדכון האתר בענן',
      state: late ? 'bad' : behind ? 'warn' : 'ok',
      text: !behind ? `מעודכן · נבנה ${ago(Date.parse(build.builtAt), now)}` : late ? `האתר תקוע על גרסה מ${ago(Date.parse(build.builtAt), now)}` : 'עדכון בדרך',
      detail: behind ? [`באתר: ${build.commit.slice(0, 7)} · ב git: ${git.head.slice(0, 7)}`, ...(late ? ['כנראה שהבנייה ב Cloudflare נכשלה – הסיבה מופיעה בלוח הבקרה של Cloudflare Pages'] : [])] : [],
      alerts: late ? [{ key: `deploy:${git.head.slice(0, 7)}`, text: 'העדכון של האתר בענן נכשל – הסטודנטים רואים גרסה ישנה' }] : [],
    });
  }

  // ---------- new Moodle files the Mac hasn't summarised and published yet ----------
  const waiting = mergeUpdates(macItems, cloudItems).slice(macItems.length).filter((i) => i.type === 'material');
  const oldestWait = Math.min(...waiting.map((i) => Date.parse(i.addedAt)));
  const late = waiting.length && now - oldestWait > DAY;
  const files = (n) => (n === 1 ? 'קובץ חדש אחד מחכה' : `${n} קבצים חדשים מחכים`);
  checks.push({
    id: 'waiting',
    title: 'חומר שמחכה לסיכום',
    state: !waiting.length ? 'ok' : late ? 'bad' : 'warn',
    text: !waiting.length ? 'אין' : `${files(waiting.length)} למחשב, הוותיק ${ago(oldestWait, now)}`,
    detail: waiting.slice(0, 6).map((i) => i.title),
    alerts: late ? [{ key: 'waiting', text: `${files(waiting.length)} לסיכום כבר יותר מיום – כדאי להדליק את המחשב` }] : [],
  });

  // ---------- students ----------
  const expired = users.results.filter((u) => !u.token_ok).length;
  checks.push({
    id: 'students',
    title: 'סטודנטים',
    state: expired ? 'warn' : 'ok',
    text: `${users.results.length} רשומים · ${subs?.users || 0} עם התראות בטלפון (${subs?.devices || 0} מכשירים)`,
    detail: expired ? [`${expired} עם חיבור למודל שפג – מקבלים תזכורת להתחבר מחדש`] : [],
    alerts: [],
  });

  return { at: now, state: worst(checks), checks };
}
