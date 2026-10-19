// Slides drawn from the lecture's PDF in the browser (cloud site). pdf.js is loaded only when a deck is opened,
// each document once per visit; pages render at the screen's pixel density, so text stays sharp when enlarged.
import { useEffect, useRef, useState } from 'react';

let pdfjs = null;
const docs = new Map();

async function lib() {
  if (!pdfjs) {
    pdfjs = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([mod, worker]) => {
      mod.GlobalWorkerOptions.workerSrc = worker.default;
      return mod;
    });
  }
  return pdfjs;
}

export async function loadPdf(url) {
  if (!docs.has(url)) {
    const p = lib().then((mod) => mod.getDocument({ url, withCredentials: true, standardFontDataUrl: '/pdfjs/standard_fonts/', disableFontFace: true, useSystemFonts: false }).promise);
    p.catch(() => docs.delete(url));
    docs.set(url, p);
  }
  return docs.get(url);
}

/** Draws page `page` of the PDF at `url`, fitted inside its container (like object-fit: contain). */
export function PdfPage({ url, page, className = '', label }) {
  const box = useRef();
  const canvas = useRef();
  const [state, setState] = useState('loading');

  useEffect(() => {
    let task = null;
    let cancelled = false;
    const draw = async () => {
      try {
        const doc = await loadPdf(url);
        const p = await doc.getPage(page);
        if (cancelled || !box.current || !canvas.current) return;
        const { width: bw, height: bh } = box.current.getBoundingClientRect();
        if (!bw || !bh) return;
        const base = p.getViewport({ scale: 1 });
        const fit = Math.min(bw / base.width, bh / base.height);
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const viewport = p.getViewport({ scale: fit * dpr });
        const c = canvas.current;
        c.width = Math.floor(viewport.width);
        c.height = Math.floor(viewport.height);
        c.style.width = `${Math.floor(base.width * fit)}px`;
        c.style.height = `${Math.floor(base.height * fit)}px`;
        task?.cancel();
        task = p.render({ canvasContext: c.getContext('2d'), viewport });
        await task.promise;
        if (!cancelled) setState('ready');
      } catch (e) {
        if (!cancelled && e?.name !== 'RenderingCancelledException') setState('error');
      }
    };
    draw();
    // Re-render at the new size when the container changes (fullscreen, rotating the phone…).
    const ro = new ResizeObserver(() => draw());
    if (box.current) ro.observe(box.current);
    return () => {
      cancelled = true;
      task?.cancel();
      ro.disconnect();
    };
  }, [url, page]);

  return (
    <div ref={box} className={`pdf-page ${className}`} data-state={state}>
      <canvas ref={canvas} role="img" aria-label={label} />
      {state === 'error' && <div className="pdf-error">לא הצלחתי להציג את השקף</div>}
    </div>
  );
}

/** A thumbnail that renders only when scrolled into view. */
export function PdfThumb({ url, page }) {
  const ref = useRef();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '200px' });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className="pdf-thumb">{visible && <PdfPage url={url} page={page} label="" />}</div>;
}
