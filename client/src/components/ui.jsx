import { useEffect, useState } from 'react';
import { motion, animate, useMotionValue, useTransform } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import { TrendingUp, Sigma, Network, Calculator, BookOpen, Atom } from 'lucide-react';

export const COURSE_ICONS = { TrendingUp, Sigma, Network, Calculator, Atom };
export function CourseIcon({ name, size = 22 }) {
  const I = COURSE_ICONS[name] || BookOpen;
  return <I size={size} strokeWidth={2.1} />;
}

const slug = (s) => String(s).trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
const textOf = (children) => (Array.isArray(children) ? children.map(textOf).join('') : typeof children === 'object' && children ? textOf(children.props?.children) : String(children ?? ''));

// remark-math only treats $$…$$ as display math when the delimiters sit on their own lines.
const blockMath = (src) => src.replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, tex) => `$$\n${tex}\n$$`);

// In GFM tables a bare | ends the cell, which breaks absolute values like $|x|$. Rewrite pipes that
// sit inside math on table rows to their LaTeX names before markdown parsing.
const MATH_IN_LINE = /(?<!\\)(\$\$?)(.+?)(?<!\\)\1/g;
const tablePipes = (src) =>
  src.replace(/^[ \t]*\|.*$/gm, (row) =>
    row.replace(MATH_IN_LINE, (_, d, tex) =>
      d + tex.replace(/\\left\|/g, '\\left\\lvert ').replace(/\\right\|/g, '\\right\\rvert ').replace(/\\\|/g, '\\Vert ').replace(/\|/g, '\\vert ') + d));

// Plain-text arithmetic ("3,000 + 64,000 − 7,000 = 60,000", "−2,000", "18/10/2026") inside Hebrew text gets
// reordered by the bidi algorithm. Wrap each such run in Unicode isolate marks so it always reads left-to-right.
const LRI = '⁦';
const PDI = '⁩';
const NUM = String.raw`(?:\*\*)?\(?\d[\d,]*(?:\.\d+)?[%×]?\)?(?:\*\*)?`; // [%×]: "40%", "12×"
const SIGNED = String.raw`[+\-−]\d[\d,]*(?:\.\d+)?%?`;
const OP = String.raw`[ \t]*[+\-−×÷·⋅/=≈<>≤≥][ \t]*`;
const EXPR = new RegExp(
  String.raw`(?<![\p{L}\p{N}\\$_{\-−])(?:(?:\(?${SIGNED}\)?|${NUM})(?:${OP}(?:\(?${SIGNED}\)?|${NUM}))+|${SIGNED}(?![\p{L}\p{N}]))`,
  'gu'
);
export const ltr = (text) => (typeof text === 'string' ? text.replace(EXPR, (m) => LRI + m + PDI) : text);

// Apply ltr() to markdown text only, leaving math and code spans untouched.
const PROTECTED = /(\$\$[\s\S]*?\$\$|(?<!\\)\$[^$\n]+?(?<!\\)\$|`[^`\n]*`)/g;
const ltrMarkdown = (src) => src.split(PROTECTED).map((part, i) => (i % 2 ? part : ltr(part))).join('');

export function Markdown({ children, className = '' }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{ h2: ({ children }) => <h2 id={slug(textOf(children))}>{children}</h2> }}
      >
        {ltrMarkdown(blockMath(tablePipes(children || '')))}
      </ReactMarkdown>
    </div>
  );
}
Markdown.slug = slug;

export function Tex({ children, block = true }) {
  const html = katex.renderToString(children || '', { throwOnError: false, displayMode: block, strict: false });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Tabs({ tabs, value, onChange, layoutId = 'tab' }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'active' : ''}`} onClick={() => onChange(t.id)}>
          {value === t.id && <motion.span layoutId={layoutId} className="tab-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          {t.icon}
          {t.label}
          {t.count != null && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Ring({ value = 0, size = 52, stroke = 6, label, color = 'var(--accent)' }) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - Math.min(1, value)) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: size > 70 ? 20 : 12.5, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
        {label ?? `${Math.round(value * 100)}%`}
      </div>
    </div>
  );
}

export function CountUp({ to = 0, decimals = 0, suffix = '' }) {
  const mv = useMotionValue(0);
  const shown = useTransform(mv, (v) => v.toFixed(decimals) + suffix);
  const [text, setText] = useState('0');
  useEffect(() => {
    const ctl = animate(mv, to, { duration: 1.2, ease: [0.22, 1, 0.36, 1] });
    const unsub = shown.on('change', setText);
    return () => { ctl.stop(); unsub(); };
  }, [to]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span className="num">{text}</span>;
}

export const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { delay: i * 0.05, duration: 0.5, ease: [0.22, 1, 0.36, 1] } }),
};

export function Page({ children }) {
  return (
    <motion.div className="page" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
      {children}
    </motion.div>
  );
}

export function Highlight({ text = '', q = '' }) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}
