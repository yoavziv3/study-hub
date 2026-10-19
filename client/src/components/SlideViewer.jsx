import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Sparkles, FileText, PanelLeftClose, PanelLeftOpen, Download } from 'lucide-react';
import { slideUrl, originalUrl, STATIC } from '../api.js';
import { PdfPage, PdfThumb, loadPdf } from './PdfSlides.jsx';
import { useApp } from '../store.jsx';
import { ltr } from './ui.jsx';

export default function SlideViewer({ lecture, slide, setSlide }) {
  const { openChat } = useApp();
  const total = lecture.slideCount || lecture.slides.length;
  const [dir, setDir] = useState(1);
  const [showText, setShowText] = useState(false);
  const [focus, setFocus] = useState(false);
  const stageRef = useRef();
  const thumbsRef = useRef();
  const topics = lecture.content?.topics || [];
  const topic = topics.find((t) => slide >= t.slideStart && slide <= t.slideEnd);
  const text = lecture.slides[slide - 1]?.text || '';
  // Cloud: slides come from the lecture's PDF (drawn in the browser); on the Mac and as a fallback, from images.
  const pdf = STATIC ? lecture.pdf : null;
  const hasImages = !pdf && lecture.hasPdf && (!STATIC || lecture.pdf === null);

  const go = (n) => {
    const next = Math.max(1, Math.min(total, n));
    setDir(next > slide ? 1 : -1);
    setSlide(next);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(slide + 1); }
      if (e.key === 'ArrowRight' || e.key === 'PageUp') { e.preventDefault(); go(slide - 1); }
      if (e.key === 'f') toggleFull();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Keep the active thumbnail in view.
  useEffect(() => {
    thumbsRef.current?.querySelector('.thumb.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [slide]);

  // Start loading the PDF right away (it's one download for the whole deck).
  useEffect(() => {
    if (pdf) loadPdf(pdf).catch(() => {});
  }, [pdf]);

  // Preload neighbours for instant navigation.
  useEffect(() => {
    if (!hasImages) return;
    [slide + 1, slide + 2, slide - 1].filter((n) => n >= 1 && n <= total).forEach((n) => { const i = new Image(); i.src = slideUrl(lecture.id, n); });
  }, [slide, lecture.id, total, hasImages]);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else stageRef.current?.requestFullscreen?.();
  };

  const swipe = useRef(null);

  return (
    <div>
      <div className={`viewer ${focus ? 'focus' : ''}`}>
        <div>
          <div
            className="stage"
            ref={stageRef}
            onTouchStart={(e) => (swipe.current = e.touches[0].clientX)}
            onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - swipe.current; if (Math.abs(dx) > 40) go(slide + (dx > 0 ? 1 : -1)); }}
          >
            <AnimatePresence initial={false} custom={dir}>
              {pdf ? (
                <motion.div
                  key={slide}
                  className="stage-pdf"
                  custom={dir}
                  initial={{ opacity: 0, x: dir * -40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: dir * 40 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                >
                  <PdfPage url={pdf} page={slide} label={`שקף ${slide}`} />
                </motion.div>
              ) : hasImages ? (
                <motion.img
                  key={slide}
                  src={slideUrl(lecture.id, slide)}
                  alt={`שקף ${slide}`}
                  custom={dir}
                  initial={{ opacity: 0, x: dir * -40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: dir * 40 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  draggable={false}
                />
              ) : (
                <motion.div key={slide} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ position: 'absolute', inset: 0, padding: 40, color: '#eee', whiteSpace: 'pre-wrap', overflow: 'auto', background: '#1b1c20' }}>
                  {text}
                </motion.div>
              )}
            </AnimatePresence>
            <button className="stage-nav prev" onClick={() => go(slide - 1)} aria-label="הקודם"><ChevronRight size={22} /></button>
            <button className="stage-nav next" onClick={() => go(slide + 1)} aria-label="הבא"><ChevronLeft size={22} /></button>
            <div className="stage-progress"><span style={{ width: `${(slide / total) * 100}%` }} /></div>
          </div>

          {topics.length > 0 && (
            <div className="topic-strip" title="נושאי ההרצאה">
              {topics.map((t) => (
                <button key={t.title} className={topic === t ? 'on' : ''} title={`${t.title} (שקפים ${t.slideStart}–${t.slideEnd})`} onClick={() => go(t.slideStart)} />
              ))}
            </div>
          )}

          <div className="viewer-bar">
            <span className="chip num">{slide} / {total}</span>
            {topic && (
              <motion.span key={topic.title} className="chip c" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                {topic.title}
              </motion.span>
            )}
            <div className="spacer" />
            <button className="local-only btn sm" onClick={() => openChat({ prompt: `הסבר לי את שקף ${slide} בצורה פשוטה וברורה, עם דוגמה.`, autoSend: true })}>
              <Sparkles size={14} /> הסבר את השקף
            </button>
            <button className={`btn sm ${showText ? 'accent' : ''}`} onClick={() => setShowText((s) => !s)}><FileText size={14} /> טקסט</button>
            <a className="btn sm icon" href={originalUrl(lecture)} download={lecture.originalName} title="הורדת הקובץ המקורי"><Download size={15} /></a>
            <button className="btn sm icon" onClick={() => setFocus((f) => !f)} title={focus ? 'הצגת תמונות ממוזערות' : 'מצב מיקוד'}>
              {focus ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
            <button className="btn sm icon" onClick={toggleFull} title="מסך מלא (F)">
              {document.fullscreenElement ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          </div>

          <AnimatePresence>
            {showText && (
              <motion.div className="card slide-text" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                {ltr(text) || 'אין טקסט בשקף הזה.'}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {!focus && (
          <div className="thumbs" ref={thumbsRef}>
            {[...Array(total)].map((_, i) => (
              <button key={i} className={`thumb ${slide === i + 1 ? 'active' : ''}`} onClick={() => go(i + 1)}>
                {pdf ? <PdfThumb url={pdf} page={i + 1} /> : hasImages ? <img src={slideUrl(lecture.id, i + 1, true)} alt="" loading="lazy" /> : <div style={{ padding: 6, fontSize: 9, overflow: 'hidden', height: '100%' }}>{lecture.slides[i]?.text.slice(0, 80)}</div>}
                <i>{i + 1}</i>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="faint" style={{ fontSize: 12.5, marginTop: 10 }}>ניווט: חיצים במקלדת · רווח לשקף הבא · F למסך מלא</div>
    </div>
  );
}
