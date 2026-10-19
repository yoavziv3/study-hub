import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, X, RotateCcw, ChevronLeft } from 'lucide-react';
import { shuffle } from '../api.js';

/* ---------------- Anthony pyramid: management levels ↔ information ↔ systems ---------------- */
const LEVELS = [
  {
    id: 'strategic', name: 'דרג אסטרטגי', role: 'קביעת אסטרטגיה, מטרות ויעדים · תכנון ארוך טווח', systems: ['EIS – מערכות מידע למנהלים בכירים'],
    info: { 'אופק זמן': 'שנים קדימה', 'מקור נתונים': 'בעיקר חיצוני (שוק, מתחרים, רגולציה)', 'רמת פירוט': 'תמונת-על, אגרגטיבי', 'דיוק ואמינות': 'נמוכים – תחזיות ואי-ודאות', 'מטרה': 'קביעת כיוון ומדיניות' },
    decision: 'החלטות בלתי מובנות – לא שגרתיות, בלי תהליך מוגדר (למשל: לרכוש סטארטאפ AI?)',
    examples: ['מגמות שוק ותחזית צמיחה ל-5 שנים', 'ניתוח מתחרים ומיצוב', 'כניסה לשוק חדש', 'מיזוג או רכישה'],
  },
  {
    id: 'managerial', name: 'דרג ניהולי (ביניים)', role: 'יישום מדיניות, תיאום ובקרה · תכנון קצר טווח', systems: ['MIS / BI – מערכות מידע ניהוליות ובינה עסקית', 'DSS – מערכות תומכות החלטה'],
    info: { 'אופק זמן': 'שבועות, חודשים, רבעונים', 'מקור נתונים': 'פנימי + חיצוני', 'רמת פירוט': 'מסוכם ומצרפי', 'דיוק ואמינות': 'בינוניים – הערכות ומגמות', 'מטרה': 'בקרה ותיאום' },
    decision: 'החלטות מובנות למחצה – תהליך שגרתי אך דרושה תובנה (למשל: תקציב שיווק לרבעון הבא)',
    examples: ['דו"ח ביצועים רבעוני', 'עלויות מול תקציב', 'השוואת סניפים', 'KPIs חודשיים'],
  },
  {
    id: 'operational', name: 'דרג תפעולי', role: 'תפעול ייצור / הפצה של המוצר או השירות', systems: ['TPS – מערכות עיבוד תנועות', 'ERP – תכנון משאבי ארגון'],
    info: { 'אופק זמן': 'מילישניות עד שעות', 'מקור נתונים': 'פנימי לארגון', 'רמת פירוט': 'מפורט ומדויק', 'דיוק ואמינות': 'גבוהים – נתוני אמת (GIGO)', 'מטרה': 'יעילות תפעולית' },
    decision: 'החלטות מובנות – חוזרות, עם תהליך מוגדר (למשל: הזמנת מלאי כשיורד מתחת לסף)',
    examples: ['הזמנת אוכל באפליקציה', 'מצב המלאי ברגע נתון', 'רישום שעות עבודה', 'צ\'ק-אין לטיסה'],
  },
];

const SCENARIOS = [
  { s: 'סטודנט נרשם לקורס במערכת ההרשמה של האוניברסיטה', a: 'TPS', why: 'תיעוד ועיבוד עסקה יומיומית בזמן אמת' },
  { s: 'מנכ"ל רואה דשבורד עם מגמות שוק ותחזיות ל-5 שנים', a: 'EIS', why: 'מידע אסטרטגי, אגרגטיבי ובעיקר חיצוני להנהלה הבכירה' },
  { s: 'מנהלת סניף מקבלת דו"ח חודשי של מכירות מול יעד', a: 'MIS', why: 'דוחות קבועים ומסוכמים לבקרה – "מה קרה?"' },
  { s: 'רופא מקבל המלצות טיפול מהמערכת – אבל הוא שמחליט', a: 'DSS', why: 'מודלים + נתונים לבעיה מובנית למחצה, המשתמש שותף להחלטה' },
  { s: 'העברה בנקאית באפליקציית הבנק', a: 'TPS', why: 'עסקה בודדת שנרשמת, מאומתת ונשמרת' },
  { s: 'אנליסט חוקר בדשבורד אינטראקטיבי למה המכירות ירדו באזור הצפון', a: 'BI', why: 'בינה עסקית – "למה זה קרה?", ניתוח אד-הוק ודשבורדים' },
  { s: 'מנהל מכירות בוחר בין כמה תרחישי תמחור שהמערכת מדמה', a: 'DSS', why: 'מערכת תומכת החלטה – בחירת תרחיש על בסיס מודל' },
  { s: 'מערכת אחת שמחברת רכש, מלאי, ייצור, כספים ומשאבי אנוש', a: 'ERP', why: 'תכנון משאבי ארגון – מערכת משולבת לתפעול הארגון' },
  { s: 'דירקטוריון בוחן אם להיכנס לשוק האירופי', a: 'EIS', why: 'החלטה אסטרטגית בלתי מובנית ברמת ההנהלה הבכירה' },
  { s: 'צ\'ק-אין לטיסה ובחירת מושב', a: 'TPS', why: 'עסקה תפעולית – מקור הנתונים לכל שאר המערכות' },
];
const OPTIONS = ['TPS', 'ERP', 'MIS', 'BI', 'DSS', 'EIS'];

export function PyramidLab() {
  const [sel, setSel] = useState('managerial');
  const L = LEVELS.find((l) => l.id === sel);
  const widths = { strategic: 38, managerial: 66, operational: 94 };
  return (
    <div className="card lab">
      <h2 style={{ fontSize: 22 }}>פירמידת אנתוני – דרגים, מידע ומערכות</h2>
      <p className="muted">לחצו על דרג בפירמידה כדי לראות איזה מידע הוא צריך, אילו החלטות הוא מקבל ואילו מערכות משרתות אותו (Anthony, 1965).</p>
      <div className="lab-layout" style={{ gridTemplateColumns: '360px 1fr' }}>
        <div className="stack" style={{ alignItems: 'center', gap: 6 }}>
          {LEVELS.map((l) => (
            <motion.button
              key={l.id}
              onClick={() => setSel(l.id)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.98 }}
              style={{
                width: `${widths[l.id]}%`, padding: '18px 8px', borderRadius: 12, fontWeight: 700,
                background: sel === l.id ? 'var(--c-grad)' : 'var(--surface-2)', color: sel === l.id ? '#fff' : 'var(--text)',
                border: '1px solid var(--border)', boxShadow: sel === l.id ? '0 12px 24px -12px var(--c)' : 'none', transition: 'background .3s, color .3s',
              }}
            >
              {l.name}
              <div style={{ fontSize: 11.5, fontWeight: 500, opacity: 0.85 }}>{l.systems.map((s) => s.split(' –')[0]).join(' · ')}</div>
            </motion.button>
          ))}
          <div className="faint" style={{ fontSize: 12.5, marginTop: 8, textAlign: 'center' }}>↑ מובנה פחות · אופק ארוך · מידע חיצוני<br />↓ מובנה יותר · זמן אמת · מידע פנימי ומפורט</div>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={sel} className="stack" initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 14 }} transition={{ duration: 0.25 }}>
            <div className="callout"><b>{L.name}: </b>{L.role}</div>
            <table className="tbl"><tbody>{Object.entries(L.info).map(([k, v]) => <tr key={k}><th style={{ width: 130 }}>{k}</th><td>{v}</td></tr>)}</tbody></table>
            <div><b>סוג ההחלטות: </b>{L.decision}</div>
            <div><b>מערכות: </b>{L.systems.join(' · ')}</div>
            <div className="row wrap" style={{ gap: 6 }}>{L.examples.map((e) => <span key={e} className="chip c">{e}</span>)}</div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

export function SystemsGame() {
  const [deck, setDeck] = useState(() => shuffle(SCENARIOS));
  const [i, setI] = useState(0);
  const [pick, setPick] = useState(null);
  const [score, setScore] = useState(0);
  const q = deck[i];
  if (!q) return (
    <div className="card lab result-hero">
      <h2>{score}/{deck.length} – {score >= 8 ? 'שולטים במערכות! 🎯' : 'כדאי לחזור על שיעור 2'}</h2>
      <button className="btn accent" style={{ marginTop: 14 }} onClick={() => { setDeck(shuffle(SCENARIOS)); setI(0); setScore(0); setPick(null); }}><RotateCcw size={16} /> שוב</button>
    </div>
  );
  return (
    <div className="card lab" style={{ maxWidth: 820 }}>
      <div className="row"><h2 style={{ fontSize: 22 }} className="grow">איזו מערכת מידע זו?</h2><span className="chip num">{i + 1}/{deck.length}</span><span className="chip good">{score} ✓</span></div>
      <AnimatePresence mode="wait">
        <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
          <div className="q-text">{q.s}</div>
          <div className="row wrap">
            {OPTIONS.map((o) => {
              const st = pick == null ? '' : o === q.a ? 'correct' : o === pick ? 'wrong' : '';
              return (
                <motion.button key={o} whileTap={{ scale: 0.95 }} disabled={pick != null} className={`option ${st}`} style={{ padding: '12px 20px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
                  onClick={() => { setPick(o); if (o === q.a) setScore((s) => s + 1); }}>
                  {st === 'correct' && <Check size={16} />}{st === 'wrong' && <X size={16} />}{o}
                </motion.button>
              );
            })}
          </div>
          {pick && (
            <motion.div className="explain" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <b>{q.a}</b> – {q.why}
              <div className="row" style={{ marginTop: 10 }}><div className="spacer" /><button className="btn primary sm" onClick={() => { setI(i + 1); setPick(null); }}>הבא <ChevronLeft size={15} /></button></div>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ---------------- DIKW ladder ---------------- */
const DIKW = [
  { k: 'Data', h: 'נתונים', d: 'עובדות גולמיות – מספרים, תווים, תמונות – בלי הקשר אין להן משמעות. "מה שמחשבים שומרים".', ex: ['72', 'אדום, 2.0, 192.234.235.245'] },
  { k: 'Information', h: 'מידע', d: 'נתונים שעברו עיבוד וקיבלו משמעות בהקשר. עונים על שאלה. "מה שאנשים רואים".', ex: ['72 סטודנטים נרשמו לקורס מבוא למערכות מידע בסמסטר ב׳', 'הרמזור בפינת שלמה המלך וטשרניחובסקי הפך לאדום'] },
  { k: 'Knowledge', h: 'ידע', d: 'מידע שעבר תהליך קוגניטיבי – ניסיון, למידה, הבנה. מאפשר להחליט ולפעול. "מה שאנשים מסיקים".', ex: ['ההרשמה גבוהה מהרגיל – צריך לפתוח קבוצה נוספת ולהזמין כיתה גדולה יותר', 'הרמזור בצומת מתחלף כל 90 שניות – כדאי להאט מראש'] },
  { k: 'Wisdom', h: 'חוכמה', d: 'שיפוט – היכולת לבחור את הפעולה הנכונה על בסיס ידע וערכים.', ex: ['לתכנן את גודל הכיתות לפי מגמות ההרשמה בשנים הבאות', 'אני מעדיף לעצור את האוטו'] },
];
export function DIKWLab() {
  const [ex, setEx] = useState(0);
  const [lvl, setLvl] = useState(0);
  return (
    <div className="card lab">
      <h2 style={{ fontSize: 22 }}>נתונים → מידע → ידע → חוכמה</h2>
      <p className="muted">טפסו בסולם ותראו איך אותה תופעה משתנה בכל שלב. בחרו דוגמה:</p>
      <div className="row" style={{ margin: '10px 0 18px' }}>
        {['הרשמה לקורס', 'הרמזור'].map((t, j) => <button key={t} className={`btn sm ${ex === j ? 'accent' : ''}`} onClick={() => setEx(j)}>{t}</button>)}
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {[...DIKW].reverse().map((d, ri) => {
          const i = DIKW.length - 1 - ri;
          const on = i <= lvl;
          return (
            <motion.button key={d.k} onClick={() => setLvl(i)} className="card" animate={{ opacity: on ? 1 : 0.45, x: on ? 0 : 10 }}
              style={{ textAlign: 'start', padding: 16, marginInlineEnd: `${i * 6}%`, borderInlineStart: `5px solid ${on ? 'var(--c)' : 'var(--border)'}` }}>
              <div className="row"><b style={{ fontSize: 17 }}>{d.h}</b><span className="faint num">{d.k}</span></div>
              {on && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                  <div className="muted" style={{ fontSize: 14, margin: '4px 0 8px' }}>{d.d}</div>
                  <div className="chip c" style={{ height: 'auto', padding: '6px 12px', whiteSpace: 'normal', fontSize: 14 }}>{d.ex[ex]}</div>
                </motion.div>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
