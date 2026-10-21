// Study text without markup – kept apart from markdown.jsx so search can use it without loading KaTeX.

/** The text as plain characters (search snippets, highlighting while filtering): math in readable symbols. */
const SYMBOLS = { infty: '∞', cdot: '·', times: '×', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠', to: '→', pm: '±', approx: '≈', sum: 'Σ', Delta: 'Δ', delta: 'δ', pi: 'π', alpha: 'α', beta: 'β', epsilon: 'ε', varepsilon: 'ε', lambda: 'λ', sigma: 'σ', mu: 'μ', in: '∈', ldots: '…', dots: '…', cdots: '⋯', Rightarrow: '⇒', iff: '⇔', lvert: '|', rvert: '|' };
export function plainText(s = '') {
  const tex = (t) => t
    .replace(/\\(?:dfrac|tfrac|frac)\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
    .replace(/\\(?:left|right|displaystyle|,|;|!|quad|qquad)/g, '')
    .replace(/\\([a-zA-Z]+)/g, (m, n) => SYMBOLS[n] ?? n)
    .replace(/[{}]/g, '');
  return String(s)
    .replace(/\$\$([^$]+?)\$\$|(?<!\\)\$([^$\n]+?)(?<!\\)\$/g, (_, a, b) => tex(a ?? b))
    .replace(/\*\*|`/g, '')
    .replace(/\\\$/g, '$');
}
