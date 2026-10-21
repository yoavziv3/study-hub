import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Gauge, Loader2, RefreshCw, CalendarClock, GraduationCap, BookOpen, Sparkles, ShieldCheck } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, useFetch, STATIC } from '../api.js';
import { Page, fadeUp } from '../components/ui.jsx';

const LEVEL_CHIP = { light: 'good', medium: 'warn', heavy: 'bad', free: '' };
const DAY_LABEL = { free: 'פנוי', light: 'קל', medium: 'בינוני', heavy: 'עמוס' };
const ITEM = {
  deadline: { icon: CalendarClock, label: 'הגשה' },
  exam: { icon: GraduationCap, label: 'מבחן' },
  quiz: { icon: GraduationCap, label: 'בוחן' },
};
const ddmm = (date) => `${Number(date.slice(8, 10))}.${Number(date.slice(5, 7))}`;

/** The weekly load report (server/lib/weekly.js): the week day by day, per-course advice, and an archive. */
export default function Weekly() {
  const { setContext, courses, toast } = useApp();
  const { data, loading, error, reload } = useFetch('/api/weekly');
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setContext({}); }, [setContext]);
  const report = data?.[pick];
  const colorOf = (id) => courses.find((c) => c.id === id)?.color;

  const runNow = async () => {
    setBusy(true);
    try {
      await api.post('/api/weekly/run', {});
      setPick(0);
      reload();
      toast('הדוח עודכן');
    } catch (e) {
      toast(e.message, 'info');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon"><Gauge size={22} /></div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>דוח עומס שבועי</h1>
            <div className="muted" style={{ fontSize: 14 }}>כל יום ראשון בבוקר: ההגשות, המבחנים והבחנים של השבוע, החומר החדש, ועצה קצרה לכל קורס.</div>
          </div>
          {data?.length > 1 && (
            <select className="input" style={{ width: 'auto' }} value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label="שבוע">
              {data.map((r, i) => <option key={r.week} value={i}>שבוע {r.range}</option>)}
            </select>
          )}
          {!STATIC && <button className="btn sm" disabled={busy} onClick={runNow}>{busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} הפקה עכשיו</button>}
        </div>
      </motion.div>

      {loading && <div style={{ padding: 40, textAlign: 'center' }}><Loader2 className="spin" /></div>}
      {error && <div className="callout" style={{ marginTop: 14 }}>{error}</div>}
      {data && !report && <div className="empty"><div className="empty-icon"><Gauge size={28} /></div><h2>עוד אין דוח</h2><p>הדוח הראשון ייצא ביום ראשון הקרוב בבוקר.</p></div>}

      {report && (
        <>
          <motion.div className="card pad" style={{ marginTop: 16 }} variants={fadeUp} initial="hidden" animate="show">
            <div className="row wrap" style={{ gap: 8 }}>
              <span className={`chip ${LEVEL_CHIP[report.level]}`} style={{ fontWeight: 700 }}>{report.levelLabel}</span>
              <span className="chip">שבוע {report.range}</span>
              {report.busiest && <span className="chip">היום העמוס: {report.days.find((d) => d.date === report.busiest)?.weekday} {ddmm(report.busiest)}</span>}
            </div>
            <div style={{ fontSize: 18, fontWeight: 650, marginTop: 10 }}>{report.headline}</div>
          </motion.div>

          <div className="section-title"><h2>השבוע, יום אחרי יום</h2><div className="line" /></div>
          <div className="stack" style={{ gap: 8 }}>
            {report.days.map((d) => (
              <div key={d.date} className="card pad row wrap" style={{ gap: 12, padding: '12px 16px', alignItems: 'flex-start' }}>
                <div style={{ width: 92 }}>
                  <div style={{ fontWeight: 700 }}>יום {d.weekday}</div>
                  <div className="faint" style={{ fontSize: 13 }}>{ddmm(d.date)}</div>
                </div>
                <div className="grow stack" style={{ gap: 4, minWidth: 200 }}>
                  {d.items.length === 0 && <span className="faint">אין הגשות או מבחנים</span>}
                  {d.items.map((it, i) => {
                    const I = ITEM[it.type] || ITEM.deadline;
                    return (
                      <div key={i} className="row" style={{ gap: 8 }} data-color={colorOf(it.courseId)}>
                        <I.icon size={15} />
                        <span className="chip c">{courses.find((c) => c.id === it.courseId)?.short || it.courseId}</span>
                        <span>{I.label}: {it.title}</span>
                        {it.time && <span className="faint" style={{ fontSize: 13 }}>{it.time}</span>}
                      </div>
                    );
                  })}
                </div>
                <span className={`chip ${LEVEL_CHIP[d.level]}`}>{DAY_LABEL[d.level]}</span>
              </div>
            ))}
          </div>

          <div className="section-title"><h2>לכל קורס</h2><div className="line" /></div>
          <div className="stack" style={{ gap: 10 }}>
            {report.courses.map((c) => (
              <div key={c.courseId} className="card pad" data-color={colorOf(c.courseId)}>
                <div className="row wrap" style={{ gap: 8 }}>
                  <Link to={`/course/${c.courseId}`} style={{ fontWeight: 700, fontSize: 16 }}>{c.short}</Link>
                  {c.deadlines > 0 && <span className="chip warn">{c.deadlines === 1 ? 'הגשה אחת' : `${c.deadlines} הגשות`}</span>}
                  {c.exams > 0 && <span className="chip bad">{c.exams === 1 ? 'מבחן או בוחן' : `${c.exams} מבחנים ובחנים`}</span>}
                  {c.soon.map((s) => <span key={s.date} className="chip">{s.quiz ? 'בוחן' : s.label} ב {ddmm(s.date)}</span>)}
                </div>
                <div style={{ marginTop: 8 }}>
                  {c.adviceBy === 'ai' && <Sparkles size={13} className="faint" style={{ marginInlineEnd: 4 }} />}
                  {c.advice}
                </div>
                {c.newMaterial.length > 0 && (
                  <div className="faint row wrap" style={{ gap: 6, marginTop: 6, fontSize: 13 }}>
                    <BookOpen size={13} /> חומר חדש: {c.newMaterial.join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="faint row wrap" style={{ gap: 6, marginTop: 16, fontSize: 12.5 }}>
            <ShieldCheck size={13} />
            התאריכים והעומס מחושבים בכללים קבועים. ה AI כתב רק את הניסוח{report.headlineBy === 'ai' ? '' : ' (הפעם הכותרת בנוסח קבוע)'}, והוא עבר בדיקות קבועות{report.checks?.length ? `: ${report.checks.join(' · ')}` : ' בלי ממצאים'}.
            · הופק {new Date(report.generatedAt).toLocaleString('he-IL', { weekday: 'long', hour: '2-digit', minute: '2-digit' })}
          </div>
        </>
      )}
    </Page>
  );
}
