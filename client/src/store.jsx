import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info } from 'lucide-react';
import { api, hash, STATIC, AUTH_EVENT, resetSearchIndex } from './api.js';
import { termsOf, currentTerm, inTerm } from './lib/terms.js';

/* App-wide state: the signed-in student (cloud), study progress, courses, updates & deadlines, toasts,
   chat + upload + search controls. Locally (on the Mac) there is no sign-in and data comes from the server. */
const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const EMPTY = { studied: {}, quiz: {}, cards: {}, notes: {}, slidePos: {}, last: null, activity: {} };
const LEITNER_DAYS = [0, 1, 2, 4, 8, 16];
const DAY = 86400000;
const OLD_LOCAL_PROGRESS = 'study-progress'; // progress kept in the browser before accounts existed

const whenText = (ms) => {
  if (ms < DAY) {
    const h = Math.max(1, Math.round(ms / 3600000));
    return h === 1 ? 'בעוד שעה' : h === 2 ? 'בעוד שעתיים' : `בעוד ${h} שעות`;
  }
  const d = Math.round(ms / DAY);
  return d === 1 ? 'בעוד יום' : d === 2 ? 'בעוד יומיים' : `בעוד ${d} ימים`;
};
const fmtDue = (iso) => new Date(iso).toLocaleString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

export function AppProvider({ children }) {
  // Cloud: null = checking, false = signed out, object = the student. Locally there is always a "user".
  const [me, setMe] = useState(STATIC ? null : { local: true });
  const [progress, setProgress] = useState(EMPTY);
  const [progressLoaded, setProgressLoaded] = useState(false); // automatic writes wait for the saved progress
  const [allCourses, setCourses] = useState([]);
  const [status, setStatus] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [chat, setChat] = useState({ open: false, request: null });
  const [uploadOpen, setUploadOpen] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [context, setContext] = useState({});
  const [feed, setFeed] = useState({ items: [], deadlines: [], since: null, settings: {} });
  const [personal, setPersonal] = useState([]); // cloud: the student's pending Moodle submissions
  const saveTimer = useRef();
  const signedIn = !!me;

  const refreshMe = useCallback(
    () => api.get('/api/me').then(setMe).catch((e) => { if (e.status === 401) setMe(false); }),
    []
  );
  // On the Mac, the name comes from the connected Moodle account (used in the greeting).
  useEffect(() => {
    if (STATIC) return;
    api.get('/api/moodle').then((m) => m.user && setMe((prev) => ({ ...prev, user: { name: m.user.fullname, username: m.user.username } }))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!STATIC) return undefined;
    refreshMe();
    const onAuth = () => setMe(false);
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_EVENT, onAuth);
  }, [refreshMe]);

  const refreshCourses = useCallback(() => api.get('/api/courses').then(setCourses).catch(() => {}), []);
  const refreshUpdates = useCallback(() => {
    api.get('/api/updates').then(setFeed).catch(() => {});
    if (STATIC) {
      api.get('/api/me/deadlines').then(setPersonal).catch((e) => {
        if (e.relogin) setMe((m) => (m ? { ...m, moodleOk: false } : m));
      });
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return undefined;
    refreshUpdates();
    const t = setInterval(refreshUpdates, STATIC ? 5 * 60000 : 60000);
    return () => clearInterval(t);
  }, [signedIn, refreshUpdates]);

  useEffect(() => {
    if (!signedIn) return;
    resetSearchIndex();
    api.get('/api/progress')
      .then((p) => {
        let next = { ...EMPTY, ...p };
        if (STATIC && !p.updatesSeenAt) {
          // First sign-in on the cloud: bring over progress saved in this browser before accounts, and start
          // the updates feed "read" so a new student isn't greeted by dozens of old items.
          try {
            const old = JSON.parse(localStorage.getItem(OLD_LOCAL_PROGRESS) || 'null');
            if (old && !Object.keys(p).length) next = { ...EMPTY, ...old };
          } catch { /* storage unavailable */ }
          next.updatesSeenAt = next.updatesSeenAt || new Date().toISOString();
          api.put('/api/progress', next).catch(() => {});
        }
        setProgress(next);
        setProgressLoaded(true);
      })
      .catch(() => {});
    api.get('/api/status').then(setStatus).catch(() => {});
    refreshCourses();
  }, [signedIn, refreshCourses]);

  // quiet: bookkeeping that isn't studying (e.g. fixing today's plan) doesn't count as activity for the streak.
  const update = useCallback((fn, { quiet = false } = {}) => {
    setProgress((prev) => {
      const next = fn(structuredClone(prev));
      if (!quiet) {
        const day = new Date().toISOString().slice(0, 10);
        next.activity = { ...next.activity, [day]: (next.activity?.[day] || 0) + 1 };
      }
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
      // Exam preparation: exam dates per course ({ a, b } as YYYY-MM-DD), flagged questions, simulations,
      // the pre-exam checklist and today's plan.
      setExam: (courseId, dates) => update((p) => {
        p.exams ||= {};
        if (!dates.a && !dates.b) delete p.exams[courseId];
        else p.exams[courseId] = { a: dates.a || '', b: dates.b || '' };
        return p;
      }, { quiet: true }),
      updatePrep: (courseId, fn, opts) => update((p) => {
        p.prep ||= {};
        p.prep[courseId] = fn({ checks: {}, custom: [], sims: [], ...(p.prep[courseId] || {}) });
        return p;
      }, opts),
      toggleFlag: (key) => update((p) => {
        p.flagged ||= {};
        if (p.flagged[key]) delete p.flagged[key];
        else p.flagged[key] = Date.now();
        return p;
      }, { quiet: true }),
      visit: (lectureId, slide) => update((p) => { p.last = { lectureId, slide, at: Date.now() }; if (slide) p.slidePos[lectureId] = slide; return p; }),
      markUpdatesSeen: () => update((p) => { p.updatesSeenAt = new Date().toISOString(); return p; }),
      markOnboarded: () =>
        setProgress((prev) => {
          const next = { ...prev, onboardedAt: new Date().toISOString() };
          api.put('/api/progress', next).catch(() => {});
          return next;
        }),
    }),
    [update]
  );

  /* Deadlines: locally they live on the Mac's server; in the cloud Moodle's own list is merged with the
     student's "done" marks and personal deadlines, which are saved with their progress. */
  const deadlineActions = useMemo(
    () => ({
      toggleDone: async (d) => {
        if (!STATIC) return api.patch(`/api/updates/deadlines/${d.id}`, { done: !d.done }).then(refreshUpdates);
        update((p) => {
          if (d.source === 'manual') {
            p.manualDeadlines = (p.manualDeadlines || []).map((x) => (x.id === d.id ? { ...x, done: !x.done } : x));
          } else {
            p.deadlinesDone ||= {};
            if (p.deadlinesDone[d.moodleKey]) delete p.deadlinesDone[d.moodleKey];
            else p.deadlinesDone[d.moodleKey] = Date.now();
          }
          return p;
        });
      },
      addManual: async (form) => {
        if (!STATIC) return api.post('/api/updates/deadlines', form).then(refreshUpdates);
        if (!form.title?.trim() || Number.isNaN(new Date(form.dueAt).getTime())) throw new Error('צריך כותרת ותאריך');
        update((p) => {
          p.manualDeadlines = [...(p.manualDeadlines || []), { id: Math.random().toString(36).slice(2, 10), ...form, title: form.title.trim(), done: false }];
          return p;
        });
      },
      removeManual: async (id) => {
        if (!STATIC) return api.del(`/api/updates/deadlines/${id}`).then(refreshUpdates);
        update((p) => { p.manualDeadlines = (p.manualDeadlines || []).filter((x) => x.id !== id); return p; });
      },
      setReminderDays: async (reminderDays) => {
        if (!STATIC) return api.put('/api/updates/settings', { reminderDays }).then(refreshUpdates);
        const r = await api.put('/api/me/settings', { reminderDays });
        setMe((m) => (m ? { ...m, reminderDays: r.reminderDays } : m));
      },
    }),
    [update, refreshUpdates]
  );

  const updates = useMemo(() => {
    if (!STATIC) return feed;
    const done = progress.deadlinesDone || {};
    const deadlines = [
      ...personal.map((d) => ({ ...d, source: 'moodle', intro: d.action || '', submitted: false, done: !!done[d.moodleKey] })),
      ...(progress.manualDeadlines || []).map((d) => ({ ...d, source: 'manual' })),
    ].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    // Reminders: one per deadline, for the closest threshold already crossed (default 3 days and 1 day before).
    const days = me?.reminderDays?.length ? me.reminderDays : [3, 1];
    const now = Date.now();
    const reminders = [];
    for (const d of deadlines) {
      const due = Date.parse(d.dueAt);
      if (d.done || due <= now) continue;
      const crossed = days.filter((x) => due - x * DAY <= now);
      if (!crossed.length) continue;
      const x = Math.min(...crossed);
      reminders.push({
        id: `rem-${d.id}-${x}`,
        type: 'reminder',
        courseId: d.courseId,
        title: `⏰ ${whenText(due - now)}: ${d.title}`,
        body: `להגשה עד ${fmtDue(d.dueAt)}`,
        url: d.url,
        addedAt: new Date(due - x * DAY).toISOString(),
      });
    }
    return {
      ...feed,
      deadlines,
      items: [...feed.items, ...reminders].sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
      settings: { reminderDays: days },
    };
  }, [feed, personal, progress.deadlinesDone, progress.manualDeadlines, me]);

  const openChat = useCallback((request = null) => {
    if (STATIC) return toast('הצ׳אט עם המורה זמין באתר שרץ במחשב שלך', 'info');
    setChat({ open: true, request: request ? { ...request, id: Math.random() } : null });
  }, [toast]);
  const closeChat = useCallback(() => setChat((c) => ({ ...c, open: false })), []);

  const forgetCachedData = () => navigator.serviceWorker?.controller?.postMessage('clear-data');
  const signOut = useCallback(async () => {
    await api.post('/api/auth/logout', {}).catch(() => {});
    forgetCachedData();
    setMe(false);
    setProgress(EMPTY);
    setProgressLoaded(false);
    setCourses([]);
    setPersonal([]);
    setFeed({ items: [], deadlines: [], since: null, settings: {} });
  }, []);
  const deleteAccount = useCallback(async () => {
    await api.del('/api/me');
    forgetCachedData();
    try { localStorage.removeItem(OLD_LOCAL_PROGRESS); } catch { /* storage unavailable */ }
    setMe(false);
    setProgress(EMPTY);
    setCourses([]);
    setPersonal([]);
    setFeed({ items: [], deadlines: [], since: null, settings: {} });
  }, []);

  // Unread = added after the last visit to the updates page (or after the feed started, on first use).
  const seenAt = progress.updatesSeenAt && progress.updatesSeenAt > (updates.since || '') ? progress.updatesSeenAt : updates.since || '';
  const unread = updates.items.filter((i) => i.addedAt > seenAt && i.addedAt <= new Date().toISOString()).length;

  useEffect(() => {
    document.title = unread ? `(${unread}) מחברת · סמסטר א׳` : 'מחברת · סמסטר א׳';
  }, [unread]);

  // "My courses" are this semester's; earlier semesters live under "לימודי עבר".
  // On the Mac, courses built for other students (no AI material) are listed separately from yours.
  const mine = useMemo(() => (STATIC ? allCourses : allCourses.filter((c) => !c.remote)), [allCourses]);
  const terms = useMemo(() => termsOf(mine), [mine]);
  const term = useMemo(() => currentTerm(mine), [mine]);
  const courses = useMemo(() => mine.filter((c) => inTerm(c, term)), [mine, term]);
  const pastCourses = useMemo(() => mine.filter((c) => !inTerm(c, term)), [mine, term]);
  const otherCourses = useMemo(() => (STATIC ? [] : allCourses.filter((c) => c.remote && inTerm(c, term))), [allCourses, term]);

  const value = {
    me, refreshMe, signOut, deleteAccount,
    updates, refreshUpdates, unread, seenAt, deadlineActions,
    progress, progressLoaded, courses, otherCourses, allCourses: mine, pastCourses, terms, term, refreshCourses, status, toast, ...actions,
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
