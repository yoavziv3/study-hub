import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info } from 'lucide-react';
import { api, hash, STATIC } from './api.js';

/* App-wide state: study progress (persisted on the server), courses list, toasts, chat + upload + search controls. */
const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const EMPTY = { studied: {}, quiz: {}, cards: {}, notes: {}, slidePos: {}, last: null, activity: {} };
const LEITNER_DAYS = [0, 1, 2, 4, 8, 16];

export function AppProvider({ children }) {
  const [progress, setProgress] = useState(EMPTY);
  const [courses, setCourses] = useState([]);
  const [status, setStatus] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [chat, setChat] = useState({ open: false, request: null });
  const [uploadOpen, setUploadOpen] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [context, setContext] = useState({});
  const saveTimer = useRef();
  const loaded = useRef(false);

  const refreshCourses = useCallback(() => api.get('/api/courses').then(setCourses).catch(() => {}), []);

  useEffect(() => {
    api.get('/api/progress').then((p) => { setProgress({ ...EMPTY, ...p }); loaded.current = true; }).catch(() => { loaded.current = true; });
    api.get('/api/status').then(setStatus).catch(() => {});
    refreshCourses();
  }, [refreshCourses]);

  const update = useCallback((fn) => {
    setProgress((prev) => {
      const next = fn(structuredClone(prev));
      const day = new Date().toISOString().slice(0, 10);
      next.activity = { ...next.activity, [day]: (next.activity?.[day] || 0) + 1 };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => api.put('/api/progress', next).catch(() => {}), 600);
      return next;
    });
  }, []);

  const toast = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const actions = useMemo(
    () => ({
      toggleStudied: (id) => update((p) => { if (p.studied[id]) delete p.studied[id]; else p.studied[id] = Date.now(); return p; }),
      recordAnswer: (lectureId, question, correct) =>
        update((p) => {
          const q = (p.quiz[lectureId] ||= { answered: 0, correct: 0, items: {} });
          q.answered += 1;
          if (correct) q.correct += 1;
          q.items[hash(question)] = correct;
          return p;
        }),
      gradeCard: (key, known) =>
        update((p) => {
          const c = p.cards[key] || { box: 0 };
          c.box = known ? Math.min(c.box + 1, 5) : 0;
          c.due = Date.now() + LEITNER_DAYS[c.box] * 86400000;
          c.seen = Date.now();
          p.cards[key] = c;
          return p;
        }),
      setNote: (id, text) => update((p) => { p.notes[id] = text; return p; }),
      visit: (lectureId, slide) => update((p) => { p.last = { lectureId, slide, at: Date.now() }; if (slide) p.slidePos[lectureId] = slide; return p; }),
    }),
    [update]
  );

  const openChat = useCallback((request = null) => {
    if (STATIC) return toast('הצ׳אט עם המורה זמין באתר שרץ במחשב שלך', 'info');
    setChat({ open: true, request: request ? { ...request, id: Math.random() } : null });
  }, [toast]);
  const closeChat = useCallback(() => setChat((c) => ({ ...c, open: false })), []);

  const value = {
    progress, courses, refreshCourses, status, toast, ...actions,
    chat, openChat, closeChat,
    uploadOpen, openUpload: (courseId = 'auto') => (STATIC ? toast('העלאת הרצאות זמינה באתר שרץ במחשב שלך', 'info') : setUploadOpen({ courseId })), closeUpload: () => setUploadOpen(null),
    searchOpen, setSearchOpen,
    context, setContext,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-wrap">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} className="toast" initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }}>
              {t.kind === 'ok' ? <CheckCircle2 size={18} color="#3ccf97" /> : <Info size={18} />}
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const cardKey = (lectureId, front) => `${lectureId}:${hash(front)}`;
