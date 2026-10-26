// "$" as a currency sign ("67$", "$1.6") vs "$…$" around a formula. Models write both, and a renderer that takes
// every pair of dollars as math turns the Hebrew text between two prices into a garbled formula. A span is kept
// as math only if it looks like one: on one line, no loose Hebrew in it (Hebrew only belongs inside LaTeX in \text{…}), not
// opening or closing on a space, and not followed by a digit. Every other "$" becomes "\$", a literal dollar.
// Used by the client before rendering (components/markdown.jsx) and by the fixed checks on AI output (checks.js).
const HEBREW = /[֐-׿]/;
// Hebrew words inside \text{…} are fine in a formula ("n \text{ מתחלק ב-2}"); loose Hebrew between two prices is not.
const hasLooseHebrew = (inner) => HEBREW.test(inner.replace(/\\text\{[^{}]*\}/g, ''));

export function escapeCurrency(src) {
  const s = String(src ?? '');
  if (!s.includes('$')) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { out += s.slice(i, i + 2); i += 2; continue; }
    if (c !== '$') { out += c; i++; continue; }
    if (s[i + 1] === '$') {
      // Display math: through the closing $$ (left as it is).
      const end = s.indexOf('$$', i + 2);
      if (end < 0) { out += '\\$\\$'; i += 2; continue; }
      out += s.slice(i, end + 2);
      i = end + 2;
      continue;
    }
    let j = i + 1;
    while (j < s.length && s[j] !== '\n' && !(s[j] === '$' && s[j - 1] !== '\\')) j++;
    const inner = j < s.length && s[j] === '$' ? s.slice(i + 1, j) : null;
    const math = inner && inner.trim() && !hasLooseHebrew(inner) && !/^\s/.test(inner) && !/\s$/.test(inner) && !/\d/.test(s[j + 1] || '');
    if (math) { out += s.slice(i, j + 1); i = j + 1; continue; }
    out += '\\$';
    i++;
  }
  return out;
}
