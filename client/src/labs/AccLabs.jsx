import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Play, RotateCcw, ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
import { shuffle } from '../api.js';

const nis = (n) => (n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString('he-IL')})` : Math.round(n).toLocaleString('he-IL'));

/* ---------------- Depreciation methods ---------------- */
export function DepreciationLab() {
  const [C, setC] = useState(100000);
  const [R, setR] = useState(10000);
  const [n, setN] = useState(3);
  const [saleYear, setSaleYear] = useState(2);
  const [salePrice, setSalePrice] = useState(50000);
  const [method, setMethod] = useState('sl');

  const rows = useMemo(() => {
    const base = C - R;
    const syd = (n * (n + 1)) / 2;
    const r = R > 0 ? 1 - Math.pow(R / C, 1 / n) : null;
    let bvDb = C;
    return [...Array(n)].map((_, i) => {
      const t = i + 1;
      const sl = base / n;
      const sy = (base * (n - t + 1)) / syd;
      const db = r == null ? null : bvDb * r;
      if (db != null) bvDb -= db;
      return { t, sl, sy, db };
    });
  }, [C, R, n]);

  const max = Math.max(...rows.flatMap((r) => [r.sl, r.sy, r.db || 0]));
  const methods = { sl: 'קו ישר', sy: 'סכום ספרות השנים', db: 'יתרה פוחתת' };
  const colors = { sl: '#0b80d0', sy: '#d97b06', db: '#7048e8' };
  const sy = Math.min(saleYear, n);
  const accum = rows.slice(0, sy).reduce((s, r) => s + (r[method] || 0), 0);
  const bookValue = C - accum;
  const gain = salePrice - bookValue;

  return (
    <div className="card lab">
      <h2 style={{ fontSize: 22 }}>מחשבון פחת – השוואת שלוש השיטות</h2>
      <p className="muted">סך הפחת לאורך החיים זהה בכל השיטות (C − R) – משתנה רק הפיזור בין השנים. פחת מואץ = הוצאה גבוהה ורווח נמוך בשנים הראשונות.</p>
      <div className="lab-layout">
        <div className="stack">
          <label className="field">עלות הנכס C (כולל הובלה והתקנה)<input className="input num" type="number" value={C} onChange={(e) => setC(Math.max(1, +e.target.value))} /></label>
          <label className="field">ערך שייר R<input className="input num" type="number" value={R} onChange={(e) => setR(Math.max(0, Math.min(C - 1, +e.target.value)))} /></label>
          <label className="field">אורך חיים n (שנים): <b className="num">{n}</b><input type="range" min={1} max={10} value={n} onChange={(e) => setN(+e.target.value)} /></label>
          <div className="callout">
            <div>סכום בר-פחת: <b className="num">{nis(C - R)}</b></div>
            {R > 0 && <div>שיעור יתרה פוחתת: <b className="num">{(100 * (1 - Math.pow(R / C, 1 / n))).toFixed(2)}%</b></div>}
          </div>
          <div className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
            <b>מכירת הנכס – רווח/הפסד הון</b>
            <label className="field" style={{ marginTop: 8 }}>שיטה
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                {Object.entries(methods).map(([k, v]) => <option key={k} value={k} disabled={k === 'db' && !R}>{v}</option>)}
              </select>
            </label>
            <label className="field">נמכר בסוף שנה: <b className="num">{sy}</b><input type="range" min={1} max={n} value={sy} onChange={(e) => setSaleYear(+e.target.value)} /></label>
            <label className="field">תמורה<input className="input num" type="number" value={salePrice} onChange={(e) => setSalePrice(+e.target.value)} /></label>
          </div>
        </div>
        <div className="stack">
          <svg viewBox="0 0 600 300" className="lab-svg">
            {rows.map((r, i) => {
              const gw = 520 / n;
              return (
                <g key={i}>
                  {['sl', 'sy', 'db'].map((k, j) => r[k] != null && (
                    <motion.rect key={k} x={50 + i * gw + j * (gw / 3.6) + gw * 0.08} width={gw / 4.2} rx={4} fill={colors[k]}
                      initial={{ height: 0, y: 260 }} animate={{ height: (r[k] / max) * 220, y: 260 - (r[k] / max) * 220 }} transition={{ type: 'spring', stiffness: 120, damping: 18, delay: i * 0.05 }} />
                  ))}
                  <text x={50 + i * gw + gw / 2} y={282} textAnchor="middle">שנה {r.t}</text>
                </g>
              );
            })}
            <line x1={45} x2={580} y1={260} y2={260} stroke="var(--text-3)" />
          </svg>
          <div className="row wrap" style={{ gap: 14, fontSize: 13 }}>
            {Object.entries(methods).map(([k, v]) => <span key={k} className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: colors[k] }} />{v}</span>)}
          </div>
          <table className="tbl">
            <thead><tr><th>שנה</th>{Object.values(methods).map((m) => <th key={m} className="num">{m}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.t}><td>{r.t}</td><td className="num">{nis(r.sl)}</td><td className="num">{nis(r.sy)}</td><td className="num">{r.db == null ? '—' : nis(r.db)}</td></tr>
              ))}
              <tr style={{ fontWeight: 700 }}><td>סה"כ</td><td className="num">{nis(C - R)}</td><td className="num">{nis(C - R)}</td><td className="num">{R ? nis(C - R) : '—'}</td></tr>
            </tbody>
          </table>
          <div className="callout" style={{ background: gain >= 0 ? 'var(--good-bg)' : 'var(--bad-bg)' }}>
            פחת נצבר עד המכירה: <b className="num">{nis(accum)}</b> · יתרה מופחתת: <b className="num">{nis(bookValue)}</b><br />
            {gain >= 0 ? 'רווח הון' : 'הפסד הון'}: <b className="num">{nis(Math.abs(gain))}</b> = תמורה {nis(salePrice)} − יתרה מופחתת {nis(bookValue)}
            {gain > 0 && <> · מס (23%): <b className="num">{nis(gain * 0.23)}</b></>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Accounting equation step-through (Mr. Shamir, unit 4) ---------------- */
const COLS = [
  { k: 'cash', l: 'מזומן', g: 'A' }, { k: 'inv', l: 'מלאי', g: 'A' }, { k: 'bld', l: 'מבנה', g: 'A' }, { k: 'cust', l: 'לקוחות', g: 'A' },
  { k: 'chq', l: 'המחאות לגבייה', g: 'A' }, { k: 'notes', l: 'שטרות לגבייה', g: 'A' }, { k: 'loan', l: 'הלוואה', g: 'L' }, { k: 'eq', l: 'זכויות בעלים', g: 'E' },
];
const TX = [
  { d: 'העסק קיבל מהבנק הלוואה בסך 100,000 ₪', e: { cash: 100000, loan: 100000 }, why: 'נכס מול התחייבות – שני הצדדים גדלים' },
  { d: 'רכישת מלאי ב-70,000 ₪ במזומן', e: { inv: 70000, cash: -70000 }, why: 'נכס מול נכס – סך המאזן לא משתנה' },
  { d: 'מר שמיר השקיע 90,000 ₪ במזומן', e: { cash: 90000, eq: 90000 }, why: 'השקעת בעלים מגדילה זכויות בעלים – אבל אינה הכנסה' },
  { d: 'רכישת מבנה ב-75,000 ₪ במזומן', e: { bld: 75000, cash: -75000 }, why: 'נכס מול נכס' },
  { d: 'מכירה במזומן: עלות 8,000, תמורה 26,000', e: { cash: 26000, inv: -8000, eq: 18000 }, why: 'שתי השפעות: הכנסה 26,000 וגריעת מלאי (עלות המכר) 8,000 → רווח 18,000' },
  { d: 'מכירה באשראי: עלות 6,000, תמורה 15,000', e: { cust: 15000, inv: -6000, eq: 9000 }, why: 'ההכנסה מוכרת עכשיו – גם בלי מזומן; נוצר נכס "לקוחות"' },
  { d: 'מכירה בהמחאה דחויה: עלות 8,000, תמורה 18,000', e: { chq: 18000, inv: -8000, eq: 10000 }, why: 'המחאות לגבייה הן נכס' },
  { d: 'מכירה תמורת שטר: עלות 17,000, תמורה 29,000', e: { notes: 29000, inv: -17000, eq: 12000 }, why: 'שטרות לגבייה הם נכס' },
  { d: 'מר שמיר מכר טלוויזיה פרטית ב-700 ₪', e: {}, why: 'פעולה פרטית – לפי הנחת הישות הנפרדת אין השפעה על העסק' },
  { d: 'פירעון הלוואה 10,000 ₪ במזומן', e: { cash: -10000, loan: -10000 }, why: 'התחייבות מול נכס – פירעון קרן אינו הוצאה' },
  { d: 'תשלום שכר לחודש יולי 4,000 ₪', e: { cash: -4000, eq: -4000 }, why: 'הוצאה מקטינה את זכויות הבעלים' },
  { d: 'מר שמיר משך 3,000 ₪ לצורכי הבית', e: { cash: -3000, eq: -3000 }, why: 'משיכת בעלים מקטינה את ההון – אבל אינה הוצאה ולא משפיעה על הרווח' },
];

export function EquationLab() {
  const [step, setStep] = useState(0);
  const bal = useMemo(() => {
    const b = Object.fromEntries(COLS.map((c) => [c.k, 0]));
    TX.slice(0, step).forEach((t) => Object.entries(t.e).forEach(([k, v]) => (b[k] += v)));
    return b;
  }, [step]);
  const last = TX[step - 1];
  const A = COLS.filter((c) => c.g === 'A').reduce((s, c) => s + bal[c.k], 0);
  const L = bal.loan, E = bal.eq;
  const Cell = ({ k }) => {
    const changed = last && last.e[k];
    return (
      <motion.div key={k + bal[k]} className="kpi" initial={changed ? { scale: 1.08, backgroundColor: changed > 0 ? 'rgba(18,151,106,.25)' : 'rgba(214,69,69,.22)' } : false} animate={{ scale: 1, backgroundColor: 'var(--surface-2)' }} transition={{ duration: 0.9 }}>
        <span>{COLS.find((c) => c.k === k).l}</span>
        <b className="num">{nis(bal[k])}</b>
        {changed ? <span className="num" style={{ color: changed > 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>{changed > 0 ? '▲' : '▼'} {nis(Math.abs(changed))}</span> : null}
      </motion.div>
    );
  };
  return (
    <div className="card lab">
      <h2 style={{ fontSize: 22 }}>הזהות החשבונאית בפעולה – העסק של מר שמיר</h2>
      <p className="muted">עברו פעולה אחר פעולה (מתוך יחידה 4) וראו איך כל פעולה משנה לפחות שני סעיפים – והשוויון נכסים = התחייבויות + הון נשמר תמיד.</p>
      <div className="row wrap" style={{ margin: '14px 0' }}>
        <button className="btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={!step}><ChevronRight size={16} /> הקודמת</button>
        <button className="btn accent" onClick={() => setStep((s) => Math.min(TX.length, s + 1))} disabled={step === TX.length}><Play size={15} /> פעולה {Math.min(step + 1, TX.length)}</button>
        <button className="btn ghost" onClick={() => setStep(0)}><RotateCcw size={15} /> איפוס</button>
        <div className="quiz-progress" style={{ minWidth: 120 }}><span style={{ width: `${(step / TX.length) * 100}%` }} /></div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={step} className="callout" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ minHeight: 56 }}>
          {last ? <><b>פעולה {step}: </b>{last.d}<br /><span className="muted">{last.why}</span></> : 'לחצו "פעולה 1" כדי להתחיל.'}
        </motion.div>
      </AnimatePresence>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr auto 1fr auto 1fr', gap: 12, alignItems: 'start', marginTop: 16 }}>
        <div><h4 style={{ marginBottom: 8 }}>נכסים</h4><div className="kpi-grid">{COLS.filter((c) => c.g === 'A').map((c) => <Cell key={c.k} k={c.k} />)}</div></div>
        <div style={{ fontSize: 30, fontWeight: 800, paddingTop: 50 }}>=</div>
        <div><h4 style={{ marginBottom: 8 }}>התחייבויות</h4><Cell k="loan" /></div>
        <div style={{ fontSize: 30, fontWeight: 800, paddingTop: 50 }}>+</div>
        <div><h4 style={{ marginBottom: 8 }}>הון</h4><Cell k="eq" /></div>
      </div>
      <motion.div className="row" style={{ justifyContent: 'center', marginTop: 20, gap: 14, fontSize: 20, fontFamily: 'var(--font-display)', fontWeight: 700 }} key={A} initial={{ scale: 0.95 }} animate={{ scale: 1 }}>
        <span className="num">{nis(A)}</span> = <span className="num">{nis(L)}</span> + <span className="num">{nis(E)}</span>
        <span className="chip good"><Check size={13} /> מאוזן</span>
      </motion.div>
      {step === TX.length && <div className="callout" style={{ marginTop: 14 }}>רווח יולי (הכנסות − עלות המכר − שכר): <span className="num">88,000 − 39,000 − 4,000 = <b>45,000</b></span>. זכויות הבעלים (השקעה + רווח − משיכה): <span className="num">90,000 + 45,000 − 3,000 = <b>132,000</b></span>.</div>}
    </div>
  );
}

/* ---------------- Journal entry trainer ---------------- */
const ACCOUNTS = ['מזומנים', 'לקוחות', 'ספקים', 'הון בעלים', 'משיכות בעלים', 'ריהוט משרדי', 'הכנסות', 'מקדמות מלקוחות (הכנסות מראש)', 'הוצאות מראש', 'הוצאות לשלם', 'הכנסות לקבל', 'הוצאות שכירות', 'הוצאות שכר', 'הוצאות פרסום', 'הוצאות צרכי משרד', 'הלוואה מהבנק', 'הוצאות פחת', 'פחת נצבר', 'הוצאות חובות מסופקים', 'הפרשה לחובות מסופקים'];
const JE = [
  { d: 'הבעלים השקיע בעסק 15,000 ₪ במזומן', dr: 'מזומנים', cr: 'הון בעלים', tip: 'השקעת בעלים – זכות הון, לא הכנסה' },
  { d: 'נרכשו רהיטי משרד ב-1,500 ₪ במזומן', dr: 'ריהוט משרדי', cr: 'מזומנים', tip: 'העסק קיבל רהיטים (חובה) ונתן מזומן (זכות)' },
  { d: 'שולמה שכירות לחודש הנוכחי במזומן', dr: 'הוצאות שכירות', cr: 'מזומנים', tip: 'הוצאה גדלה בחובה' },
  { d: 'נרכשו צרכי משרד באשראי (נוצלו החודש)', dr: 'הוצאות צרכי משרד', cr: 'ספקים', tip: 'רכישה באשראי – זכות ספקים' },
  { d: 'התקבלה מקדמה מלקוח עבור שירות בחודש הבא', dr: 'מזומנים', cr: 'מקדמות מלקוחות (הכנסות מראש)', tip: 'מקדמה היא התחייבות – לא הכנסה' },
  { d: 'ניתן שירות ללקוח, התשלום יתקבל בחודש הבא', dr: 'לקוחות', cr: 'הכנסות', tip: 'בסיס מצטבר: ההכנסה מוכרת עכשיו' },
  { d: 'הבעלים משך מזומן לצרכיו הפרטיים', dr: 'משיכות בעלים', cr: 'מזומנים', tip: 'משיכה אינה הוצאה' },
  { d: 'שולם לספק החוב על צרכי המשרד', dr: 'ספקים', cr: 'מזומנים', tip: 'פירעון התחייבות – לא הוצאה' },
  { d: 'שולם במזומן חשמל עבור החודש הבא', dr: 'הוצאות מראש', cr: 'מזומנים', tip: 'שולם – טרם נצרך → נכס שוטף' },
  { d: 'התאמה: שכר דירה לדצמבר ישולם רק בינואר', dr: 'הוצאות שכירות', cr: 'הוצאות לשלם', tip: 'נצרך – טרם שולם → התחייבות שוטפת' },
  { d: 'התאמה: שירות שניתן בדצמבר, החשבונית תצא בינואר', dr: 'הכנסות לקבל', cr: 'הכנסות', tip: 'ניתן השירות – טרם התקבל הכסף → נכס שוטף' },
  { d: 'רישום פחת שנתי על מכונה', dr: 'הוצאות פחת', cr: 'פחת נצבר', tip: 'פחת נצבר הוא חשבון קונטרה לנכס' },
  { d: 'הערכה ש-5% מהלקוחות לא ישלמו', dr: 'הוצאות חובות מסופקים', cr: 'הפרשה לחובות מסופקים', tip: 'שמרנות + הקבלה: מכירים בהפסד הצפוי כבר עכשיו' },
  { d: 'פירעון חלק מההלוואה מהבנק במזומן', dr: 'הלוואה מהבנק', cr: 'מזומנים', tip: 'החזר קרן מקטין נכס והתחייבות – לא הוצאה' },
];

export function JournalLab() {
  const [deck, setDeck] = useState(() => shuffle(JE));
  const [i, setI] = useState(0);
  const [dr, setDr] = useState('');
  const [cr, setCr] = useState('');
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState(0);
  const q = deck[i];
  const ok = dr === q?.dr && cr === q?.cr;
  const check = () => { setChecked(true); if (ok) setScore((s) => s + 1); };
  const next = () => { setI((x) => x + 1); setDr(''); setCr(''); setChecked(false); };
  if (!q) return (
    <div className="card lab result-hero">
      <h2>סיימתם! {score}/{deck.length} פקודות נכונות</h2>
      <button className="btn accent" style={{ marginTop: 14 }} onClick={() => { setDeck(shuffle(JE)); setI(0); setScore(0); }}><RotateCcw size={16} /> סבב חדש</button>
    </div>
  );
  return (
    <div className="card lab" style={{ maxWidth: 820 }}>
      <div className="row"><h2 style={{ fontSize: 22 }} className="grow">מאמן פקודות יומן</h2><span className="chip num">{i + 1}/{deck.length}</span><span className="chip good">{score} ✓</span></div>
      <p className="muted">נכסים והוצאות גדלים בחובה; התחייבויות, הון והכנסות גדלים בזכות. בחרו את החשבון בחובה ובזכות:</p>
      <AnimatePresence mode="wait">
        <motion.div key={i} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
          <div className="q-text">{q.d}</div>
          <div className="row wrap" style={{ alignItems: 'flex-end' }}>
            <label className="field grow">ח׳ (חובה)
              <select className="input" value={dr} disabled={checked} onChange={(e) => setDr(e.target.value)} style={checked ? { borderColor: dr === q.dr ? 'var(--good)' : 'var(--bad)' } : undefined}>
                <option value="">בחרו חשבון…</option>{ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
            <label className="field grow">ז׳ (זכות)
              <select className="input" value={cr} disabled={checked} onChange={(e) => setCr(e.target.value)} style={checked ? { borderColor: cr === q.cr ? 'var(--good)' : 'var(--bad)' } : undefined}>
                <option value="">בחרו חשבון…</option>{ACCOUNTS.map((a) => <option key={a}>{a}</option>)}
              </select>
            </label>
            {!checked ? <button className="btn accent" disabled={!dr || !cr} onClick={check}>בדיקה</button> : <button className="btn primary" onClick={next}>הבאה <ChevronLeft size={16} /></button>}
          </div>
          {checked && (
            <motion.div className="explain" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <div style={{ fontWeight: 700, color: ok ? 'var(--good)' : 'var(--bad)' }}>{ok ? <><Check size={15} /> נכון!</> : <><X size={15} /> הפקודה הנכונה:</>}</div>
              <div className="num" style={{ direction: 'rtl', margin: '6px 0' }}>ח׳ {q.dr} &nbsp;/&nbsp; ז׳ {q.cr}</div>
              <div className="muted">{q.tip}</div>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ---------------- Financial ratios ---------------- */
const DEFAULTS = { ca: 30000, inv: 7000, invOpen: 3000, cl: 17600, tl: 66600, eq: 48400, ta: 115000, sales: 100000, gp: 40000, op: 19000, ni: 15400, shares: 2000, price: 77, cogs: 60000, ar: 18000, purch: 64000, ap: 6000 };
const LABELS = { ca: 'רכוש שוטף', inv: 'מלאי סגירה', invOpen: 'מלאי פתיחה', cl: 'התחייבויות שוטפות', tl: 'סך התחייבויות', eq: 'הון עצמי', ta: 'סך נכסים', sales: 'מכירות', gp: 'רווח גולמי', op: 'רווח הפעלה', ni: 'רווח נקי', shares: 'מספר מניות', price: 'מחיר מניה', cogs: 'עלות המכירות', ar: 'לקוחות', purch: 'קניות', ap: 'ספקים' };

export function RatiosLab() {
  const [v, setV] = useState(DEFAULTS);
  const r = useMemo(() => {
    const avgInv = (v.inv + v.invOpen) / 2;
    const invDays = 365 / (v.cogs / avgInv);
    const arDays = 365 / (v.sales / v.ar);
    const apDays = 365 / (v.purch / v.ap);
    const eps = v.ni / v.shares;
    return [
      { g: 'נזילות', n: 'יחס שוטף', val: v.ca / v.cl, f: (x) => x.toFixed(2), good: (x) => x >= 1.2, note: 'כמה ש"ח נכסים שוטפים על כל ש"ח התחייבות שוטפת' },
      { g: 'נזילות', n: 'יחס מהיר', val: (v.ca - v.inv) / v.cl, f: (x) => x.toFixed(2), good: (x) => x >= 1, note: 'בלי המלאי – הנכס השוטף הפחות נזיל' },
      { g: 'נזילות', n: 'הון חוזר', val: v.ca - v.cl, f: (x) => nis(x) + ' ₪', good: (x) => x > 0, note: 'כרית ביטחון לפעילות השוטפת' },
      { g: 'יציבות', n: 'הון עצמי ÷ נכסים', val: v.eq / v.ta, f: (x) => (x * 100).toFixed(1) + '%', good: (x) => x >= 0.3, note: 'החלק מהנכסים שממומן בכסף של הבעלים' },
      { g: 'יציבות', n: 'התחייבויות ÷ נכסים', val: v.tl / v.ta, f: (x) => (x * 100).toFixed(1) + '%', good: (x) => x <= 0.7, note: 'החלק שממומן בכסף של אחרים' },
      { g: 'רווחיות', n: 'שיעור רווח גולמי', val: v.gp / v.sales, f: (x) => (x * 100).toFixed(1) + '%', good: (x) => x > 0.25, note: 'מה נשאר מכל שקל אחרי עלות המוצר' },
      { g: 'רווחיות', n: 'שיעור רווח תפעולי', val: v.op / v.sales, f: (x) => (x * 100).toFixed(1) + '%', good: (x) => x > 0.08, note: 'כמה מרוויחה הפעילות העסקית עצמה' },
      { g: 'רווחיות', n: 'שיעור רווח נקי', val: v.ni / v.sales, f: (x) => (x * 100).toFixed(1) + '%', good: (x) => x > 0.05, note: 'מה נשאר לבעלים מכל שקל מכירות' },
      { g: 'רווחיות', n: 'תשואה על ההון', val: v.ni / v.eq, f: (x) => (x * 100).toFixed(1) + '%', good: (x) => x > 0.1, note: 'כמה הרוויח כל שקל שהשקיעו הבעלים' },
      { g: 'רווחיות', n: 'רווח למניה', val: eps, f: (x) => x.toFixed(2) + ' ₪', good: () => true, note: 'רווח נקי ÷ מספר מניות' },
      { g: 'רווחיות', n: 'מכפיל רווח', val: v.price / eps, f: (x) => x.toFixed(1), good: () => true, note: 'בכמה שנים "יחזירו" המשקיעים את ההשקעה' },
      { g: 'יעילות', n: 'ימי מלאי', val: invDays, f: (x) => Math.round(x) + ' ימים', good: () => true, note: '365 ÷ (עלות המכירות ÷ מלאי ממוצע)' },
      { g: 'יעילות', n: 'ימי לקוחות', val: arDays, f: (x) => Math.round(x) + ' ימים', good: (x) => x <= apDays + 30, note: '365 ÷ (מכירות ÷ לקוחות)' },
      { g: 'יעילות', n: 'ימי ספקים', val: apDays, f: (x) => Math.round(x) + ' ימים', good: () => true, note: '365 ÷ (קניות ÷ ספקים)' },
      { g: 'יעילות', n: 'מחזור המזומנים', val: invDays + arDays - apDays, f: (x) => Math.round(x) + ' ימים', good: (x) => x < 60, note: 'מלאי + לקוחות − ספקים: כמה ימים החברה מממנת בעצמה' },
    ];
  }, [v]);
  const groups = [...new Set(r.map((x) => x.g))];
  return (
    <div className="card lab">
      <div className="row"><h2 style={{ fontSize: 22 }} className="grow">מנתח יחסים פיננסיים</h2><button className="btn sm" onClick={() => setV(DEFAULTS)}><RotateCcw size={14} /> נתוני "אור השמש"</button></div>
      <p className="muted">הנתונים ההתחלתיים לקוחים מהדוחות של אור השמש בע"מ (יחידה 9). שנו מספר וראו מה זז. יחס פיננסי הוא נקודת פתיחה לשאלות – לא תשובה סופית.</p>
      <div className="lab-layout">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {Object.keys(DEFAULTS).map((k) => (
            <label key={k} className="field" style={{ fontSize: 12.5 }}>{LABELS[k]}<input className="input num" style={{ height: 36 }} type="number" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) || 0 })} /></label>
          ))}
        </div>
        <div className="stack">
          {groups.map((g) => (
            <div key={g}>
              <h4 style={{ marginBottom: 8 }}>{g}</h4>
              <div className="kpi-grid">
                {r.filter((x) => x.g === g).map((x) => (
                  <motion.div key={x.n} className="kpi" layout title={x.note} style={{ borderInlineStart: `3px solid ${x.good(x.val) ? 'var(--good)' : 'var(--warn)'}` }}>
                    <span>{x.n}</span>
                    <motion.b key={x.f(x.val)} initial={{ opacity: 0.3, y: -4 }} animate={{ opacity: 1, y: 0 }} className="num">{isFinite(x.val) ? x.f(x.val) : '—'}</motion.b>
                    <span style={{ fontSize: 11.5 }}>{x.note}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
