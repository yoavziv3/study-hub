import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Tex } from '../components/markdown.jsx';

const PRESETS = [
  { f: 'x^2', tex: 'x^2' },
  { f: 'sin(x)', tex: '\\sin x' },
  { f: 'x^3 - 3*x', tex: 'x^3-3x' },
  { f: 'exp(x)', tex: 'e^x' },
  { f: 'ln(x)', tex: '\\ln x' },
  { f: 'abs(x)', tex: '|x|' },
  { f: '1/x', tex: '\\frac{1}{x}' },
];

// Compile a user expression with Math functions in scope ("x^2" → x**2).
function compile(src) {
  const expr = src.replace(/\^/g, '**').replace(/\bln\b/g, 'log').replace(/(\d)([a-z(])/gi, '$1*$2');
  // eslint-disable-next-line no-new-func
  const fn = new Function('x', `with (Math) { return (${expr}); }`);
  return (x) => { try { const y = fn(x); return Number.isFinite(y) ? y : NaN; } catch { return NaN; } };
}

/* Derivative as the limit of secant slopes. */
export function DerivativeLab() {
  const [src, setSrc] = useState('x^2');
  const [x0, setX0] = useState(1);
  const [logH, setLogH] = useState(0); // h = 2^logH
  const h = Math.pow(2, logH);
  const f = useMemo(() => compile(src), [src]);
  const W = 600, H = 380, X0 = -4, X1 = 4;
  const samples = useMemo(() => [...Array(401)].map((_, i) => X0 + ((X1 - X0) * i) / 400).map((x) => ({ x, y: f(x) })), [f]);
  const ys = samples.map((s) => s.y).filter(Number.isFinite);
  const Y0 = Math.max(Math.min(...ys, -1), -12), Y1 = Math.min(Math.max(...ys, 1), 12);
  const sx = (x) => ((x - X0) / (X1 - X0)) * W;
  const sy = (y) => H - ((y - Y0) / (Y1 - Y0)) * H;
  const fx0 = f(x0);
  const secant = (f(x0 + h) - fx0) / h;
  const deriv = (f(x0 + 1e-5) - f(x0 - 1e-5)) / 2e-5;
  const path = samples.reduce((acc, s, i) => {
    if (!Number.isFinite(s.y) || s.y < Y0 - 50 || s.y > Y1 + 50) return acc + ' ';
    const prev = samples[i - 1];
    const jump = !prev || !Number.isFinite(prev.y) || Math.abs(prev.y - s.y) > (Y1 - Y0);
    return acc + `${jump ? 'M' : 'L'}${sx(s.x).toFixed(1)},${sy(s.y).toFixed(1)}`;
  }, '');
  const line = (m) => `M${sx(X0)},${sy(fx0 + m * (X0 - x0))} L${sx(X1)},${sy(fx0 + m * (X1 - x0))}`;

  return (
    <div className="card lab">
      <h2 style={{ fontSize: 22 }}>הנגזרת כגבול של שיפועי מיתרים</h2>
      <p className="muted">
        המיתר (כתום) עובר דרך <Tex block={false}>{'(x_0, f(x_0))'}</Tex> ו-<Tex block={false}>{'(x_0+h, f(x_0+h))'}</Tex>. הקטינו את h וראו איך השיפוע שלו מתכנס לשיפוע המשיק (סגול) – זו ההגדרה:
      </p>
      <div className="tex" style={{ padding: 10, borderRadius: 12, background: 'var(--surface-2)', textAlign: 'center', marginBottom: 14 }}>
        <Tex>{"f'(x_0)=\\lim_{h\\to 0}\\frac{f(x_0+h)-f(x_0)}{h}"}</Tex>
      </div>
      <div className="lab-layout">
        <div className="stack">
          <label className="field">f(x) =<input className="input num" value={src} onChange={(e) => setSrc(e.target.value)} /></label>
          <div className="row wrap" style={{ gap: 6 }}>
            {PRESETS.map((p) => <button key={p.f} className={`chip ${src === p.f ? 'c' : ''}`} onClick={() => setSrc(p.f)}><Tex block={false}>{p.tex}</Tex></button>)}
          </div>
          <label className="field"><span className="row">x₀ <span className="spacer" /><b className="num">{x0.toFixed(2)}</b></span><input type="range" min={-3.5} max={3.5} step={0.05} value={x0} onChange={(e) => setX0(+e.target.value)} /></label>
          <label className="field"><span className="row">h <span className="spacer" /><b className="num">{h < 0.01 ? h.toExponential(1) : h.toFixed(3)}</b></span><input type="range" min={-12} max={1.5} step={0.1} value={logH} onChange={(e) => setLogH(+e.target.value)} /></label>
          <div className="kpi-grid">
            <div className="kpi"><b className="num">{Number.isFinite(secant) ? secant.toFixed(4) : '—'}</b><span>שיפוע המיתר</span></div>
            <div className="kpi"><b className="num">{Number.isFinite(deriv) ? deriv.toFixed(4) : '—'}</b><span>f'(x₀) (משיק)</span></div>
          </div>
          <div className="callout" style={{ fontSize: 13.5 }}>נסו את <b className="num">|x|</b> ב-x₀=0: משמאל ומימין המיתרים מתכנסים לשיפועים שונים (‎−1 ו-1) – ולכן הנגזרת לא קיימת שם.</div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="lab-svg" style={{ direction: 'ltr' }}>
          <line x1={0} x2={W} y1={sy(0)} y2={sy(0)} stroke="var(--text-3)" />
          <line x1={sx(0)} x2={sx(0)} y1={0} y2={H} stroke="var(--text-3)" />
          {[-4, -3, -2, -1, 1, 2, 3].map((t) => <text key={t} x={sx(t)} y={sy(0) + 16} textAnchor="middle">{t}</text>)}
          <path d={path} fill="none" stroke="var(--c)" strokeWidth={3} />
          {Number.isFinite(deriv) && <path d={line(deriv)} stroke="#7048e8" strokeWidth={2} opacity={0.8} />}
          {Number.isFinite(secant) && <motion.path animate={{ d: line(secant) }} transition={{ duration: 0.15 }} stroke="#f08c2e" strokeWidth={2.5} strokeDasharray="7 5" />}
          {Number.isFinite(fx0) && <circle cx={sx(x0)} cy={sy(fx0)} r={6} fill="var(--c)" />}
          {Number.isFinite(f(x0 + h)) && <circle cx={sx(x0 + h)} cy={sy(f(x0 + h))} r={5} fill="#f08c2e" />}
        </svg>
      </div>
    </div>
  );
}
