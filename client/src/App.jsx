import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Home as HomeIcon, Search, Upload, Moon, Sun, Menu, Sparkles, Loader2, GraduationCap } from 'lucide-react';
import { useApp } from './store.jsx';
import { CourseIcon } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import Course from './pages/Course.jsx';
import Lecture from './pages/Lecture.jsx';
import Moodle from './pages/Moodle.jsx';
import { useFetch, STATIC } from './api.js';
import ChatPanel from './components/ChatPanel.jsx';
import UploadModal from './components/UploadModal.jsx';
import SearchPalette from './components/SearchPalette.jsx';

function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('theme', theme); } catch { /* storage unavailable */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

function Sidebar({ open, onNavigate }) {
  const { courses, status, progress, refreshCourses } = useApp();
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
      <div className="nav-label">הקורסים שלי</div>
      {courses.map((c) => {
        const studied = Object.keys(progress.studied).filter((id) => id.startsWith(c.id + '-')).length;
        return (
          <NavItem
            key={c.id}
            to={`/course/${c.id}`}
            color={c.color}
            icon={<span className="nav-dot"><CourseIcon name={c.icon} size={15} /></span>}
            label={c.short}
            count={c.processing ? <Loader2 size={13} className="spin" /> : c.lectureCount + (c.tutorialCount || 0) + (c.homeworkCount || 0) ? `${studied}/${c.lectureCount + (c.tutorialCount || 0) + (c.homeworkCount || 0)}` : '—'}
            onClick={onNavigate}
          />
        );
      })}
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
          {STATIC ? 'גרסת ענן · הצ׳אט וההעלאה במחשב' : ai?.ready ? (ai.provider === 'api' ? 'AI מחובר (API)' : 'AI מחובר (Claude Code)') : 'AI לא מחובר'}
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

export default function App() {
  const { openUpload, setSearchOpen, openChat, chat, uploadOpen, searchOpen, context } = useApp();
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
            <span className="kbd">⌘K</span>
          </button>
          <div className="spacer" />
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
        </header>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            <Route path="/" element={<Home />} />
            <Route path="/course/:id" element={<Course />} />
            <Route path="/course/:id/:tab" element={<Course />} />
            <Route path="/lecture/:id" element={<Lecture />} />
            <Route path="/moodle" element={<Moodle />} />
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
