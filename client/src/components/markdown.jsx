// Markdown + math rendering (react-markdown, KaTeX). Kept out of the shared UI module so pages that don't show
// study material (home, sign-in, updates) load without it – it's the heaviest part of the app.
import { Fragment } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import katex from 'katex';
import { escapeCurrency } from '../../../shared/currency.js';
import 'katex/dist/katex.min.css';
import { ltr } from './ui.jsx';

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

// Apply ltr() to markdown text only, leaving math and code spans untouched.
const PROTECTED = /(\$\$[\s\S]*?\$\$|(?<!\\)\$[^$\n]+?(?<!\\)\$|`[^`\n]*`)/g;
const ltrMarkdown = (src) => src.split(PROTECTED).map((part, i) => (i % 2 ? part : ltr(part))).join('');

export function Markdown({ children, className = '' }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        components={{
          h2: ({ children }) => <h2 id={slug(textOf(children))}>{children}</h2>,
          // Wide tables scroll sideways: focusable so keyboard users can scroll them too.
          table: ({ children }) => <table tabIndex={0}>{children}</table>,
        }}
      >
        {ltrMarkdown(blockMath(tablePipes(escapeCurrency(children || ''))))}
      </ReactMarkdown>
    </div>
  );
}
Markdown.slug = slug;

export function Tex({ children, block = true }) {
  const html = katex.renderToString(children || '', { throwOnError: false, displayMode: block, strict: false });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}


// ---------- short fields (questions, answers, flashcards, terms, tips) ----------
// These are single lines that the AI may write with inline math ($…$) and **bold**. RichText renders just that –
// no paragraphs or lists, so it fits inside buttons and chips. Currency dollars ("67$", "$1.6") stay dollar signs
// (escapeCurrency, shared/currency.js), also when two prices would otherwise pair up as a formula.
const INLINE = /(\$\$[^$]+?\$\$|(?<![\\$\w])\$(?=[^\s$])[^$\n]+?(?<=[^\s\\])\$(?!\d)|\*\*[^*\n]+?\*\*|`[^`\n]+`)/g;

export function RichText({ children }) {
  const parts = escapeCurrency(String(children ?? '')).split(INLINE);
  return parts.map((p, i) => {
    if (i % 2 === 0) return p ? <Fragment key={i}>{ltr(p.replace(/\\\$/g, '$'))}</Fragment> : null;
    if (p.startsWith('$$')) return <Tex key={i} block={false}>{`\\displaystyle ${p.slice(2, -2)}`}</Tex>;
    if (p.startsWith('$')) return <Tex key={i} block={false}>{p.slice(1, -1)}</Tex>;
    if (p.startsWith('**')) return <b key={i}><RichText>{p.slice(2, -2)}</RichText></b>;
    return <code key={i}>{p.slice(1, -1)}</code>;
  });
}
