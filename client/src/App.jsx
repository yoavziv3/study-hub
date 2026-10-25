import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Home as HomeIcon, Search, Upload, Moon, Sun, Menu, Sparkles, Loader2, GraduationCap, Bell, LogOut, Trash2, Hourglass, Users, AlertTriangle, History, Flag, ShieldCheck, X, CalendarRange, Calculator, Activity, RefreshCw, Gauge, ListChecks, Table2, CalendarCheck } from 'lucide-react';
import { useApp } from './store.jsx';
import { CourseIcon, SiteFooter } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
// Everything else is loaded when first opened, so the first screen (home or sign-in) downloads only what it shows.
const Course = lazy(() => import('./pages/Course.jsx'));
const Lecture = lazy(() => import('./pages/Lecture.jsx'));
const Moodle = lazy(() => import('./pages/Moodle.jsx'));
const Updates = lazy(() => import('./pages/Updates.jsx'));
const Archive = lazy(() => import('./pages/Archive.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Review = lazy(() => import('./pages/Review.jsx'));
const Schedule = lazy(() => import('./pages/Schedule.jsx'));
const Grades = lazy(() => import('./pages/Grades.jsx'));
const Privacy = lazy(() => import('./pages/Privacy.jsx'));
const System = lazy(() => import('./pages/System.jsx'));
const Committee = lazy(() => import('./pages/Committee.jsx'));
const Exams = lazy(() => import('./pages/Exams.jsx'));
const Weekly = lazy(() => import('./pages/Weekly.jsx'));
const Runs = lazy(() => import('./pages/Runs.jsx'));
const Onboarding = lazy(() => import('./components/Onboarding.jsx'));
const ChatPanel = lazy(() => import('./components/ChatPanel.jsx'));
const UploadModal = lazy(() => import('./components/UploadModal.jsx'));
const SearchPalette = lazy(() => import('./components/SearchPalette.jsx'));
import StudyTimer from './components/StudyTimer.jsx';

const PageLoader = () => <div style={{ padding: 60, textAlign: 'center' }}><Loader2 className="spin" /></div>;
import { SEMESTER_LABEL, studyYearLabel } from './lib/terms.js';
import Feedback from './components/Feedback.jsx';
import { useFetch, STATIC } from './api.js';

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* storage unavailable */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

function CourseNav({ c, progress, onNavigate }) {
  const studied = Object.keys(progress.studied).filter((id) => id.startsWith(c.id + '-')).length;
  const total = c.lectureCount + (c.tutorialCount || 0) + (c.homeworkCount || 0) + (c.prepCount || 0);
  return (
    <NavItem
      to={`/course/${c.id}`}
      color={c.color}
      icon={<span className="nav-dot"><CourseIcon name={c.icon} size={15} /></span>}
      label={c.short}
      count={c.processing ? <Loader2 size={13} className="spin" /> : total ? `${studied}/${total}` : '—'}
      onClick={onNavigate}
    />
  );
}

function Sidebar({ open, onNavigate }) {
  const { courses, otherCourses, status, progress, refreshCourses, unread, me, term, terms } = useApp();
  const navigate = useNavigate();
  const { data: moodle } = useFetch('/api/moodle', { poll: () => !STATIC, interval: 15000 });
  // New lectures may have arrived from Moodle – refresh the course counters after each sync.
  useEffect(() => { if (moodle?.lastSync) refreshCourses(); }, [moodle?.lastSync, refreshCourses]);
  const ai = status?.ai;
  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <NavLink to="/" className="brand" onClick={onNavigate}>
        <div className="brand-mark" />
        <div>
          <div className="brand-name">מחברת</div>
          <div className="brand-sub">{term ? `${studyYearLabel(term, terms)} · ${SEMESTER_LABEL[term.semester]}` : 'עזר ללימודים'}</div>
        </div>
      </NavLink>
      <NavItem to="/" end icon={<HomeIcon size={17} />} label="מסך הבית" onClick={onNavigate} />
      <NavItem to="/updates" icon={<Bell size={17} />} label="עדכונים" count={unread ? <span className="nav-badge">{unread}</span> : null} onClick={onNavigate} />
      <NavItem to="/schedule" icon={<CalendarRange size={17} />} label="מערכת שעות" onClick={onNavigate} />
      <NavItem to="/exams" icon={<CalendarCheck size={17} />} label="לוח מבחנים" onClick={onNavigate} />
      <NavItem to="/weekly" icon={<Gauge size={17} />} label="דוח עומס שבועי" onClick={onNavigate} />
      <NavItem to="/grades" icon={<Calculator size={17} />} label="ציונים וממוצע" onClick={onNavigate} />
      <div className="nav-label">הקורסים שלי</div>
      {courses.map((c) => <CourseNav key={c.id} c={c} progress={progress} onNavigate={onNavigate} />)}
      {STATIC && me?.pending?.length > 0 && (
        <div className="nav-pending" title="הקורסים האלה נבנים מהמודל – החומר יופיע כאן בקרוב">
          {me.pending.map((p) => (
            <div key={p.moodleId} className="row" style={{ gap: 8 }}><Hourglass size={13} /> <span className="grow">{p.name}</span></div>
          ))}
          <div className="faint" style={{ fontSize: 11.5 }}>בהכנה – יופיעו אחרי הסנכרון הבא</div>
        </div>
      )}
      <NavItem to="/archive" icon={<History size={17} />} label="לימודי עבר" onClick={onNavigate} />
      {otherCourses.length > 0 && (
        <>
          <div className="nav-label row" style={{ gap: 6 }}><Users size={12} /> קורסים של סטודנטים אחרים</div>
          {otherCourses.map((c) => <CourseNav key={c.id} c={c} progress={progress} onNavigate={onNavigate} />)}
        </>
      )}
      {!STATIC && <div className="nav-label">כלים</div>}
      {!STATIC && <NavItem
        to="/moodle"
        icon={<GraduationCap size={17} />}
        label="סנכרון מודל"
        count={moodle?.syncing ? <Loader2 size={13} className="spin" /> : <span className={`pulse ${moodle?.connected ? '' : 'off'}`} style={{ display: 'inline-block' }} />}
        onClick={onNavigate}
      />}
      {!STATIC && <NavItem to="/reports" icon={<Flag size={17} />} label="דיווחים ומשוב" onClick={onNavigate} />}
      {!STATIC && <NavItem to="/runs" icon={<ListChecks size={17} />} label="יומן הרצות" onClick={onNavigate} />}
      {(!STATIC || me?.owner) && <NavItem to="/committee" icon={<Table2 size={17} />} label="מערכת הועד" onClick={onNavigate} />}
      {(!STATIC || me?.owner) && <NavItem to="/system" icon={<Activity size={17} />} label="מצב המערכת" onClick={onNavigate} />}
      <div className="sidebar-foot">
        <Feedback />
        <StatusPill
          items={STATIC
            ? [me?.moodleOk === false ? { bad: true, text: 'החיבור למודל פג – התנתקו והתחברו שוב' } : { text: 'מחובר למודל' }]
            : [
                !moodle?.connected ? { bad: true, text: 'המודל לא מחובר' }
                  : moodle.health?.problems?.length ? { bad: true, text: moodle.health.problems[0] } : { text: 'מחובר למודל' },
                ai?.ready ? { text: ai.provider === 'gemini' ? 'AI מחובר (Gemini + Claude)' : ai.provider === 'api' ? 'AI מחובר (API)' : 'AI מחובר (Claude Code)' } : { bad: true, text: 'AI לא מחובר' },
              ]}
          onClick={!STATIC ? () => { onNavigate?.(); navigate('/moodle'); } : undefined}
        />
      </div>
    </aside>
  );
}

/** Connection status at the bottom of the sidebar: a green dot when all is well, red with a warning sign when not. */
function StatusPill({ items, onClick }) {
  const bad = items.some((i) => i.bad);
  return (
    <button className={`ai-pill ${bad ? 'bad' : ''}`} onClick={onClick} disabled={!onClick} title={bad ? 'יש בעיה בחיבור' : ''}>
      <div className="stack" style={{ gap: 6, width: '100%' }}>
        {items.map((i) => (
          <div key={i.text} className="row" style={{ gap: 8 }}>
            {i.bad ? <AlertTriangle size={14} className="status-warn" /> : <span className="pulse" />}
            <span style={{ textAlign: 'start' }}>{i.text}</span>
          </div>
        ))}
      </div>
    </button>
  );
}

function NavItem({ to, end, icon, label, count, color, onClick }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} data-color={color} onClick={onClick}>
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="nav-bg" className="nav-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
          {icon}
          <span>{label}</span>
          {count != null && <span className="nav-count">{count}</span>}
        </>
      )}
    </NavLink>
  );
}

function AccountMenu() {
  const { me, signOut, deleteAccount, toast } = useApp();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  // A tap outside the menu, or Escape, closes it (on a phone there's no other way out).
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!STATIC || !me) return null;
  const initials = (me.user?.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('');
  const remove = async () => {
    if (!confirm('למחוק את החשבון? מפתח המודל, ההתקדמות וההערות שלך יימחקו לגמרי מהאתר.')) return;
    try {
      await deleteAccount();
      toast('החשבון וכל המידע נמחקו');
    } catch (e) {
      toast(e.message, 'info');
    }
  };
  return (
    <div style={{ position: 'relative' }} ref={box}>
      <button className="btn icon ghost avatar-btn" onClick={() => setOpen((o) => !o)} aria-label="החשבון שלי" aria-expanded={open}>{initials}</button>
      <AnimatePresence>
        {open && (
          <motion.div className="card account-menu" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}>
            <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>{me.user?.name}</div>
              <div className="faint" style={{ fontSize: 12.5 }} dir="ltr">{me.user?.username}</div>
            </div>
            <Link className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} to="/privacy" onClick={() => setOpen(false)}><ShieldCheck size={15} /> פרטיות ואבטחה</Link>
            <button className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { setOpen(false); signOut(); }}><LogOut size={15} /> התנתקות</button>
            <button className="btn ghost sm danger" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { setOpen(false); remove(); }}><Trash2 size={15} /> מחיקת החשבון וכל המידע</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The student's Moodle token expired: deadlines, grades and reminders stop until they sign in again. */
function ReloginBanner() {
  const { signOut } = useApp();
  return (
    <div className="page" style={{ paddingTop: 0, paddingBottom: 0 }}>
      <div className="callout row wrap" style={{ gap: 10, marginTop: 10, background: 'var(--warn-bg)' }}>
        <AlertTriangle size={17} color="var(--warn)" />
        <span className="grow">החיבור שלך למודל פג, אז ההגשות, הציונים והתזכורות לא מתעדכנים. ההתקדמות שלך שמורה.</span>
        <button className="btn sm primary" onClick={signOut}><RefreshCw size={14} /> התחברות מחדש</button>
      </div>
    </div>
  );
}

export default function App() {
  const { me } = useApp();
  const location = useLocation();
  // The privacy page is readable before signing in.
  if (STATIC && !me && location.pathname === '/privacy') return <Suspense fallback={<PageLoader />}><Privacy /></Suspense>;
  if (STATIC && me === null) return <div className="login-wrap"><Loader2 className="spin" size={28} /></div>;
  if (STATIC && me === false) return <Login />;
  return <Shell />;
}

function Shell() {
  const { openUpload, setSearchOpen, openChat, chat, uploadOpen, searchOpen, context, unread, me, progress, markOnboarded } = useApp();
  // First sign-in on the cloud site (progress has loaded – updatesSeenAt is set then): a short tour, once.
  const showTour = STATIC && !!me && !!progress.updatesSeenAt && !progress.onboardedAt;
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setMenu(false);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); openChat(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSearchOpen, openChat]);

  useEffect(() => { window.scrollTo({ top: 0 }); setMenu(false); }, [location.pathname]);

  // Global drag & drop: dropping files anywhere opens the upload dialog with them.
  useEffect(() => {
    const over = (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); };
    const drop = (e) => {
      if (STATIC || !e.dataTransfer?.files?.length || e.defaultPrevented) return;
      e.preventDefault();
      window.__droppedFiles = [...e.dataTransfer.files];
      openUpload(context.courseId || 'auto');
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, [openUpload, context.courseId]);

  return (
    <div className="app" data-color={context.color}>
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>דילוג לתוכן</a>
      <Sidebar open={menu} onNavigate={() => setMenu(false)} />
      <AnimatePresence>
        {menu && <motion.div className="sidebar-backdrop" onClick={() => setMenu(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}
      </AnimatePresence>
      <main className="main" id="main" tabIndex={-1}>
        <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
          <button className="btn icon ghost menu-btn" onClick={() => setMenu((m) => !m)} aria-label={menu ? 'סגירת התפריט' : 'פתיחת התפריט'} aria-expanded={menu}>{menu ? <X size={20} /> : <Menu size={20} />}</button>
          <button className="search-trigger" onClick={() => setSearchOpen(true)}>
            <Search size={17} />
            <span className="grow search-long" style={{ textAlign: 'start' }}>חיפוש בכל החומר – מושגים, שקפים, נושאים…</span>
            <span className="grow search-short" style={{ textAlign: 'start' }}>חיפוש</span>
          </button>
          <div className="spacer" />
          <StudyTimer />
          <motion.button className="btn icon ghost bell" onClick={() => navigate('/updates')} aria-label="עדכונים" whileTap={{ scale: 0.9 }}
            animate={unread ? { rotate: [0, -14, 12, -8, 6, 0] } : { rotate: 0 }} transition={{ duration: 0.8, repeat: unread ? Infinity : 0, repeatDelay: 6 }}>
            <Bell size={19} />
            <AnimatePresence>
              {unread > 0 && (
                <motion.span className="bell-badge" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 20 }}>
                  {unread > 99 ? '99+' : unread}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
          <button className="btn icon ghost" onClick={toggleTheme} aria-label="מצב תצוגה">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={theme} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.25 }} style={{ display: 'grid' }}>
                {theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
              </motion.span>
            </AnimatePresence>
          </button>
          <button className="local-only btn primary" onClick={() => openUpload(context.courseId || 'auto')}>
            <Upload size={17} /> <span className="hide-phone">העלאת הרצאה</span>
          </button>
          <AccountMenu />
        </header>
        {STATIC && me?.moodleOk === false && <ReloginBanner />}
        <Suspense fallback={<PageLoader />}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Home />} />
            <Route path="/course/:id" element={<Course />} />
            <Route path="/course/:id/:tab" element={<Course />} />
            <Route path="/lecture/:id" element={<Lecture />} />
            <Route path="/moodle" element={<Moodle />} />
            <Route path="/updates" element={<Updates />} />
            <Route path="/archive" element={<Archive />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/review" element={<Review />} />
            <Route path="/schedule" element={<Schedule />} />
            <Route path="/exams" element={<Exams />} />
            <Route path="/grades" element={<Grades />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/system" element={<System />} />
            <Route path="/committee" element={!STATIC || me?.owner ? <Committee /> : <Navigate to="/" replace />} />
            <Route path="/weekly" element={<Weekly />} />
            <Route path="/runs" element={<Runs />} />
          </Routes>
        </AnimatePresence>
        </Suspense>
        <SiteFooter />
      </main>

      <AnimatePresence>
        {!chat.open && (
          <motion.button className="local-only chat-fab" onClick={() => openChat()} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} whileHover={{ y: -3 }} whileTap={{ scale: 0.95 }}>
            <span className="sparkle"><Sparkles size={16} /></span>
            <span className="label">שאל את המורה</span>
          </motion.button>
        )}
      </AnimatePresence>
      <Suspense fallback={null}>
      <AnimatePresence>{chat.open && <ChatPanel key="chat" />}</AnimatePresence>
      <AnimatePresence>{uploadOpen && <UploadModal key="upload" />}</AnimatePresence>
      <AnimatePresence>{searchOpen && <SearchPalette key="search" />}</AnimatePresence>
      <AnimatePresence>{showTour && <Onboarding key="tour" name={me?.user?.name?.trim().split(/\s+/)[0]} onDone={markOnboarded} />}</AnimatePresence>
      </Suspense>
    </div>
  );
}
