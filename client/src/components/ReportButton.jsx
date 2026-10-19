import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Flag, Send, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import { useApp } from '../store.jsx';

/** "Report a mistake" next to a summary section: a short note that reaches the site owner. */
export default function ReportButton({ lectureId, section }) {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/reports', { lectureId, section, text });
      toast('תודה! הדיווח נשלח ויתוקן בהקדם');
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
      <button className="btn sm ghost report-btn no-print" onClick={() => setOpen((o) => !o)} title="מצאתם טעות בסעיף הזה?">
        <Flag size={13} /> דיווח על טעות
      </button>
      <AnimatePresence>
        {open && (
          <motion.form className="report-form no-print" onSubmit={send} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <textarea className="input" rows={3} autoFocus required minLength={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="מה לא נכון כאן? (למשל: בדוגמה 2 התוצאה צריכה להיות 40 ולא 45)" />
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>ביטול</button>
              <button className="btn sm accent" disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} שליחה</button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </>
  );
}
