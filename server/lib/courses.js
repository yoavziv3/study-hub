// Semester courses (שנה א' – תבנית ב', סמסטר א'). Linear algebra and the library course are excluded on purpose.
/**
 * Which kinds of material get AI study material (summary, topics, questions, cards) in a course: lectures, and the
 * owner's own homework and exam-prep units. Tutorials go up as slides and files only (nobody reads a summary of a
 * worked-examples sheet), past exams as they are. A course built for other students can list the kinds it wants in
 * `aiKinds` (linear algebra: lectures only), and `bank: false` keeps it out of the question-bank growth.
 */
export function aiKindOk(course, kind = 'lecture') {
  if (course?.ai === false || kind === 'exam' || kind === 'tutorial') return false;
  return !course?.aiKinds || course.aiKinds.includes(kind);
}
export const bankOk = (course) => course?.ai !== false && course?.bank !== false;

/**
 * The subjects the site carries (the owner's rule): calculus, linear algebra, accounting, economics, physics and
 * information systems. A Moodle course of another student is built (and its files imported) only when its name is
 * one of these – English, Java, probability, Hebrew… never are, however many students sign in with them.
 */
const SITE_SUBJECTS = [/חדו/, /אלגברה לינארית/, /חשבונאות/, /כלכלה/, /פיזיקה|פיסיקה/, /מערכות מידע/];
export const subjectOk = (...names) => names.some((n) => SITE_SUBJECTS.some((re) => re.test(String(n || ''))));

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
