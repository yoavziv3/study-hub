import { Link } from 'react-router-dom';
import { FolderUp, ShieldCheck } from 'lucide-react';
import { STATIC, useFetch } from '../api.js';
import { KIND_LABEL, extOf, formatSize } from '../lib/personalFiles.js';

/** The student's own files for this course and kind (cloud only), under the course's lectures or tutorials. */
export default function MyFiles({ courseId, kind }) {
  const { data } = useFetch(STATIC ? '/api/me/files' : null);
  if (!STATIC) return null;
  const mine = (data?.files || []).filter((f) => f.courseId === courseId && f.kind === kind);
  return (
    <div style={{ marginTop: 26 }}>
      <div className="row wrap" style={{ gap: 10, marginBottom: 8 }}>
        <h3 className="grow" style={{ fontSize: 17 }}><FolderUp size={16} style={{ verticalAlign: '-2px' }} /> {KIND_LABEL[kind]} שלי</h3>
        <Link className="btn sm" to={`/files?course=${courseId}&kind=${kind}`}>הוספת קובץ</Link>
      </div>
      {mine.length === 0 ? (
        <div className="faint" style={{ fontSize: 13.5 }}>יש לכם {KIND_LABEL[kind]} שלא עלו למודל? אפשר להוסיף אותם לעצמכם – הם פרטיים.</div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {mine.map((f) => (
            <Link key={f.id} to={`/file/${f.id}`} className="file-row" style={{ color: 'inherit' }}>
              <div className="file-ext" style={{ background: 'var(--c)' }}>{extOf(f.name).toUpperCase()}</div>
              <div className="grow" style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</div>
              <span className="faint num" style={{ fontSize: 12 }}>{formatSize(f.size)}</span>
            </Link>
          ))}
          <div className="faint row" style={{ fontSize: 12, gap: 6 }}><ShieldCheck size={13} /> פרטי – רק אתם רואים, בלי סיכום ושאלות</div>
        </div>
      )}
    </div>
  );
}
