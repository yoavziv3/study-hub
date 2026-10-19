import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Home as HomeIcon, Search, Upload, Moon, Sun, Menu, Sparkles, Loader2, GraduationCap, Bell, LogOut, Trash2, Hourglass, Users } from 'lucide-react';
import { useApp } from './store.jsx';
import { CourseIcon } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import Course from './pages/Course.jsx';
import Lecture from './pages/Lecture.jsx';
import Moodle from './pages/Moodle.jsx';
import Updates from './pages/Updates.jsx';
import Login from './pages/Login.jsx';
import { useFetch, STATIC } from './api.js';
import ChatPanel from './components/ChatPanel.jsx';
import UploadModal from './components/UploadModal.jsx';
import SearchPalette from './components/SearchPalette.jsx';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

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
  const total = c.lectureCount + (c.tutorialCount || 0) + (c.homeworkCount || 0);
  return (
    <NavItem
      to={`/course/${c.id}`}
      color={c.color}
      icon={<span className="nav-dot"><CourseIcon name={c.icon} size={15} /></span>}
      label={c.short}
      count={c.processing ? <Loader2 size={13} className="spin" /> : studied ? `${studied}/${total}` : null}
      onClick={onNavigate}
    />
  );
}

function Sidebar({ open, onNavigate }) {
  const { courses, otherCourses, status, progress, refreshCourses, unread, me } = useApp();
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
          <div className="brand-sub">שנה א׳ · סמסטר א׳</div>
        </div>
      </NavLink>
      <NavItem to="/" end icon={<HomeIcon size={17} />} label="לוח בקרה" onClick={onNavigate} />
      <NavItem to="/updates" icon={<Bell size={17} />} label="עדכונים" count={unread ? <span className="nav-badge">{unread}</span> : null} onClick={onNavigate} />
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
      <div className="sidebar-foot">
        <div className="ai-pill" title={ai ? `מודל: ${ai.model}` : ''}>
          <span className={`pulse ${ai?.ready ? '' : 'off'}`} />
          {STATIC ? (me?.moodleOk === false ? 'החיבור למודל פג – התחברו מחדש' : 'מחובר למודל') : ai?.ready ? (ai.provider === 'api' ? 'AI מחובר (API)' : 'AI מחובר (Claude Code)') : 'AI לא מחובר'}
        </div>
      </div>
    </aside>
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
    <div style={{ position: 'relative' }}>
      <button className="btn icon ghost avatar-btn" onClick={() => setOpen((o) => !o)} aria-label="החשבון שלי">{initials}</button>
      <AnimatePresence>
        {open && (
          <motion.div className="card account-menu" initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}>
            <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>{me.user?.name}</div>
              <div className="faint" style={{ fontSize: 12.5 }} dir="ltr">{me.user?.username}</div>
            </div>
            <button className="btn ghost sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { setOpen(false); signOut(); }}><LogOut size={15} /> התנתקות</button>
            <button className="btn ghost sm danger" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => { setOpen(false); remove(); }}><Trash2 size={15} /> מחיקת החשבון וכל המידע</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  const { me } = useApp();
  if (STATIC && me === null) return <div className="login-wrap"><Loader2 className="spin" size={28} /></div>;
  if (STATIC && me === false) return <Login />;
  return <Shell />;
}

function Shell() {
  const { openUpload, setSearchOpen, openChat, chat, uploadOpen, searchOpen, context, unread } = useApp();
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); openChat(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSearchOpen, openChat]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [location.pathname]);

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
      <Sidebar open={menu} onNavigate={() => setMenu(false)} />
      <main className="main">
        <header className={`topbar ${scrolled ? 'scrolled' : ''}`}>
          <button className="btn icon ghost menu-btn" onClick={() => setMenu((m) => !m)} aria-label="תפריט"><Menu size={20} /></button>
          <button className="search-trigger" onClick={() => setSearchOpen(true)}>
            <Search size={17} />
            <span className="grow" style={{ textAlign: 'start' }}>חיפוש בכל החומר – מושגים, שקפים, נושאים…</span>
            <span className="kbd">{IS_MAC ? '⌘K' : 'Ctrl K'}</span>
          </button>
          <div className="spacer" />
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
            <Upload size={17} /> העלאת הרצאה
          </button>
          <AccountMenu />
        </header>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Home />} />
            <Route path="/course/:id" element={<Course />} />
            <Route path="/course/:id/:tab" element={<Course />} />
            <Route path="/lecture/:id" element={<Lecture />} />
            <Route path="/moodle" element={<Moodle />} />
            <Route path="/updates" element={<Updates />} />
          </Routes>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {!chat.open && (
          <motion.button className="local-only chat-fab" onClick={() => openChat()} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} whileHover={{ y: -3 }} whileTap={{ scale: 0.95 }}>
            <span className="sparkle"><Sparkles size={16} /></span>
            <span className="label">שאל את המורה</span>
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>{chat.open && <ChatPanel key="chat" />}</AnimatePresence>
      <AnimatePresence>{uploadOpen && <UploadModal key="upload" />}</AnimatePresence>
      <AnimatePresence>{searchOpen && <SearchPalette key="search" />}</AnimatePresence>
    </div>
  );
}
