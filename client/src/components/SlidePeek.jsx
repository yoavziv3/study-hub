import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, X, Loader2, ExternalLink } from 'lucide-react';
import { api, slideUrl, STATIC } from '../api.js';
import { PdfPage } from './PdfSlides.jsx';
import { ltr } from './ui.jsx';

// Each lecture's data once per visit, shared by every question that points at it.
const lectures = new Map();
const loadLecture = (id) => {
  if (!lectures.has(id)) {
    const p = api.get(`/api/lectures/${id}`);
    p.catch(() => lectures.delete(id));
    lectures.set(id, p);
  }
  return lectures.get(id);
};

/**
 * A question's slide, opened right under it (practice keeps going: the question, the explanation and the slide on
 * one screen). Slides come from the lecture's PDF in the cloud and from images on the Mac, like SlideViewer; a
 * text-only unit shows the slide's text. Neighbouring slides are a click away.
 */
export default function SlidePeek({ lectureId, slide, onClose, inline = false }) {
  const [lecture, setLecture] = useState(null);
  const [error, setError] = useState(null);
  const [n, setN] = useState(slide);
  useEffect(() => { setN(slide); }, [slide]);
  useEffect(() => {
    let live = true;
    loadLecture(lectureId).then((l) => live && setLecture(l)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [lectureId]);

  const total = lecture ? lecture.slideCount || lecture.slides?.length || 1 : 1;
  const pdf = STATIC ? lecture?.pdf : null;
  const hasImages = lecture && !pdf && lecture.hasPdf && (!STATIC || lecture.pdf === null);
  const text = lecture?.slides?.[n - 1]?.text || '';

  return (
    <motion.div className={`slide-peek ${inline ? 'inline' : ''}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
      <div className="row" style={{ gap: 6, marginBottom: 8 }}>
        <b style={{ fontSize: 14 }}>{inline && n === slide ? 'השקף שהשאלה מתייחסת אליו' : `שקף ${n}`}{lecture ? ` · ${n} מתוך ${total}` : ''}</b>
        {lecture && <span className="faint" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lecture.title}</span>}
        <div className="spacer" />
        <button className="btn icon sm ghost" disabled={n <= 1} onClick={() => setN(n - 1)} aria-label="השקף הקודם"><ChevronRight size={16} /></button>
        <button className="btn icon sm ghost" disabled={n >= total} onClick={() => setN(n + 1)} aria-label="השקף הבא"><ChevronLeft size={16} /></button>
        <Link className="btn icon sm ghost" to={`/lecture/${lectureId}?tab=slides&slide=${n}`} title="פתיחה במצגת המלאה" aria-label="פתיחה במצגת המלאה"><ExternalLink size={15} /></Link>
        {onClose && <button className="btn icon sm ghost" onClick={onClose} aria-label="סגירת השקף"><X size={16} /></button>}
      </div>
      {error && <div className="faint">{error}</div>}
      {!lecture && !error && <div style={{ padding: 30, textAlign: 'center' }}><Loader2 className="spin" /></div>}
      {lecture && (pdf || hasImages) && (
        <div className="stage slide-peek-stage">
          {pdf ? <PdfPage url={pdf} page={n} className="stage-pdf" label={`שקף ${n}`} /> : <img src={slideUrl(lectureId, n)} alt={`שקף ${n}`} />}
        </div>
      )}
      {lecture && !pdf && !hasImages && (
        <div className="slide-peek-text">{text ? ltr(text) : 'אין תצוגה לשקף הזה'}</div>
      )}
    </motion.div>
  );
}
