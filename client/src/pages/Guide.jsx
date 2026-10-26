import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  CircleHelp, Home as HomeIcon, Bell, Building2, CalendarRange, CalendarCheck, BookOpen, FileText, Target, Layers, Calculator, Gauge,
  Search, History, ShieldCheck, ChevronDown, Table2, Activity, Smartphone, FolderUp,
} from 'lucide-react';
import { useApp } from '../store.jsx';
import { STATIC } from '../api.js';
import { Page, fadeUp } from '../components/ui.jsx';

// What each part of the site is for and how to use it. Written for a student opening it for the first time;
// `owner` entries show only to the site's owner (the degree committee).
const IS_IOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

const SECTIONS = [
  {
    id: 'install', icon: Smartphone, title: 'התקנה על הטלפון או האייפד', to: '/updates', cta: 'לעדכונים',
    short: 'האתר נפתח כמו אפליקציה, עם התראות.',
    steps: [
      IS_IOS
        ? 'ב-Safari (לא ב-Chrome): כפתור השיתוף ← "הוסף למסך הבית".'
        : 'בדפדפן: תפריט ← "התקנת אפליקציה" או "הוספה למסך הבית" (באייפון או באייפד: ב-Safari, כפתור השיתוף ← "הוסף למסך הבית").',
      'פותחים את האייקון "IEMprove" מהמסך הבית ומתחברים עם שם המשתמש והסיסמה של המודל.',
      'להתראות: בעמוד "עדכונים" לוחצים "הפעלת התראות" ומאשרים. באייפון זה עובד רק כשפותחים את האתר מהאייקון שבמסך הבית.',
    ],
    tip: 'אחרי עדכון של האתר, לפעמים צריך לסגור את האפליקציה לגמרי ולפתוח מחדש כדי לראות את הגרסה החדשה.',
  },
  {
    id: 'home', icon: HomeIcon, title: 'מסך הבית', to: '/', cta: 'למסך הבית',
    short: 'הכל ליום הנוכחי במקום אחד.',
    steps: [
      '"המשך מאיפה שעצרת" מחזיר אותך לשקף האחרון שראית.',
      '"השיעורים הבאים" מראה את המפגשים הקרובים שלך, עם חדר וזמן, כולל ביטולים.',
      '"מבחנים ובחנים קרובים" ו"הגשות קרובות" מראים כמה ימים נשארו.',
      'הקורסים שלך מופיעים מתחת, והחיפוש למעלה מחפש בכל החומר: מושגים, הגדרות ושקפים.',
    ],
  },
  {
    id: 'updates', icon: Bell, title: 'עדכונים והתראות', to: '/updates', cta: 'לעדכונים',
    short: 'חומר חדש, הודעות מהמרצים, שינויי כיתה והגשות.',
    steps: [
      'בעמוד "עדכונים": חומרים חדשים, הודעות מהקורסים, שינויי חדר או שעה, תאריכי מבחנים והודעות מהפורטל. אפשר לסנן בלשוניות.',
      '"רענון עכשיו" בודק במודל ובפורטל מיד, במקום לחכות לבדיקה האוטומטית.',
      '"הגשות קרובות" כוללות ספירה לאחור, מה צריך להגיש, וקישור להגשה במודל. ההגשה עצמה נעשית במודל.',
      'הוספה ליומן: "אייפון / מק" או "יומן גוגל" מוסיפים את ההגשות והמבחנים ליומן שלך, עם תזכורות.',
      'התראות לטלפון: "הפעלת התראות", ובוחרים אילו סוגים לקבל (הגשה מתקרבת, שינוי חדר, חומר חדש ועוד).',
    ],
    tip: 'הודעות שנכתבו לקבוצה אחרת מוסתרות. יש כפתור להצגתן אם רוצים.',
  },
  {
    id: 'portal', icon: Building2, title: 'חיבור מערכת השעות לפורטל', to: '/schedule', cta: 'לחיבור הפורטל',
    short: 'הקבוצות, החדרים והביטולים שלך נלקחים מהפורטל האישי.',
    steps: [
      'נכנסים ל"מערכת שעות", ובכרטיס "הפורטל הבן־גוריוני" לוחצים "חיבור הפורטל".',
      'מזינים את שם המשתמש, הסיסמה ותעודת הזהות של הפורטל. הם מוצפנים כבר בדפדפן שלך.',
      'תוך כדקה האתר קורא את המערכת שלך, בוחר לבד את הקבוצות הנכונות בכל קורס ומציג חדרים וביטולים.',
      'מכאן, התראות ועדכונים מגיעים רק על הקבוצות שלך. "ניתוק" מוחק את הפרטים.',
    ],
    tip: 'לא רוצים לחבר? בוחרים את הקבוצות ידנית בכרטיס "הקבוצות שלי", וגם אז מערכת השעות נבנית. הפורטל נותן דיוק גדול יותר בחדרים ובביטולים.',
  },
  {
    id: 'schedule', icon: CalendarRange, title: 'מערכת השעות', to: '/schedule', cta: 'למערכת השעות',
    short: 'השבוע שלך, עם שינויים, ביטולים וחדרים.',
    steps: [
      'בוחרים פעם אחת את הקבוצה בכל קורס (או שהפורטל בוחר בשבילך). בחירת שיעור בוחרת לבד את התרגול שמתאים לו.',
      'מפגש שבוטל מסומן "לא מתקיים" עד סוף המפגש, ואז הסימון יורד. חדר או שעה שהשתנו מתעדכנים במפגש.',
      '"שינויים במערכת השבוע" מרכז את כל מה שהשתנה.',
      '"שיתוף הקבוצות" יוצר קישור שחבר יכול לפתוח ולקבל את אותן קבוצות.',
    ],
  },
  {
    id: 'exams', icon: CalendarCheck, title: 'לוח מבחנים', to: '/exams', cta: 'ללוח המבחנים',
    short: 'כל המבחנים והבחנים של הקורסים שלך על ציר זמן אחד.',
    steps: [
      'מועד א׳, מועד ב׳ ובחנים, עם תאריך, שעה, מבנה וחדרים לפי הקבוצה שלך, וכמה ימים נשארו.',
      'מבחנים של קורסים שונים שצמודים (יום אחד הפרש) מסומנים באזהרה, כדי לתכנן הכנה מראש.',
      'אם התאריכים שונים בין קבוצות, "לשנות" בכרטיס מוביל לבחירת הקבוצה שלך בעמוד ההכנה למבחן.',
    ],
  },
  {
    id: 'course', icon: BookOpen, title: 'עמוד הקורס', to: '/', cta: 'לבחירת קורס',
    short: 'כל החומר של הקורס, בלשוניות.',
    steps: [
      'בראש העמוד: הקישור לסילבוס של הקורס, כמה זמן נשאר למבחן, והאנשים שמלמדים.',
      'שיעורים: כל מצגת, עם סיכום, נושאים, תרגול וכרטיסיות. סיכומים: כל השיעורים במסמך אחד, אפשר להדפיס או לשמור כ-PDF.',
      'תרגולים ושיעורי בית ותרגילים: מה שהמרצה העלה למודל, עם הנחיות ההגשה.',
      'מבחן תרגול: שאלות מכל הקורס. כרטיסיות ומילון מושגים, ונוסחאות (בחלק מהקורסים).',
      'הכנה למבחן: תוכנית יום־יום עד המבחן, מפת שליטה בכל שיעור, תרגול לפי החולשות, "הטעויות שלי" וסימולציית מבחן בזמן.',
      'מבחנים קודמים, קישורים (זום והקלטות) וציונים מהמודל, באותו עמוד.',
    ],
    tip: 'הסיכומים והשאלות נכתבים בעזרת AI. מצאתם טעות? ליד כל סעיף יש "דיווח על טעות".',
  },
  {
    id: 'lecture', icon: FileText, title: 'עמוד שיעור', to: '/', cta: 'לבחירת קורס',
    short: 'מצגת, סיכום, תרגול וכרטיסיות של שיעור אחד.',
    steps: [
      'מצגת: מדפדפים בשקפים, ואפשר להגדיל או לראות את הטקסט של השקף.',
      'סיכום ונושאים: הנקודות החשובות לפי סעיפים, עם קישור לשקפים שמהם הן נלקחו.',
      'תרגול: שאלות בסטים של 15, מהקל לקשה. שאלות שטעית בהן חוזרות. "לחזרה" שומר שאלה לאחר כך.',
      'כרטיסיות: מסמנים "ידעתי" או "לא ידעתי", והמערכת מחזירה אותן בזמן המתאים. מושגים: המילון של השיעור.',
      'הערות: מקום לרשום משהו אישי. "סימון כנלמד" נותן התקדמות בקורס.',
    ],
  },
  {
    id: 'files', icon: FolderUp, title: 'הקבצים שלי', to: '/files', cta: 'להעלאת קבצים',
    short: 'הרצאות ותרגולים שיש לך ולא עלו למודל, רק בשבילך.',
    steps: [
      'בוחרים קורס (גם אחד שאתם לא רשומים אליו), ואז "הרצאות" או "תרגולים", וגוררים לשם PDF, PowerPoint או Word.',
      'PDF נקרא ישר באתר, עמוד אחרי עמוד. קבצי PowerPoint ו-Word אפשר להוריד.',
      'הקבצים מופיעים גם בעמוד הקורס, מתחת לשיעורים או לתרגולים, בכותרת "שלי".',
      'הם פרטיים ולא עוברים AI: אין עליהם סיכום, שאלות או כרטיסיות. את אלה האתר בונה רק לחומר שעולה מהמודל.',
    ],
    tip: 'יש מקום ל-100MB לכל סטודנט, עד 20MB לקובץ. אפשר לשנות שם, להעביר בין הרצאה לתרגול ולמחוק.',
  },
  {
    id: 'review', icon: Layers, title: 'חזרה להיום', to: '/review', cta: 'לחזרה',
    short: 'כרטיסיות מכל הקורסים, רק מה שהגיע זמנו לחזור עליו.',
    steps: [
      'כל כרטיסייה חוזרת בהפרשים שגדלים ככל שאתה זוכר אותה טוב יותר.',
      'עשר דקות ביום עדיפות על שעה לפני המבחן.',
    ],
  },
  {
    id: 'grades', icon: Calculator, title: 'ציונים וממוצע', to: '/grades', cta: 'לציונים',
    short: 'ממוצע משוקלל, וכמה צריך במבחן.',
    steps: [
      'מזינים ציון סופי ונקודות זכות לכל קורס, והממוצע המשוקלל מחושב לבד, לכל סמסטר ומצטבר.',
      'בכל קורס "כמה צריך במבחן?" מראה איזה ציון נדרש כדי להגיע לציון סופי שבחרת. רכיבי הציון והמשקלים נקראים מהסילבוס.',
      '"מגן" ליד רכיב אומר שהוא נספר רק אם הוא משפר את הציון. אפשר לסמן גם "מינימום במבחן".',
      'בלשונית "ציונים" של כל קורס מופיעים הציונים מהמודל.',
    ],
    tip: 'זו הערכה שלך לבדיקה, לא ציון רשמי. הציון הרשמי מופיע בפורטל של האוניברסיטה.',
  },
  {
    id: 'weekly', icon: Gauge, title: 'דוח עומס שבועי', to: '/weekly', cta: 'לדוח',
    short: 'מה מחכה לך השבוע.',
    steps: ['כל יום ראשון בבוקר: ההגשות, המבחנים והבחנים של השבוע, החומר החדש, ועצה קצרה לכל קורס.'],
  },
  {
    id: 'tools', icon: Search, title: 'חיפוש וטיימר לימוד', to: '/', cta: 'למסך הבית',
    short: 'שני כלים בסרגל העליון.',
    steps: [
      'החיפוש מחפש בכותרות, נושאים, מושגים והטקסט של כל השקפים, ומוביל ישר למקום.',
      'הטיימר מנהל סבבי ריכוז והפסקה, ומראה כמה זמן למדת היום.',
    ],
  },
  {
    id: 'archive', icon: History, title: 'לימודי עבר', to: '/archive', cta: 'ללימודי עבר',
    short: 'סמסטרים קודמים נשמרים.',
    steps: ['כשסמסטר נגמר, הקורסים, הסיכומים וההתקדמות שלך נשארים כאן, ואפשר לחזור אליהם בכל רגע.'],
  },
  {
    id: 'privacy', icon: ShieldCheck, title: 'פרטיות ואבטחה', to: '/privacy', cta: 'לפרטיות',
    short: 'מה נשמר, ואיך מוחקים.',
    steps: ['המפתח של המודל והפרטים של הפורטל נשמרים מוצפנים. ב"פרטיות ואבטחה" רואים בדיוק מה נשמר, ואפשר למחוק את החשבון וכל המידע בלחיצה (בתפריט החשבון).'],
  },
  {
    id: 'committee', committee: true, memberSteps: 1, icon: Table2, title: 'מערכת הועד', to: '/committee', cta: 'למערכת הועד',
    short: 'כל הקורסים זה על גבי זה, כדי למצוא שעות פנויות.',
    steps: [
      'מסמנים אילו מסלולים (שיעור עם תרגול) פתוחים למחזור, והעמוד מראה מתי אף סטודנט לא בשיעור.',
      '"לוח מבחנים" מציג גם תצוגת ועד: כל תאריכי המבחנים בכל הקבוצות והמרווחים ביניהם.',
      'העדכונים וההתראות שלך מוגבלים לקבוצות של המחזור, והודעות פורטל של כל הסטודנטים מגיעות אליך, בלי שם.',
    ],
  },
  {
    id: 'system', owner: true, icon: Activity, title: 'מצב המערכת', to: '/system', cta: 'למצב המערכת',
    short: 'האם כל חלקי המערכת עובדים.',
    steps: ['רשימת בדיקות: ההתראות, מעקב המודל, קריאת הפורטל, המחשב, ה-AI, "מה חסר באתר" והעדכון בענן. כשמשהו נעצר, מגיעה אליך התראה.'],
  },
];

export default function Guide() {
  const { me, setContext } = useApp();
  const { hash } = useLocation();
  useEffect(() => { setContext({}); }, [setContext]);
  const owner = !STATIC || me?.owner;
  const committee = !STATIC || me?.committee;
  const list = SECTIONS.filter((s) => (!s.owner || owner) && (!s.committee || committee));

  // A link like /guide#portal opens that part.
  useEffect(() => {
    const el = hash ? document.getElementById(hash.slice(1)) : null;
    if (!el) return undefined;
    el.open = true;
    // After the page's own scroll-to-top on a route change.
    const t = setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 400);
    return () => clearTimeout(t);
  }, [hash]);

  return (
    <Page>
      <motion.div className="card pad" style={{ marginTop: 10, padding: 24 }} variants={fadeUp} initial="hidden" animate="show">
        <div className="row wrap" style={{ gap: 14 }}>
          <div className="course-icon"><CircleHelp size={22} /></div>
          <div className="grow">
            <h1 style={{ fontSize: 26 }}>איך משתמשים באתר</h1>
            <div className="muted" style={{ fontSize: 14 }}>מה יש בכל חלק של האתר ואיך משתמשים בו. לוחצים על נושא כדי לפתוח.</div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 6, marginTop: 14 }}>
          {list.map((s) => <a key={s.id} href={`#${s.id}`} className="chip">{s.title}</a>)}
        </div>
      </motion.div>

      <div className="stack" style={{ gap: 10, marginTop: 16 }}>
        {list.map((s) => (
          <details key={s.id} id={s.id} className="card guide-item">
            <summary>
              <span className="nav-dot guide-icon"><s.icon size={16} /></span>
              <span className="grow" style={{ minWidth: 0 }}>
                <b style={{ display: 'block' }}>{s.title}{(s.owner || s.committee) && <span className="chip" style={{ marginInlineStart: 8 }}>לועד</span>}</b>
                <span className="faint" style={{ fontSize: 13 }}>{s.short}</span>
              </span>
              <ChevronDown size={18} className="guide-chev" />
            </summary>
            <div className="guide-body">
              <ol>{s.steps.slice(0, !owner && s.memberSteps ? s.memberSteps : undefined).map((t, i) => <li key={i}>{t}</li>)}</ol>
              {s.tip && <div className="callout" style={{ marginTop: 10 }}>💡 {s.tip}</div>}
              <Link to={s.to} className="btn sm" style={{ marginTop: 12 }}>{s.cta}</Link>
            </div>
          </details>
        ))}
      </div>
    </Page>
  );
}
