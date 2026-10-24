// The Mac's part of the owner's system status (processing, Moodle sync, publishing), from the heartbeat it sends with
// every notification tick (server/lib/health.js). Used by the cloud's status (cloud/lib/health.js), and by the Mac
// itself when the cloud can't be reached.
//
// A check: { id, title, state: 'ok' | 'warn' | 'bad' | 'off', text, detail: [lines], alerts: [{ key, text, once }] }.
// Alerts go to the owner's phone, each at most once a day (or once ever with `once`).
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const MAC_AWAY = 15 * MIN; // no heartbeat for this long: the Mac is off or asleep

/** "לפני 5 דקות", "לפני 3 שעות", "לפני יומיים". */
export function ago(t, now = Date.now()) {
  if (!t) return 'אף פעם';
  const ms = now - t;
  if (ms < MIN) return 'עכשיו';
  if (ms < HOUR) {
    const m = Math.round(ms / MIN);
    return m === 1 ? 'לפני דקה' : `לפני ${m} דקות`;
  }
  if (ms < DAY) {
    const h = Math.round(ms / HOUR);
    return h === 1 ? 'לפני שעה' : h === 2 ? 'לפני שעתיים' : `לפני ${h} שעות`;
  }
  const d = Math.round(ms / DAY);
  return d === 1 ? 'לפני יום' : d === 2 ? 'לפני יומיים' : `לפני ${d} ימים`;
}

const RANK = { ok: 0, off: 1, warn: 2, bad: 3 };
export const worst = (checks) => checks.reduce((w, c) => (RANK[c.state] > RANK[w] ? c.state : w), 'ok');

/** The Mac and its publishing, from its last heartbeat (`mac`, received at `at`). */
export function macChecks(mac, at, now = Date.now()) {
  if (!mac) {
    return [{ id: 'mac', title: 'המחשב', state: 'off', text: 'עוד לא דיווח', detail: [], alerts: [] }];
  }
  const away = now - at > MAC_AWAY;
  const detail = [];
  const alerts = [];
  const q = mac.queue || {};
  if (q.running || q.pending) detail.push(`בעיבוד: ${[...(mac.processing || [])].slice(0, 3).join(', ') || `${q.pending + (q.running ? 1 : 0)} קבצים`}`);
  if (mac.moodle?.connected === false) detail.push('המחשב לא מחובר למודל');
  else if (mac.moodle?.lastSync) detail.push(`סנכרון מודל אחרון ${ago(Date.parse(mac.moodle.lastSync), now)}`);
  if (mac.ai === false) detail.push('אין חיבור ל AI, אז אין סיכומים');
  for (const p of mac.problems || []) {
    detail.push(p);
    alerts.push({ key: `mac:${p.replace(/\d+/g, '#')}`, text: p });
  }
  const failed = mac.failed || [];
  for (const f of failed.slice(0, 5)) detail.push(`העיבוד נכשל: ${f.title}${f.error ? ` (${f.error})` : ''}`);
  for (const f of failed.filter((x) => now - (Date.parse(x.at) || 0) < 2 * DAY)) {
    alerts.push({ key: `failed:${f.id}`, text: `העיבוד נכשל: ${f.title}`, once: true });
  }
  const problem = mac.problems?.length || failed.length || mac.ai === false || mac.moodle?.connected === false;
  const checks = [{
    id: 'mac',
    title: 'המחשב',
    state: away ? 'off' : problem ? 'warn' : 'ok',
    text: away ? `כבוי, דיווח לאחרונה ${ago(at, now)}` : 'דלוק',
    detail,
    alerts: away ? [] : alerts,
  }];

  // Claude on the Mac, from its half-hourly check (server/lib/health.js checkAI).
  const w = mac.aiWatch;
  if (w?.checkedAt) {
    const gemini = w.provider === 'gemini';
    const name = gemini ? 'Gemini' : 'Claude';
    const text = w.ok ? `עונה · נבדק ${ago(w.checkedAt, now)}`
      : w.kind === 'signed-out' ? (gemini ? 'המפתח חסר או נדחה' : 'מנותק – צריך להתחבר מחדש')
      : w.kind === 'limit' ? 'הגעת למגבלת השימוש'
      : 'לא עונה';
    const fix = w.kind === 'signed-out'
      ? (gemini ? 'בדקו את GEMINI_API_KEY בקובץ .env במחשב (מפתח מ-aistudio.google.com).' : 'בטרמינל: claude, ואז /login. אחרי זה מה שחיכה יעובד לבד.')
      : w.kind === 'limit' ? (gemini ? 'המכסה היומית של Gemini מתאפסת בחצות לפי שעון קליפורניה (10:00 בבוקר בישראל); מה שחיכה יעובד לבד.' : 'כשהמגבלה תתאפס, מה שחיכה יעובד לבד.')
      : w.reason;
    checks.push({
      id: 'ai',
      title: `ה AI במחשב (${name})`,
      state: w.ok ? 'ok' : away ? 'off' : 'bad',
      text: away && !w.ok ? `${text} (בבדיקה האחרונה)` : text,
      detail: [
        ...(w.ok ? [] : [fix, ...(w.since ? [`כך ${ago(w.since, now).replace('לפני', 'כבר')}`] : [])]),
        ...(w.usage ? [`היום: ${w.usage.day} מתוך ${w.usage.limit} בקשות (${w.usage.model})`] : []),
      ].filter(Boolean),
      alerts: !w.ok && !away ? [{ key: `ai:${w.kind || 'error'}`, text: w.kind === 'signed-out' ? (gemini ? 'המפתח של Gemini חסר או נדחה – הסיכומים לא נוצרים. בדקו את GEMINI_API_KEY' : 'ה Claude במחשב מנותק – הסיכומים לא נוצרים. בטרמינל: claude, ואז /login') : w.kind === 'limit' ? `הגעת למגבלת השימוש ב ${name} – הסיכומים יחכו עד שהיא תתאפס` : `ה ${name} במחשב לא עונה: ${w.reason}` }] : [],
    });
  }

  const pub = mac.publish || {};
  const failedLast = pub.lastError && pub.lastError.at > (pub.lastOk || 0);
  checks.push({
    id: 'publish',
    title: 'פרסום לאתר',
    state: failedLast ? 'bad' : 'ok',
    text: failedLast ? `נכשל ${ago(pub.lastError.at, now)}` : pub.lastOk ? `פורסם לאחרונה ${ago(pub.lastOk, now)}` : 'אין שינויים מאז שהמחשב עלה',
    detail: [
      ...(failedLast ? [pub.lastError.message] : []),
      ...(pub.pending ? ['יש שינויים שמחכים לפרסום (יוצאים כשהעיבוד מסתיים)'] : []),
    ],
    alerts: failedLast ? [{ key: 'publish', text: `הפרסום לאתר נכשל: ${pub.lastError.message}` }] : [],
  });
  return checks;
}
