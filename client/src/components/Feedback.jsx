import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import { MessageSquare, Send, Loader2, X } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../store.jsx';

/** "שליחת משוב": anything about the site – something missing, broken, or an idea. Reaches the site owner. */
export default function Feedback() {
  const { toast } = useApp();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/feedback', { text, page: location.pathname });
      toast('תודה! המשוב נשלח');
      setText('');
      setOpen(false);
    } catch (err) {
      toast(err.message, 'info');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className="feedback-btn" onClick={() => setOpen(true)}><MessageSquare size={15} /> שליחת משוב</button>
      <AnimatePresence>
        {open && (
          <motion.div className="overlay" style={{ placeItems: 'center' }} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal" role="dialog" aria-modal="true" aria-label="שליחת משוב" style={{ width: 'min(520px, 100%)' }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            <form onSubmit={send}>
              <div className="row" style={{ marginBottom: 6 }}>
                <h2 className="grow">שליחת משוב</h2>
                <button type="button" className="btn sm icon ghost" aria-label="סגירה" onClick={() => setOpen(false)}><X size={18} /></button>
              </div>
              <p className="muted" style={{ margin: '0 0 12px', fontSize: 14 }}>משהו חסר, לא עובד או שיש לכם רעיון? זה מגיע ישירות למי שבנה את האתר.</p>
              <textarea className="input" rows={5} autoFocus required minLength={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} aria-label="המשוב שלך" placeholder="למשל: בטלפון הכפתור של… לא עובד / היה עוזר אם…" style={{ height: 'auto', padding: '10px 12px', resize: 'vertical', font: 'inherit' }} />
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button type="button" className="btn ghost" onClick={() => setOpen(false)}>ביטול</button>
                <button className="btn accent" disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} שליחה</button>
              </div>
            </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
