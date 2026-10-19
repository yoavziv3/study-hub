import { useMemo, useState } from 'react';
import { motion } from 'motion/react';

const fmt = (n, d = 2) => (Number.isInteger(n) ? n : Number(n.toFixed(d)));

/* Shared simple chart frame (LTR coordinates, Hebrew labels). */
export function Frame({ W = 560, H = 400, P = 50, xMax, yMax, xLabel, yLabel, children, onClick }) {
  const sx = (x) => P + (x / xMax) * (W - P - 20);
  const sy = (y) => H - P - (y / yMax) * (H - P - 20);
  const ticks = (max) => [...Array(6)].map((_, i) => (max * i) / 5);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="lab-svg" style={{ direction: 'ltr' }} onClick={onClick && ((e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const py = ((e.clientY - r.top) / r.height) * H;
      onClick({ x: ((px - P) / (W - P - 20)) * xMax, y: ((H - P - py) / (H - P - 20)) * yMax });
    })}>
      {ticks(xMax).map((t) => (
        <g key={'x' + t}>
          <line x1={sx(t)} x2={sx(t)} y1={sy(0)} y2={sy(yMax)} stroke="var(--border)" strokeDasharray="3 4" />
          <text x={sx(t)} y={H - P + 18} textAnchor="middle">{fmt(t, 1)}</text>
        </g>
      ))}
      {ticks(yMax).map((t) => (
        <g key={'y' + t}>
          <line x1={sx(0)} x2={sx(xMax)} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeDasharray="3 4" />
          <text x={P - 8} y={sy(t) + 4} textAnchor="end">{fmt(t, 1)}</text>
        </g>
      ))}
      <line x1={sx(0)} x2={sx(xMax)} y1={sy(0)} y2={sy(0)} stroke="var(--text-3)" />
      <line x1={sx(0)} x2={sx(0)} y1={sy(0)} y2={sy(yMax)} stroke="var(--text-3)" />
      <text x={W - 20} y={H - 12} textAnchor="end" style={{ fontWeight: 700 }}>{xLabel}</text>
      <text x={P + 6} y={14} style={{ fontWeight: 700 }}>{yLabel}</text>
      {children({ sx, sy })}
    </svg>
  );
}

function Num({ label, value, onChange, min = 0, max = 100, step = 1 }) {
  return (
    <label className="field">
      <div className="row"><span className="grow">{label}</span><b className="num" style={{ color: 'var(--c)' }}>{value}</b></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/* ---------------- PPF with substitutable workers + small open economy ---------------- */
export function PPFLab() {
  const [workers, setWorkers] = useState([
    { name: "עובד א'", x: 10, y: 20, h: 10 },
    { name: "עובד ב'", x: 5, y: 5, h: 10 },
  ]);
  const [point, setPoint] = useState(null);
  const [trade, setTrade] = useState(false);
  const [p, setP] = useState(3);

  const calc = useMemo(() => {
    const ws = workers.map((w) => ({ ...w, X: w.x * w.h, Y: w.y * w.h, oc: w.y / w.x }));
    const sorted = [...ws].sort((a, b) => a.oc - b.oc); // cheapest X producer first
    const Ymax = ws.reduce((s, w) => s + w.Y, 0);
    const Xmax = ws.reduce((s, w) => s + w.X, 0);
    const pts = [{ x: 0, y: Ymax }];
    let x = 0, y = Ymax;
    for (const w of sorted) { x += w.X; y -= w.Y; pts.push({ x, y }); }
    const yAt = (X) => {
      for (let i = 1; i < pts.length; i++) {
        if (X <= pts[i].x + 1e-9) {
          const a = pts[i - 1], b = pts[i];
          return a.y + ((X - a.x) / (b.x - a.x || 1)) * (b.y - a.y);
        }
      }
      return 0;
    };
    // Small open economy: specialise in X wherever its opportunity cost is below the world price.
    let px = 0, py = 0;
    for (const w of ws) { if (w.oc <= p) px += w.X; else py += w.Y; }
    return { ws, sorted, pts, Xmax, Ymax, yAt, prod: { x: px, y: py } };
  }, [workers, p]);

  const xMax = Math.ceil((trade ? Math.max(calc.Xmax, calc.prod.x + calc.prod.y / p) : calc.Xmax) * 1.1);
  const yMax = Math.ceil((trade ? Math.max(calc.Ymax, calc.prod.y + p * calc.prod.x) : calc.Ymax) * 1.1);
  const status = point && (() => {
    const onY = calc.yAt(point.x);
    if (point.x > calc.Xmax || point.y > onY + yMax * 0.015) return { t: 'לא ניתנת להשגה – מעל עקומת התמורה', cls: 'bad' };
    if (point.y < onY - yMax * 0.015) return { t: 'לא יעילה – אפשר להגדיל ייצור של מוצר אחד בלי לוותר על השני', cls: 'warn' };
    return { t: 'יעילה – על עקומת התמורה', cls: 'good' };
  })();
  const set = (i, k, v) => setWorkers((ws) => ws.map((w, j) => (j === i ? { ...w, [k]: v } : w)));

  return (
    <div className="card lab">
      <h2 style={{ fontSize: 22 }}>עקומת התמורה (PPF) – גורמי ייצור תחליפיים</h2>
      <p className="muted">שנו את התפוקה של כל עובד וראו איך העקומה נבנית: מי שהעלות האלטרנטיבית שלו בייצור X נמוכה יותר מייצר X ראשון – ולכן העקומה קמורה. לחצו על הגרף כדי לבדוק נקודה.</p>
      <div className="lab-layout">
        <div className="stack">
          {workers.map((w, i) => (
            <div key={i} className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
              <b>{w.name}</b>
              <Num label="יחידות X לשעה" value={w.x} min={1} max={40} onChange={(v) => set(i, 'x', v)} />
              <Num label="יחידות Y לשעה" value={w.y} min={1} max={40} onChange={(v) => set(i, 'y', v)} />
              <Num label="שעות עבודה" value={w.h} min={1} max={20} onChange={(v) => set(i, 'h', v)} />
              <div className="faint" style={{ fontSize: 13 }}>עלות אלטרנטיבית של X: <b className="num">{fmt(w.y / w.x)}</b> Y</div>
            </div>
          ))}
          <label className="row" style={{ fontWeight: 600 }}><input type="checkbox" checked={trade} onChange={(e) => setTrade(e.target.checked)} /> משק קטן פתוח למסחר</label>
          {trade && <Num label="יחס חליפין עולמי (Y ליחידת X)" value={p} min={0.25} max={5} step={0.25} onChange={setP} />}
        </div>
        <div className="stack">
          <Frame xMax={xMax} yMax={yMax} xLabel="X" yLabel="Y" onClick={setPoint}>
            {({ sx, sy }) => (
              <>
                <motion.path
                  d={`M${sx(0)},${sy(0)} ` + calc.pts.map((q) => `L${sx(q.x)},${sy(q.y)}`).join(' ') + ' Z'}
                  fill="var(--c)" opacity={0.1}
                />
                <motion.polyline
                  points={calc.pts.map((q) => `${sx(q.x)},${sy(q.y)}`).join(' ')}
                  fill="none" stroke="var(--c)" strokeWidth={3.5} strokeLinejoin="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9 }}
                />
                {calc.pts.map((q, i) => (
                  <g key={i}>
                    <motion.circle cx={sx(q.x)} cy={sy(q.y)} r={5} fill="var(--c)" animate={{ cx: sx(q.x), cy: sy(q.y) }} />
                    <text x={sx(q.x) + 8} y={sy(q.y) - 8} style={{ fontWeight: 600 }}>({fmt(q.x)}, {fmt(q.y)})</text>
                  </g>
                ))}
                {trade && (
                  <>
                    <line x1={sx(0)} y1={sy(calc.prod.y + p * calc.prod.x)} x2={sx(calc.prod.x + calc.prod.y / p)} y2={sy(0)} stroke="#f08c2e" strokeWidth={2.5} strokeDasharray="7 5" />
                    <circle cx={sx(calc.prod.x)} cy={sy(calc.prod.y)} r={8} fill="#f08c2e" stroke="#fff" strokeWidth={2} />
                  </>
                )}
                {point && <motion.circle key={point.x + ',' + point.y} cx={sx(point.x)} cy={sy(point.y)} r={7} fill={status.cls === 'good' ? 'var(--good)' : status.cls === 'warn' ? 'var(--warn)' : 'var(--bad)'} initial={{ r: 0 }} animate={{ r: 7 }} />}
              </>
            )}
          </Frame>
          {status && <div className={`chip ${status.cls}`} style={{ height: 'auto', padding: '8px 12px', whiteSpace: 'normal' }}>נקודה ({fmt(point.x, 1)}, {fmt(point.y, 1)}): {status.t}</div>}
          <div className="kpi-grid">
            <div className="kpi"><b className="num">{calc.Xmax}</b><span>Xmax</span></div>
            <div className="kpi"><b className="num">{calc.Ymax}</b><span>Ymax</span></div>
            <div className="kpi"><b>{calc.sorted[0].name}</b><span>יתרון יחסי בייצור X</span></div>
            <div className="kpi"><b>{calc.sorted[calc.sorted.length - 1].name}</b><span>יתרון יחסי בייצור Y</span></div>
          </div>
          {trade && (
            <div className="callout">
              ביחס חליפין של <b className="num">{p}</b>: כדאי לייצר בנקודה <b className="num">({calc.prod.x}, {calc.prod.y})</b> ולסחור לאורך הקו הכתום.
              {' '}כל עובד שהעלות האלטרנטיבית שלו בייצור X נמוכה מהמחיר העולמי – מתמחה ב-X. קו אפשרויות התצרוכת נמצא מעל עקומת התמורה (חוץ מנקודת הייצור) – זה הרווח מסחר.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Comparative advantage between two economies ---------------- */
export function TradeLab() {
  const [a, setA] = useState({ ag: 4, ind: 20 });
  const [b, setB] = useState({ ag: 5, ind: 40 });
  const ocA = a.ind / a.ag;
  const ocB = b.ind / b.ag;
  const lo = Math.min(ocA, ocB), hi = Math.max(ocA, ocB);
  const [tot, setTot] = useState(6);
  const agSpecialist = ocA < ocB ? 'א' : 'ב';
  const indSpecialist = agSpecialist === 'א' ? 'ב' : 'א';
  const ok = tot > lo && tot < hi;
  const t = Math.min(Math.max(tot, 0.5), 20);

  const Chart = ({ c, name, exportsAg }) => {
    const xMax = Math.ceil(Math.max(c.ag, exportsAg ? c.ag : c.ind / t) * 1.25);
    const yMax = Math.ceil(Math.max(c.ind, exportsAg ? c.ag * t : c.ind) * 1.15);
    return (
      <div>
        <b>משק {name}</b>
        <Frame W={360} H={280} P={42} xMax={xMax} yMax={yMax} xLabel="חקלאות" yLabel="תעשייה">
          {({ sx, sy }) => (
            <>
              <line x1={sx(0)} y1={sy(c.ind)} x2={sx(c.ag)} y2={sy(0)} stroke="var(--c)" strokeWidth={3} />
              {exportsAg ? (
                <line x1={sx(c.ag)} y1={sy(0)} x2={sx(0)} y2={sy(c.ag * t)} stroke="#f08c2e" strokeWidth={2.5} strokeDasharray="7 5" />
              ) : (
                <line x1={sx(0)} y1={sy(c.ind)} x2={sx(c.ind / t)} y2={sy(0)} stroke="#f08c2e" strokeWidth={2.5} strokeDasharray="7 5" />
              )}
              <circle cx={exportsAg ? sx(c.ag) : sx(0)} cy={exportsAg ? sy(0) : sy(c.ind)} r={7} fill="#f08c2e" />
            </>
          )}
        </Frame>
      </div>
    );
  };

  return (
    <div className="card lab">
      <h2 style={{ fontSize: 22 }}>יתרון יחסי וסחר בין שני משקים</h2>
      <p className="muted">כל משק מתמחה במוצר שבו העלות האלטרנטיבית שלו נמוכה. המסחר משתלם לשני הצדדים רק כשיחס החליפין נמצא <b>בין</b> העלויות האלטרנטיביות.</p>
      <div className="lab-layout">
        <div className="stack">
          {[['א', a, setA], ['ב', b, setB]].map(([n, c, set]) => (
            <div key={n} className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
              <b>משק {n}</b>
              <Num label="מקסימום חקלאות" value={c.ag} min={1} max={20} onChange={(v) => set({ ...c, ag: v })} />
              <Num label="מקסימום תעשייה" value={c.ind} min={1} max={80} onChange={(v) => set({ ...c, ind: v })} />
              <div className="faint" style={{ fontSize: 13 }}>מחיר חקלאות במונחי תעשייה: <b className="num">{fmt(c.ind / c.ag)}</b></div>
            </div>
          ))}
          <Num label="יחס חליפין: יחידות תעשייה לכל יחידת חקלאות" value={tot} min={0.5} max={20} step={0.5} onChange={setTot} />
        </div>
        <div className="stack">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Chart c={a} name="א" exportsAg={agSpecialist === 'א'} />
            <Chart c={b} name="ב" exportsAg={agSpecialist === 'ב'} />
          </div>
          <div className={`callout`} style={{ background: ok ? 'var(--good-bg)' : 'var(--bad-bg)' }}>
            {ok ? (
              <>✅ יחס {tot} נמצא בין {fmt(lo)} ל-{fmt(hi)} – <b>שני המשקים מרוויחים</b>. משק {agSpecialist} מתמחה בחקלאות, משק {indSpecialist} בתעשייה, והקו הכתום (אפשרויות התצרוכת) נמצא מעל עקומת התמורה של כל אחד.</>
            ) : (
              <>⚠️ יחס {tot} מחוץ לטווח ({fmt(lo)}–{fmt(hi)}) – אחד הצדדים יעדיף לייצר לבד, ולכן <b>לא יתקיים מסחר</b>.</>
            )}
          </div>
          <div className="kpi-grid">
            <div className="kpi"><b className="num">{fmt(ocA)}</b><span>ע"א של חקלאות במשק א'</span></div>
            <div className="kpi"><b className="num">{fmt(ocB)}</b><span>ע"א של חקלאות במשק ב'</span></div>
            <div className="kpi"><b>משק {agSpecialist}</b><span>יתרון יחסי בחקלאות</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
