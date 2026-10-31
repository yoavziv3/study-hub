// Semester courses (שנה א' – תבנית ב', סמסטר א'). Linear algebra and the library course are excluded on purpose.
/**
 * Which kinds of material get AI study material (summary, topics, questions, cards) in a course: lectures, and the
 * owner's own homework and exam-prep units. Tutorials go up as slides and files only (nobody reads a summary of a
 * worked-examples sheet), past exams as they are. A course built for other students can list the kinds it wants in
 * `aiKinds` (`[]`: none – calculus and linear algebra lectures go up as they are), `aiFrom: 'upload'` (physics: only files
 * the owner gives directly) and `aiBy: 'gemini'` (which provider writes the lessons, ai.js generateLesson); `bank: false`
 * keeps it out of the question-bank growth.
 */
export function aiKindOk(course, kind = 'lecture', meta = null) {
  if (course?.ai === false || kind === 'exam' || kind === 'tutorial') return false;
  // aiFrom: 'upload' – AI only for files the owner gives directly (upload / inbox), not for what the Moodle sync brings in.
  if (course?.aiFrom === 'upload' && (meta?.source?.fileKey || meta?.source?.moodleId)) return false;
  return !course?.aiKinds || course.aiKinds.includes(kind);
}
export const bankOk = (course) => course?.ai !== false && course?.bank !== false;

/**
 * The courses the site carries (the owner's rule): calculus 1 for engineering, linear algebra for engineering,
 * financial and managerial accounting, economics for industrial engineering, introduction to physics and information
 * systems. A Moodle course of another student is built (and its files imported) only when its name is one of these
 * (another group of the same course counts) – English, Java, probability, Hebrew, "calculus ג1", "introduction to
 * accounting" and the like never are, however many students sign in with them.
 */
const SUBJECTS = {
  calc: /חדו.{0,2}א\s*1\b/,
  linear: /אלגברה לינארית להנדסה/,
  accounting: /חשבונאות פיננסית/,
  economics: /מבוא לכלכלה ל(הנדסת )?תעשי/,
  physics: /מבוא לפיזיקה|מבוא לפיסיקה/,
  systems: /יסודות מערכות מידע/,
};
export const subjectOk = (...names) => names.some((n) => Object.values(SUBJECTS).some((re) => re.test(String(n || ''))));
/** Which of the six subjects a course is (another group of the same course gives the same answer), or null. */
export const subjectOf = (course) => Object.entries(SUBJECTS).find(([, re]) => [course?.name, course?.short].some((n) => re.test(String(n || ''))))?.[0] || null;

export const DEFAULT_COURSES = [
  {
    id: 'econ',
    code: '142-1-3141',
    name: 'מבוא לכלכלה להנדסת תעשייה וניהול',
    short: 'מבוא לכלכלה',
    color: 'emerald',
    icon: 'TrendingUp',
    staff: ['איתי שורץ', 'אוסקר ווליך', 'שירלי ליכטמן-שדות'],
    unitLabel: 'הרצאה',
    tagline: 'מחסור, בחירה, עלות אלטרנטיבית, שווקים ומסחר',
    keywords: ['כלכלה', 'כלכלי', 'עקומת התמורה', 'עלות אלטרנטיבית', 'יתרון יחסי', 'ביקוש', 'היצע', 'אינפלציה', 'מסחר', 'שוק', 'econ', 'economics', 'מבוא לכלכלה', 'גמישות', 'פירמה', 'מונופול'],
  },
  {
    id: 'calc',
    code: '214-1-9711',
    name: 'חדו"א 1 להנדסה',
    short: 'חדו"א 1',
    color: 'violet',
    icon: 'Sigma',
    staff: [],
    unitLabel: 'הרצאה',
    tagline: 'גבולות, רציפות, נגזרות ואינטגרלים',
    keywords: ['חדו"א', 'חדוא', 'גבול', 'נגזרת', 'אינטגרל', 'רציפות', 'סדרה', 'סדרות', 'פונקציה', 'calculus', 'limit', 'derivative', 'integral', 'טור', 'טיילור', 'אפסילון'],
  },
  {
    id: 'is',
    code: '364-1-4141',
    name: 'יסודות מערכות מידע',
    short: 'מערכות מידע',
    color: 'sky',
    icon: 'Network',
    staff: ['ד"ר דוד קודיש'],
    unitLabel: 'שיעור',
    tagline: 'ארגון, מידע, מערכות – והטכנולוגיה שמחברת ביניהם',
    keywords: ['מערכות מידע', 'מערכת מידע', 'TPS', 'MIS', 'DSS', 'EIS', 'ERP', 'BI', 'CIO', 'ארגון', 'תהליך עסקי', 'נתונים', 'information system', 'קודיש', 'IoT', 'בינה עסקית'],
  },
  {
    id: 'phys',
    code: '',
    name: 'פיזיקה',
    short: 'פיזיקה',
    color: 'rose',
    icon: 'Atom',
    staff: [],
    unitLabel: 'הרצאה',
    tagline: 'קינמטיקה, כוחות, אנרגיה ותנע',
    keywords: ['פיזיקה', 'פיסיקה', 'physics', 'קינמטיקה', 'דינמיקה', 'ניוטון', 'כוח', 'תאוצה', 'מהירות', 'אנרגיה', 'תנע', 'וקטור', 'חיכוך', 'מטען', 'שדה חשמלי', 'עבודה והספק'],
  },
  {
    id: 'acc',
    code: '681-1-4021',
    name: 'חשבונאות פיננסית וניהולית',
    short: 'חשבונאות',
    color: 'amber',
    icon: 'Calculator',
    staff: ['רו"ח אלעזר טובול', 'עומר עזריה (מתרגל)'],
    unitLabel: 'יחידה',
    tagline: 'הזהות החשבונאית, התהליך החשבונאי, פחת וניתוח דוחות',
    keywords: ['חשבונאות', 'חשבונאי', 'מאזן', 'פחת', 'רכוש קבוע', 'חובה', 'זכות', 'פקודת יומן', 'רווח והפסד', 'IFRS', 'טובול', 'יחידה', 'התאמה', 'הון עצמי', 'רואה חשבון'],
    // Units in this course are grouped into class meetings (from the course plan in unit 1).
    unitToLesson: { 1: 1, 2: 1, 4: 1, 3: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, 11: 9, 12: 9, 13: 10, 14: 11 },
  },
];
