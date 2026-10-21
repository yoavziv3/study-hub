import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Calculator, Plus, Trash2, Target, ChevronDown, FileText, Award, Download, Check } from 'lucide-react';
import { useApp } from '../store.jsx';
import { useFetch, STATIC } from '../api.js';
import { Page, fadeUp, CourseIcon, safeHref } from '../components/ui.jsx';
import { termsOf, termLabel, termKey, SEMESTER_LABEL, hebrewYear } from '../lib/terms.js';
import { gradeRows, average, needed, num, fmtAvg, ceil1, moodlePercent, withMoodleGrade, usesMoodleGrade } from '../lib/grades.js';

const OWN = ['name', 'credits', 'final', 'pass'];
const newId = () => `x-${Math.random().toString(36).slice(2, 9)}`;
const parseTerm = (key) => {
  const [year, semester] = String(key).split('-').map(Number);
  return year ? { year, semester } : null;
};
const cmpKey = (a, b) => {
  const x = parseTerm(a) || { year: 0, semester: 0 };
  const y = parseTerm(b) || { year: 0, semester: 0 };
  return x.year - y.year || x.semester - y.semester;
};

/** A number field that keeps what the student is typing ("8", "85.", "") and saves parsed values. */
function NumField({ value, onChange, min = 0, max = 100, step = 'any', placeholder = '—', width = 76, label }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => { if (num(text) !== (value ?? null)) setText(value ?? ''); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      className="input sm num"
      style={{ width, textAlign: 'center' }}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const v = num(e.target.value);
        if (e.target.value === '' || (v != null && v >= min && v <= max)) onChange(v);
      }}
    />
  );
}

export default function Grades() {
  const { allCourses, progress, updateGrades, setContext } = useApp();
  useEffect(() => { setContext({}); }, [setContext]);
  // In the cloud, Moodle's running course total is offered as a hint next to each course.
  const { data: moodleGrades } = useFetch(STATIC ? '/api/me/grades' : null);
  const moodleOf = useMemo(() => Object.fromEntries((moodleGrades || []).filter((g) => g.grade && g.grade !== '-').map((g) => [g.courseId, g.grade])), [moodleGrades]);

  const rows = useMemo(() => gradeRows(allCourses, progress), [allCourses, progress]);
  const terms = useMemo(() => {
    const keys = new Set(rows.map((r) => r.termKey));
    return [...keys].sort(cmpKey).reverse();
  }, [rows]);
  const siteTerms = useMemo(() => termsOf(allCourses), [allCourses]);
  const total = average(rows);

  // Extra courses keep their own name / credits / grade; the calculator's data lives in grades for every course.
  const setEntry = (key, patch) => updateGrades((p) => {
    const extra = p.extraCourses.find((x) => x.id === key);
    for (const [k, v] of Object.entries(patch)) {
      if (extra && OWN.includes(k)) extra[k] = v;
      else p.grades[key] = { ...p.grades[key], [k]: v };
    }
  });
  const removeExtra = (key) => updateGrades((p) => {
    p.extraCourses = p.extraCourses.filter((x) => x.id !== key);
    delete p.grades[key];
  });

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon" style={{ background: 'linear-gradient(135deg,#6d5efc,#3aa6ff)' }}><Calculator size={22} /></div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>ציונים וממוצע</h1>
            <div className="muted" style={{ fontSize: 14 }}>מזינים ציון סופי לכל קורס, והממוצע המשוקלל לפי נקודות הזכות מחושב לבד – לכל סמסטר ומצטבר. בכל קורס אפשר לחשב כמה צריך במבחן.</div>
          </div>
        </div>
        <div className="kpi-grid" style={{ marginTop: 18 }}>
          <div className="kpi grade-kpi"><b className="num">{fmtAvg(total.avg)}</b><span>ממוצע מצטבר</span></div>
          <div className="kpi"><b className="num">{total.earned}</b><span>נק״ז שנצברו</span></div>
          <div className="kpi"><b className="num">{total.counted}</b><span>נק״ז בממוצע ({total.n} קורסים)</span></div>
          {terms.slice(0, 3).map((k) => {
            const t = average(rows.filter((r) => r.termKey === k));
            return t.avg != null && <div key={k} className="kpi"><b className="num">{fmtAvg(t.avg)}</b><span>{termName(k, siteTerms)}</span></div>;
          })}
        </div>
        <p className="faint" style={{ fontSize: 12.5, marginBottom: 0 }}>הציונים נשמרים רק אצלך (עם ההתקדמות שלך) ולא נשלחים לאף אחד. קורס "עובר" נספר בנק״ז אבל לא בממוצע.</p>
      </motion.div>

      {terms.map((k) => {
        const list = rows.filter((r) => r.termKey === k);
        const t = average(list);
        return (
          <section key={k}>
            <div className="section-title">
              <h2>{termName(k, siteTerms)}</h2>
              <div className="line" />
              <span className="chip c">ממוצע <b className="num">{fmtAvg(t.avg)}</b></span>
              <span className="chip">{t.counted + list.filter((r) => r.pass && r.credits).reduce((s, r) => s + r.credits, 0)} נק״ז</span>
            </div>
            <div className="stack" style={{ gap: 10 }}>
              {list.map((r, i) => (
                <CourseGrade key={r.key} row={r} i={i} moodle={moodleOf[r.key]} onChange={(patch) => setEntry(r.key, patch)} onRemove={r.extra ? () => removeExtra(r.key) : null} />
              ))}
            </div>
          </section>
        );
      })}

      <AddCourse siteTerms={siteTerms} known={terms} onAdd={(c) => updateGrades((p) => { p.extraCourses.push({ id: newId(), ...c }); })} />
    </Page>
  );
}

function termName(key, siteTerms) {
  const t = parseTerm(key);
  if (!t) return 'ללא סמסטר';
  // "שנה א׳ · סמסטר א׳ · תשפ״ז" from the first year on the site; earlier terms without the study year.
  return siteTerms.length && t.year >= siteTerms[0].year ? termLabel(t, siteTerms) : `${SEMESTER_LABEL[t.semester]} · ${hebrewYear(t.year)}`;
}

function CourseGrade({ row, i, moodle, onChange, onRemove }) {
  const [open, setOpen] = useState(false);
  const c = row.course;
  const low = row.final != null && row.final < (num(c?.passGrade) || 56);
  return (
    <motion.div className="card grade-row" data-color={c?.color} variants={fadeUp} initial="hidden" animate="show" custom={i % 10}>
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="course-icon sm">{c ? <CourseIcon name={c.icon} size={17} /> : <Award size={17} />}</div>
        <div className="grow" style={{ minWidth: 140 }}>
          {row.extra ? (
            <input className="input sm" style={{ width: '100%', fontWeight: 700 }} value={row.name} aria-label="שם הקורס" onChange={(e) => onChange({ name: e.target.value })} />
          ) : (
            <div style={{ fontWeight: 700 }}>{row.name}</div>
          )}
          {moodle && row.final == null && (
            <button className="faint grade-hint" onClick={() => onChange({ final: num(moodle) })} title="להעתיק כציון סופי">במודל עד כה: <b className="num">{moodle}</b></button>
          )}
        </div>
        <label className="grade-field">
          <span>נק״ז</span>
          <NumField value={row.credits} max={30} step={0.5} width={64} label={`נקודות זכות – ${row.name}`} placeholder={row.catalogCredits ? String(row.catalogCredits) : '?'} onChange={(v) => onChange({ credits: v })} />
        </label>
        <label className="grade-field">
          <span>ציון סופי</span>
          {row.pass ? <span className="chip good" style={{ height: 30 }}>עובר</span> : (
            <span className={low ? 'grade-low' : ''}><NumField value={row.final} label={`ציון סופי – ${row.name}`} onChange={(v) => onChange({ final: v })} /></span>
          )}
        </label>
        <label className="row faint" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={row.pass} onChange={(e) => onChange({ pass: e.target.checked })} /> עובר/נכשל
        </label>
        <button className={`btn sm ${open ? 'accent' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Target size={14} /> כמה צריך במבחן?
          <motion.span animate={{ rotate: open ? 180 : 0 }} style={{ display: 'grid' }}><ChevronDown size={14} /></motion.span>
        </button>
        {onRemove && <button className="btn sm icon ghost danger" onClick={onRemove} aria-label="הסרת הקורס"><Trash2 size={14} /></button>}
      </div>
      {!row.credits && !row.pass && row.final != null && <div className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>הוסיפו נק״ז כדי שהקורס ייכנס לממוצע.</div>}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            <ExamCalculator row={row} onChange={onChange} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const DEFAULT_COMPONENTS = () => [
  { id: newId(), name: 'תרגילי בית', weight: 10, grade: null },
  { id: newId(), name: 'מבחן סופי', weight: 90, grade: null },
];

function ExamCalculator({ row, onChange }) {
  const e = row.entry;
  const c = row.course;
  const pass = num(c?.passGrade) || 56;
  const [fallback] = useState(DEFAULT_COMPONENTS); // until the first edit saves the list
  const components = e.components?.length ? e.components : fallback;
  const target = num(e.target) ?? pass;
  const { data: links } = useFetch(c ? `/api/courses/${c.id}/links` : null);
  const syllabus = (links || []).find((l) => l.type === 'syllabus');
  // Grades already in Moodle (homework, quizzes…) fill the matching components, or are added as new ones.
  const { data: moodle } = useFetch(c ? `/api/me/grades/${c.id}` : null);
  const graded = (moodle?.items || []).filter((g) => !g.total && moodlePercent(g) != null);

  const setComponents = (list) => onChange({ components: list });
  const edit = (id, patch) => setComponents(components.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const r = needed(components, target, e.minExam);
  const targets = [...new Set([pass, 70, 80, 90])].sort((a, b) => a - b);

  return (
    <div className="exam-calc">
      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        <b className="grow">רכיבי הציון (לפי הסילבוס)</b>
        {safeHref(syllabus?.href) && <a className="btn sm ghost" href={safeHref(syllabus.href)} target="_blank" rel="noreferrer"><FileText size={14} /> פתיחת הסילבוס</a>}
      </div>
      <div className="calc-rows">
        <div className="calc-head faint"><span>רכיב</span><span>משקל %</span><span>ציון</span><span /></div>
        {components.map((x) => (
          <div key={x.id} className="calc-row">
            <input className="input sm" value={x.name} aria-label="שם הרכיב" onChange={(ev) => edit(x.id, { name: ev.target.value })} />
            <NumField value={num(x.weight)} label={`משקל – ${x.name}`} width={70} onChange={(v) => edit(x.id, { weight: v })} />
            <NumField value={num(x.grade)} label={`ציון – ${x.name}`} width={70} placeholder="טרם" onChange={(v) => edit(x.id, { grade: v })} />
            <button className="btn sm icon ghost" onClick={() => setComponents(components.filter((y) => y.id !== x.id))} aria-label="הסרת רכיב" disabled={components.length < 2}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setComponents([...components, { id: newId(), name: 'רכיב נוסף', weight: 0, grade: null }])}><Plus size={14} /> רכיב</button>
      {graded.length > 0 && (
        <div className="moodle-grades">
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="faint grow" style={{ fontSize: 13 }}>ציונים שכבר במודל – לחיצה מכניסה אותם לרכיב באותו שם (או מוסיפה רכיב, ואז משלימים משקל):</span>
            <button className="btn sm ghost" onClick={() => setComponents(graded.reduce((list, g) => withMoodleGrade(list, g, newId), components))}><Download size={14} /> הכנסת כולם</button>
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {graded.map((g) => {
              const used = usesMoodleGrade(components, g);
              return (
                <button key={g.name} className={`chip ${used ? 'good' : ''}`} onClick={() => setComponents(withMoodleGrade(components, g, newId))}>
                  {used && <Check size={12} />} {g.name} · <b className="num">{ceil1(moodlePercent(g))}</b>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {r.total !== 100 && <div className="chip warn" style={{ marginTop: 8 }}>סכום המשקלות {r.total}% – צריך להגיע ל־100%</div>}

      <div className="row wrap" style={{ gap: 14, marginTop: 14 }}>
        <label className="grade-field"><span>ציון סופי רצוי</span><NumField value={target} label="ציון סופי רצוי" onChange={(v) => onChange({ target: v })} /></label>
        <div className="row wrap" style={{ gap: 6 }}>
          {targets.map((t) => (
            <button key={t} className={`chip ${t === target ? 'c' : ''}`} onClick={() => onChange({ target: t })}>{t === pass ? `עובר (${t})` : t}</button>
          ))}
        </div>
        <label className="grade-field"><span>מינימום במבחן</span><NumField value={num(e.minExam)} placeholder="אין" label="ציון מינימלי במבחן" onChange={(v) => onChange({ minExam: v })} /></label>
      </div>

      <div className="callout calc-result">
        {r.need == null ? (
          <div className="row wrap" style={{ gap: 10 }}>
            <span className="grow">כל הרכיבים קיבלו ציון: הציון המשוקלל הוא <b className="num">{ceil1(r.final)}</b>.</span>
            {row.final !== Math.round(r.final) && <button className="btn sm accent" onClick={() => onChange({ final: Math.round(r.final) })}>שמירה כציון הסופי ({Math.round(r.final)})</button>}
          </div>
        ) : r.impossible ? (
          <span>גם עם 100 בכל מה שנשאר תגיעו ל־<b className="num">{ceil1(r.best)}</b> – הציון {target} כבר לא אפשרי.</span>
        ) : r.secured ? (
          <span>כבר הבטחתם {target}: גם עם 0 במה שנשאר הציון יהיה <b className="num">{ceil1(r.known)}</b>.</span>
        ) : (
          <span>כדי לסיים עם <b>{target}</b> צריך לפחות <b className="calc-need num">{ceil1(r.need)}</b> {r.rest < r.total && components.filter((x) => num(x.grade) == null).length > 1 ? 'בכל אחד מהרכיבים שנותרו' : 'במבחן'}.</span>
        )}
      </div>
      {r.need != null && (
        <div className="row wrap" style={{ gap: 6, marginTop: 8, fontSize: 13 }}>
          <span className="faint">לפי יעד:</span>
          {targets.map((t) => {
            const x = needed(components, t, e.minExam);
            return <span key={t} className={`chip ${x.impossible ? 'bad' : ''}`}>ל־{t}: {x.impossible ? 'לא אפשרי' : ceil1(Math.max(0, x.need))}</span>;
          })}
        </div>
      )}
    </div>
  );
}

function AddCourse({ siteTerms, known, onAdd }) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => {
    const base = siteTerms.length ? siteTerms : [{ year: new Date().getFullYear() + (new Date().getMonth() >= 7 ? 1 : 0), semester: 1 }];
    const first = base[0];
    const out = new Map();
    // A few earlier terms too, for courses from before the site (or another institution).
    for (let y = first.year - 3; y <= base.at(-1).year + 1; y++) for (const s of [1, 2, 3]) out.set(`${y}-${s}`, { year: y, semester: s });
    return [...out.keys()].sort(cmpKey).reverse();
  }, [siteTerms]);
  const [form, setForm] = useState({ name: '', credits: '', final: '', termKey: known[0] || options[0] });
  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onAdd({ name: form.name.trim(), credits: num(form.credits), final: num(form.final), pass: false, termKey: form.termKey });
    setForm((f) => ({ ...f, name: '', credits: '', final: '' }));
  };
  const label = (k) => {
    const t = parseTerm(k);
    return `${SEMESTER_LABEL[t.semester]} · ${hebrewYear(t.year)}`;
  };
  return (
    <div style={{ marginTop: 22 }}>
      {!open ? (
        <button className="btn" onClick={() => setOpen(true)}><Plus size={16} /> הוספת קורס שלא מופיע באתר</button>
      ) : (
        <form className="card pad add-course" onSubmit={submit}>
          <b>קורס נוסף (למשל מסמסטר קודם)</b>
          <div className="row wrap" style={{ gap: 10, marginTop: 10 }}>
            <input className="input sm" style={{ flex: '2 1 180px', height: 36 }} placeholder="שם הקורס" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="input sm num" style={{ flex: '1 1 80px', height: 36 }} type="number" inputMode="decimal" min={0} max={30} step={0.5} placeholder='נק"ז' value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} />
            <input className="input sm num" style={{ flex: '1 1 80px', height: 36 }} type="number" inputMode="decimal" min={0} max={100} placeholder="ציון" value={form.final} onChange={(e) => setForm({ ...form, final: e.target.value })} />
            <select className="input sm" style={{ flex: '2 1 160px', height: 36 }} value={form.termKey} onChange={(e) => setForm({ ...form, termKey: e.target.value })} aria-label="סמסטר">
              {options.map((k) => <option key={k} value={k}>{label(k)}</option>)}
            </select>
            <button className="btn accent sm" style={{ height: 36 }} type="submit"><Plus size={14} /> הוספה</button>
            <button className="btn ghost sm" style={{ height: 36 }} type="button" onClick={() => setOpen(false)}>סגירה</button>
          </div>
        </form>
      )}
    </div>
  );
}
