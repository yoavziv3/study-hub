import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Download, Trash2, Loader2, ShieldCheck, FileText } from 'lucide-react';
import { useApp } from '../store.jsx';
import { api, useFetch } from '../api.js';
import { Page } from '../components/ui.jsx';
import { PdfPage, loadPdf } from '../components/PdfSlides.jsx';
import { KIND_LABEL, downloadPersonalFile, forgetPersonalFile, formatSize, isPdf, loadPersonalFile } from '../lib/personalFiles.js';

/** One of the student's own files: a PDF is read here, page by page; other types are handed back as a download. */
export default function MyFile() {
  const { id } = useParams();
  const { setContext, toast } = useApp();
  const navigate = useNavigate();
  const { data, error } = useFetch('/api/me/files');
  const { data: courseData } = useFetch('/api/me/files/courses');
  const file = data?.files.find((f) => f.id === id);
  const course = courseData?.courses.find((c) => c.id === file?.courseId);
  const [progress, setProgress] = useState(0);
  const [url, setUrl] = useState(null);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(null);
  useEffect(() => { setContext({}); }, [setContext]);

  useEffect(() => {
    if (!file || !isPdf(file)) return undefined;
    let revoke = null;
    let cancelled = false;
    loadPersonalFile(file, setProgress)
      .then(async (blob) => {
        if (cancelled) return;
        revoke = URL.createObjectURL(blob);
        const doc = await loadPdf(revoke);
        if (cancelled) return;
        setPages(doc.numPages);
        setUrl(revoke);
      })
      .catch((e) => !cancelled && setFailed(e.message));
    return () => { cancelled = true; };
  }, [file?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((n) => setPage((p) => Math.max(1, Math.min(pages || 1, typeof n === 'function' ? n(p) : n))), [pages]);
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageDown') { e.preventDefault(); go((p) => p + 1); }
      if (e.key === 'ArrowRight' || e.key === 'PageUp') { e.preventDefault(); go((p) => p - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const back = file ? `/files?course=${file.courseId}&kind=${file.kind}` : '/files';
  const remove = async () => {
    if (!confirm(`למחוק את "${file.title}"?`)) return;
    try {
      await api.del(`/api/me/files/${file.id}`);
      forgetPersonalFile(file.id);
      toast('הקובץ נמחק');
      navigate(back);
    } catch (e) { toast(e.message, 'info'); }
  };
  const download = () => downloadPersonalFile(file, setProgress).catch((e) => toast(e.message, 'info'));

  if (error) return <Page><div className="empty"><h2>לא הצלחתי לטעון</h2><p>{error}</p></div></Page>;
  if (!data) return <Page><div style={{ padding: 40, textAlign: 'center' }}><Loader2 className="spin" /></div></Page>;
  if (!file) return <Page><div className="empty"><h2>הקובץ לא נמצא</h2><p><Link to="/files">חזרה להעלאת הקבצים</Link></p></div></Page>;

  return (
    <Page>
      <div data-color={course?.color}>
        <Link to={back} className="btn sm ghost" style={{ marginTop: 8 }}>→ {KIND_LABEL[file.kind]} שלי{course ? ` · ${course.short || course.name}` : ''}</Link>
        <div className="row wrap" style={{ margin: '12px 0 14px', gap: 10 }}>
          <div className="grow">
            <h1 style={{ fontSize: 24 }}>{file.title}</h1>
            <div className="faint" style={{ fontSize: 13 }}><span dir="ltr">{file.name}</span> · {formatSize(file.size)} · <ShieldCheck size={12} style={{ verticalAlign: '-2px' }} /> פרטי, בלי סיכום ושאלות</div>
          </div>
          <button className="btn" onClick={download}><Download size={16} /> הורדה</button>
          <button className="btn ghost danger" onClick={remove}><Trash2 size={16} /> מחיקה</button>
        </div>

        {isPdf(file) ? (
          failed ? (
            <div className="callout">לא הצלחתי להציג את הקובץ: {failed}</div>
          ) : !url ? (
            <div style={{ padding: 50, textAlign: 'center' }}>
              <Loader2 className="spin" size={28} />
              <div className="faint" style={{ marginTop: 8 }}>טוען את הקובץ… {Math.round(progress * 100)}%</div>
            </div>
          ) : (
            <>
              <div className="stage" style={{ aspectRatio: 'auto', height: 'min(78vh, 920px)' }}>
                <PdfPage url={url} page={page} label={`עמוד ${page}`} />
              </div>
              <div className="row" style={{ justifyContent: 'center', marginTop: 12, gap: 10 }}>
                <button className="btn sm icon" onClick={() => go(page - 1)} disabled={page <= 1} aria-label="העמוד הקודם"><ChevronRight size={18} /></button>
                <span className="num" style={{ minWidth: 90, textAlign: 'center' }}>{page} / {pages}</span>
                <button className="btn sm icon" onClick={() => go(page + 1)} disabled={page >= pages} aria-label="העמוד הבא"><ChevronLeft size={18} /></button>
              </div>
            </>
          )
        ) : (
          <div className="empty">
            <div className="empty-icon"><FileText size={28} /></div>
            <h2>את הסוג הזה אי אפשר להציג באתר</h2>
            <p>קבצי PowerPoint ו-Word נפתחים באפליקציה שלהם. הורידו אותם, או שמרו כ-PDF כדי לקרוא כאן.</p>
            <button className="btn accent" onClick={download}><Download size={16} /> הורדה</button>
          </div>
        )}
      </div>
    </Page>
  );
}
