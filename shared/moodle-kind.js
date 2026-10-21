// What kind of study material a Moodle file is (lecture, tutorial, homework, past exam – or not material at all),
// from its file, module and section names. Shared by the Mac (server/lib/ingest.js, moodle.js), which imports
// the files, and the cloud (cloud/lib/moodle-watch.js), which tells students about new ones before the Mac has
// processed them – so both agree on what counts.

// Files the site turns into lectures.
export const ACCEPTED = ['.pdf', '.pptx', '.ppt'];
export const accepted = (filename = '') => ACCEPTED.some((ext) => filename.toLowerCase().endsWith(ext));

// Past exams ("מבחן מועד א 2024", "בחינה לדוגמה", "exam 2023") – not quizzes or exam-day instructions.
export const EXAM_RE = /מבחן|מבחנים|בחינה|בחינות|מועד\s*[אבג]['׳]?(?![\u0590-\u05FF])|(?<![a-z])exams?(?![a-z])|moed[\s_-]*[abc](?![a-z])|midterm|final[\s_-]*exam/i;
const NOT_EXAM_RE = /הדרכה לקראת|נהלי|הנחיות לבחינ|לוח בחינות|תאריכי בחינות/i;
const TUTORIAL_RE = /תרגול|tutorial|recitation|tirgul/i;
const HOMEWORK_RE = /תרגיל|שיעורי בית|ש["״']ב(?![\u0590-\u05FF])|homework|\bhw\s*\d|exercise|assignment|problem[\s_-]*set|מטל[הו]|גיליון|חוברת תרגילים|פתרון|פתרונות|solution|booklet/i;
export function detectKind(...texts) {
  const t = texts.filter(Boolean).join(' ');
  if (EXAM_RE.test(t) && !NOT_EXAM_RE.test(t)) return 'exam';
  if (TUTORIAL_RE.test(t) && !/חוברת/.test(t)) return 'tutorial';
  if (HOMEWORK_RE.test(t)) return 'homework';
  return 'lecture';
}

// Which files in a course page become site items, and of which type.
export const LECTURE_HINT = /הרצא|שיעור(?!י בית)|יחידה|מצגת|שקפים|lecture|slides?|presentation|week|שבוע|chapter|פרק/i;
// Not imported as material (they still appear under "קישורים"). Past exams are imported – as their own kind.
export const EXCLUDE = /בוחן|סילבוס|syllabus|quiz|דף נוסחאות|formula sheet|ציונים|grades|נהלי|לוח זמנים|הדרכה לקראת|הנחיות לבחינ/i;

/** 'lecture' | 'tutorial' | 'homework' | null (not imported automatically). */
export function classify(filename, moduleName, sectionName) {
  const own = `${moduleName || ''} ${filename}`;
  if (EXCLUDE.test(own)) return null;
  const ownKind = detectKind(own);
  if (ownKind !== 'lecture') return ownKind;
  const secKind = detectKind(sectionName || '');
  const isDeck = /\.pptx?$/i.test(filename);
  // Section titles are broad ("מצגת וחוברת תרגילים"), so they only decide when the file itself says nothing.
  if (isDeck) return secKind === 'tutorial' && !LECTURE_HINT.test(sectionName || '') ? 'tutorial' : 'lecture';
  if (LECTURE_HINT.test(own)) return 'lecture';
  if (secKind !== 'lecture') return secKind;
  return LECTURE_HINT.test(sectionName || '') ? 'lecture' : null;
}

// Moodle rich text (announcements, assignment descriptions) → readable plain text with line breaks and links.
