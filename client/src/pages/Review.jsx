import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Layers, Loader2 } from 'lucide-react';
import { useApp, cardKey } from '../store.jsx';
import { api } from '../api.js';
import { Page, fadeUp } from '../components/ui.jsx';
import Flashcards from '../components/Flashcards.jsx';

const NEW_PER_DAY = 15;

/** Today's review across all current courses: cards that are due (spaced repetition) plus a few new ones. */
export default function Review() {
  const { courses, progress, setContext } = useApp();
  const [all, setAll] = useState(null);
  useEffect(() => { setContext({}); }, [setContext]);

  useEffect(() => {
    let alive = true;
    Promise.all(courses.filter((c) => c.ai !== false).map((c) => api.get(`/api/courses/${c.id}/bundle`).catch(() => null)))
      .then((bundles) => {
        if (!alive) return;
        const cards = [];
        for (const b of bundles.filter(Boolean)) {
          for (const l of b.lectures) for (const f of l.content?.flashcards || []) cards.push({ ...f, lectureId: l.id, lectureTitle: `${b.short} · ${l.title}` });
        }
        setAll(cards);
      });
    return () => { alive = false; };
  }, [courses]);

  // Picked once per visit, so grading a card doesn't reshuffle the session.
  const today = useMemo(() => {
    if (!all) return null;
    const now = Date.now();
    const due = all.filter((c) => progress.cards[cardKey(c.lectureId, c.front)]?.due <= now);
    const fresh = all.filter((c) => !progress.cards[cardKey(c.lectureId, c.front)]).slice(0, NEW_PER_DAY);
    return { due: due.length, fresh: fresh.length, cards: [...due, ...fresh] };
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon"><Layers size={22} /></div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>חזרה להיום</h1>
            <div className="muted" style={{ fontSize: 14 }}>
              כרטיסיות מכל הקורסים: מה שהגיע הזמן לחזור עליו, ועוד {NEW_PER_DAY} חדשות ביום. כרטיסייה שידעת חוזרת אחרי יותר ימים, וכזו שלא – מחר.
            </div>
          </div>
          {today && <div className="row" style={{ gap: 6 }}><span className="chip warn">{today.due} לחזרה</span><span className="chip c">{today.fresh} חדשות</span></div>}
        </div>
      </motion.div>
      <div style={{ marginTop: 18 }}>
        {!today && <div style={{ padding: 40, textAlign: 'center' }}><Loader2 className="spin" /></div>}
        {today && (today.cards.length ? <Flashcards cards={today.cards} /> : (
          <div className="empty"><div className="empty-icon"><Layers size={28} /></div><h3>סיימת להיום 🎉</h3><p>אין כרטיסיות שמחכות לחזרה. מחר יחכו לך חדשות.</p></div>
        ))}
      </div>
    </Page>
  );
}
