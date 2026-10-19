import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Send, Square, Trash2, Sparkles, Copy } from 'lucide-react';
import { useApp } from '../store.jsx';
import { streamChat } from '../api.js';
import { Markdown } from './ui.jsx';

const SUGGEST = {
  lecture: ['סכם לי את ההרצאה ב-5 נקודות', 'הסבר את השקף הזה בפשטות', 'בחן אותי בשאלה ברמת מבחן', 'מה הכי חשוב לזכור למבחן מההרצאה?'],
  course: ['מה הנושאים המרכזיים בקורס עד עכשיו?', 'תן לי תרגיל לתרגול עם פתרון', 'איך הנושאים בקורס מתחברים זה לזה?', 'צור לי תוכנית חזרה לשבוע'],
  global: ['מה כדאי לי ללמוד היום?', 'הסבר לי מה זה עלות אלטרנטיבית', 'מה ההבדל בין הוצאה לתשלום?', 'מה זה מערכת TPS?'],
};

export default function ChatPanel() {
  const { context, closeChat, chat } = useApp();
  const scopeKey = context.lectureId ? `lecture:${context.lectureId}` : context.courseId ? `course:${context.courseId}` : 'global';
  const storeKey = `chat:${scopeKey}`;
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(storeKey)) || []; } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef();
  const bodyRef = useRef();
  const inputRef = useRef();
  const handled = useRef(null);

  useEffect(() => {
    try { setMessages(JSON.parse(sessionStorage.getItem(storeKey)) || []); } catch { setMessages([]); }
  }, [storeKey]);

  useEffect(() => {
    try { sessionStorage.setItem(storeKey, JSON.stringify(messages.filter((m) => !m.pending))); } catch { /* ignore */ }
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, storeKey]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && closeChat();
    window.addEventListener('keydown', onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [closeChat]);

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput('');
    const history = [...messages.filter((m) => m.role !== 'error'), { role: 'user', content }];
    setMessages([...history, { role: 'assistant', content: '', pending: true }]);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    let acc = '';
    try {
      await streamChat(
        { messages: history.map(({ role, content }) => ({ role, content })), courseId: context.courseId, lectureId: context.lectureId, slide: context.slide },
        {
          signal: ac.signal,
          onText: (t) => {
            acc += t;
            setMessages([...history, { role: 'assistant', content: acc, pending: true }]);
          },
        }
      );
      setMessages([...history, { role: 'assistant', content: acc || '_(אין תשובה)_' }]);
    } catch (e) {
      if (ac.signal.aborted) setMessages([...history, { role: 'assistant', content: acc + '\n\n_(נעצר)_' }]);
      else setMessages([...history, ...(acc ? [{ role: 'assistant', content: acc }] : []), { role: 'error', content: e.message }]);
    } finally {
      setBusy(false);
    }
  }

  // Requests from elsewhere in the app ("explain this slide", "ask about this term").
  useEffect(() => {
    if (chat.request && handled.current !== chat.request.id) {
      handled.current = chat.request.id;
      if (chat.request.autoSend) send(chat.request.prompt);
      else setInput(chat.request.prompt || '');
    }
  }, [chat.request]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions = useMemo(() => SUGGEST[context.lectureId ? 'lecture' : context.courseId ? 'course' : 'global'], [context]);

  return (
    <motion.aside
      className="chat-panel"
      data-color={context.color}
      initial={{ opacity: 0, x: -40, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -40, scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
    >
      <div className="chat-head">
        <div className="chat-avatar"><Sparkles size={19} /></div>
        <div className="grow">
          <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)' }}>המורה הפרטי</div>
          <div className="chat-scope">{context.label ? `מחובר ל: ${context.label}${context.slide ? ` · שקף ${context.slide}` : ''}` : 'מחובר לכל הקורסים'}</div>
        </div>
        {messages.length > 0 && (
          <button className="btn sm icon ghost" title="ניקוי שיחה" onClick={() => setMessages([])}><Trash2 size={16} /></button>
        )}
        <button className="btn sm icon ghost" onClick={closeChat} aria-label="סגירה"><X size={18} /></button>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {messages.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="stack" style={{ margin: 'auto 0' }}>
            <h3 style={{ fontSize: 22 }}>במה לעזור? 👋</h3>
            <p className="muted" style={{ margin: 0 }}>
              אני מכיר את כל המצגות שהעלית. אפשר לשאול על מושג, לבקש הסבר לשקף, תרגיל לתרגול או סיכום ממוקד.
            </p>
            <div className="chat-suggest">
              {suggestions.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
            </div>
          </motion.div>
        )}
        {messages.map((m, i) => (
          <motion.div key={i} className={`msg ${m.role}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            {m.role === 'assistant' ? (
              m.pending && !m.content ? (
                <div className="typing"><span /><span /><span /></div>
              ) : (
                <>
                  <div className={m.pending ? 'caret' : ''}><Markdown>{m.content}</Markdown></div>
                  {!m.pending && (
                    <button className="btn sm ghost" style={{ marginTop: 4, color: 'var(--text-3)' }} onClick={() => navigator.clipboard?.writeText(m.content)}>
                      <Copy size={13} /> העתקה
                    </button>
                  )}
                </>
              )
            ) : (
              m.content
            )}
          </motion.div>
        ))}
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder="שאלו כל דבר על החומר…"
          onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        {busy ? (
          <button type="button" className="btn icon" onClick={() => abortRef.current?.abort()} title="עצירה"><Square size={16} /></button>
        ) : (
          <motion.button whileTap={{ scale: 0.9 }} type="submit" className="btn icon accent" disabled={!input.trim()} title="שליחה"><Send size={17} style={{ transform: 'scaleX(-1)' }} /></motion.button>
        )}
      </form>
    </motion.aside>
  );
}
