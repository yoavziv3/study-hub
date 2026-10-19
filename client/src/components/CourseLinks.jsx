import { motion } from 'motion/react';
import { Video, MonitorPlay, Globe, FileText, Folder, File, ScrollText, ListChecks, ExternalLink } from 'lucide-react';
import { fadeUp } from './ui.jsx';

const TYPE = {
  zoom: { icon: Video, label: 'זום' },
  online: { icon: MonitorPlay, label: 'שיעור מקוון / הקלטות' },
  link: { icon: Globe, label: 'קישור' },
  page: { icon: FileText, label: 'דף במודל' },
  folder: { icon: Folder, label: 'תיקייה' },
  file: { icon: File, label: 'קובץ' },
  syllabus: { icon: ScrollText, label: 'סילבוס' },
  activity: { icon: ListChecks, label: 'פעילות במודל' },
};

const host = (href) => {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Everything on the course's Moodle page that isn't a lecture file: Zoom, recordings, links, syllabus, activities. */
export default function CourseLinks({ links }) {
  if (!links?.length) {
    return <div className="empty"><div className="empty-icon"><Globe size={28} /></div><h3>אין קישורים בקורס הזה</h3><p>קישורי זום, הקלטות, סילבוס וקישורים חיצוניים מדף הקורס במודל יופיעו כאן.</p></div>;
  }
  const groups = [];
  for (const l of links) {
    const name = l.section || 'כללי';
    if (!groups.length || groups.at(-1)[0] !== name) groups.push([name, []]);
    groups.at(-1)[1].push(l);
  }
  return (
    <div className="stack" style={{ gap: 18 }}>
      {groups.map(([section, items]) => (
        <div key={section}>
          <div className="links-section">{section}</div>
          <div className="links-grid">
            {items.map((l, i) => {
              const T = TYPE[l.type] || TYPE.link;
              const domain = host(l.href);
              return (
                <motion.a key={l.id} href={l.href} target="_blank" rel="noreferrer" className="card hover link-card" variants={fadeUp} initial="hidden" animate="show" custom={i % 10}>
                  <div className="link-icon"><T.icon size={18} /></div>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="link-name">{l.name}</div>
                    <div className="faint" style={{ fontSize: 12.5 }}>{T.label}{l.type === 'link' && domain ? ` · ${domain}` : ''}{l.ext ? ` · ${l.ext.toUpperCase()}` : ''}</div>
                  </div>
                  <ExternalLink size={15} className="faint" />
                </motion.a>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
