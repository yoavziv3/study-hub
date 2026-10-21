// Prompts and JSON schemas for lecture analysis, practice generation, classification and chat.

const str = { type: 'string' };
const strArr = { type: 'array', items: str };
const obj = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

const quizItem = obj({
  question: str,
  options: strArr,
  correctIndex: { type: 'integer' },
  explanation: str,
  difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
  slide: { type: 'integer' },
});

export const LECTURE_SCHEMA = obj({
  title: str,
  lessonNumber: { type: 'integer' },
  overview: str,
  summary: str,
  keyPoints: strArr,
  topics: {
    type: 'array',
    items: obj({ title: str, slideStart: { type: 'integer' }, slideEnd: { type: 'integer' }, summary: str, keyTerms: strArr }),
  },
  glossary: { type: 'array', items: obj({ term: str, definition: str }) },
  formulas: { type: 'array', items: obj({ name: str, latex: str, explanation: str }) },
  quiz: { type: 'array', items: quizItem },
  openQuestions: { type: 'array', items: obj({ question: str, answer: str }) },
  flashcards: { type: 'array', items: obj({ front: str, back: str }) },
  examTips: strArr,
});

export const PRACTICE_SCHEMA = obj({ quiz: { type: 'array', items: quizItem } });

export const CLASSIFY_SCHEMA = obj({ courseId: str, confidence: { type: 'number' }, lessonNumber: { type: 'integer' }, title: str });

const STYLE = `כתוב בעברית תקנית וברורה, בגוף שני לסטודנט. Markdown מלא מותר: כותרות ##/###, רשימות, טבלאות, **הדגשות** וציטוטים.
נוסחאות מתמטיות ב-LaTeX: $...$ בתוך שורה ו-$$...$$ בשורה נפרדת. מונחים באנגלית מופיעים בסוגריים אחרי המונח העברי.
כללי נוסחאות (חובה – האתר מוצג מימין לשמאל):
- לעולם אל תכתוב מילים בעברית בתוך LaTeX (גם לא ב-\\text{}). נוסחה במילים כתוב כטקסט רגיל מודגש, למשל: **רווח = הכנסות − הוצאות**.
- ב-LaTeX השתמש רק בסמלים לטיניים ובמספרים (C, R, n, X, Y, D_t), והסבר בעברית מה כל סמל מייצג – לפני או אחרי הנוסחה.
- ערך מוחלט כתוב \\lvert x \\rvert ולא |x| (במיוחד בתוך טבלאות). מספרים עם פסיק אלפים כתוב 90{,}000.
- סימן דולר כמטבע כתוב \\$ כדי שלא ייקרא כנוסחה.`;

export function lectureSystem(course) {
  return `אתה מורה פרטי מצטיין ומומחה בקורס "${course.name}" (${course.code}) לסטודנטים שנה א' בהנדסת תעשייה וניהול באוניברסיטת בן-גוריון.
המשימה: להפוך חומר מהקורס (מצגת הרצאה, תרגול או דף שיעורי בית) לחומר לימוד מלא ומקצועי לקראת מבחן. היצמד לחומר שבקובץ, ובמקום שהוא מקוצר – השלם הסבר והקשר כפי שמרצה או מתרגל היה מסביר, בלי להמציא עובדות שאינן נכונות. בפתרון תרגילים – בדוק כל חישוב.
${STYLE}`;
}

const KIND_INTRO = {
  lecture: 'שקפי ההרצאה',
  tutorial: 'חומר התרגול (מצגת או דף תרגול של המתרגל)',
  homework: 'דף שיעורי הבית / חוברת התרגילים (ייתכן שכולל גם פתרונות)',
  prep: 'טקסט השקפים של השיעור מהסמסטר הקודם',
};

const KIND_FIELDS = {
  lecture: `- title: כותרת קצרה ומדויקת להרצאה (בלי "הרצאה 1" – רק הנושא).
- lessonNumber: מספר השיעור/ההרצאה/היחידה אם מופיע בשקפים או בשם הקובץ, אחרת 0.
- overview: 2–3 משפטים – על מה ההרצאה ומה המטרה שלה.
- summary: סיכום מקיף ומסודר של כל החומר (Markdown עם ## לכל נושא, טבלאות השוואה כשמתאים, דוגמאות מספריות מהשקפים פתורות צעד-צעד). זה הסיכום שהסטודנט ילמד ממנו למבחן – אל תדלג על נושאים.
- keyPoints: 6–10 נקודות הכי חשובות, משפט אחד כל אחת.
- topics: חלוקת ההרצאה ל-4–9 נושאים לפי סדר השקפים; לכל נושא טווח שקפים (slideStart/slideEnd), תקציר Markdown של 3–6 שורות ומונחי מפתח.
- glossary: כל המושגים החשובים עם הגדרה מדויקת וקצרה (8–20).
- formulas: נוסחאות/כללים מרכזיים ב-LaTeX עם הסבר (רשימה ריקה אם אין).
- quiz: 10–14 שאלות אמריקאיות ברמת מבחן, 4 אפשרויות, מסיחים סבירים, correctIndex מבוסס 0, הסבר שמסביר גם למה המסיחים שגויים, רמת קושי, ומספר השקף הרלוונטי. שלב שאלות חישוב כשהחומר מאפשר.
- openQuestions: 4–6 שאלות פתוחות/תרגילים עם פתרון מלא ומנומק.
- flashcards: 12–20 כרטיסיות שינון (צד קדמי: מושג/שאלה קצרה; צד אחורי: תשובה תמציתית).
- examTips: 3–6 טיפים – טעויות נפוצות ומה חשוב לזכור למבחן.`,
  tutorial: `זה תרגול – הדגש הוא על **שיטות פתרון ודוגמאות פתורות**, לא על תיאוריה.
- title: הנושא של התרגול (בלי "תרגול 3").
- lessonNumber: מספר התרגול אם מופיע, אחרת 0.
- overview: 2–3 משפטים – אילו סוגי בעיות נפתרו בתרגול.
- summary: לכל סוג בעיה (## כותרת): מתי משתמשים בשיטה, האלגוריתם צעד-אחר-צעד, ואז כל דוגמה מהתרגול פתורה במלואה. בסוף – "טעויות נפוצות".
- keyPoints: 5–8 כללי אצבע לפתרון.
- topics: חלוקה לפי סוגי הבעיות/התרגילים, עם טווחי עמודים (slideStart/slideEnd).
- glossary: מונחים וכללים שהופיעו (5–15).
- formulas: כל הנוסחאות שבהן השתמשו ב-LaTeX.
- quiz: 10–14 שאלות אמריקאיות בסגנון התרגול – רובן שאלות חישוב/יישום, עם הסבר מלא.
- openQuestions: 4–6 תרגילים חדשים מאותו סוג ובאותה רמה, עם פתרון מלא צעד-צעד.
- flashcards: 8–15 כרטיסיות על שיטות וכללים ("איך פותרים…", "מתי משתמשים ב…").
- examTips: 3–6 טיפים לפתרון בעיות מהסוג הזה במבחן.`,
  homework: `זה דף שיעורי בית / תרגילים – הדגש הוא על **הבעיות עצמן ופתרונן המלא**.
- title: שם קצר לדף (למשל "שיעורי בית 3 – נגזרות" או "חוברת תרגילים – פרק 2"). בלי "פתרון", "פתרונות" או "פתרון מלא" בכותרת.
- lessonNumber: מספר הדף/המטלה אם מופיע, אחרת 0.
- overview: 2–3 משפטים – אילו נושאים הדף מתרגל ומה רמת הקושי.
- summary: לכל תרגיל בדף (## תרגיל N): נוסח התרגיל, ואחריו פתרון מלא ומנומק צעד-אחר-צעד (אם יש בקובץ פתרון – התבסס עליו; אחרת פתור בעצמך בקפידה). אם הדף ארוך מאוד – כסה את כל התרגילים, בקיצור סביר.
- keyPoints: 5–8 שיטות/כללים שחוזרים בתרגילים.
- topics: חלוקה לפי נושאים/פרקים בדף, עם טווחי עמודים (slideStart/slideEnd).
- glossary: מונחים ומשפטים שהתרגילים נשענים עליהם (5–15).
- formulas: הנוסחאות/המשפטים הדרושים לפתרון, ב-LaTeX.
- quiz: 10–14 שאלות אמריקאיות **ברמת שיעורי הבית** שבודקות את אותן מיומנויות (בעיקר חישוב/יישום), עם הסבר מלא.
- openQuestions: 5–8 תרגילים **חדשים** באותה רמה ובאותו סגנון של הדף, עם פתרון מלא צעד-צעד.
- flashcards: 8–15 כרטיסיות על השיטות ("איך מוכיחים…", "מה הצעד הראשון ב…").
- examTips: 3–6 טיפים – טעויות נפוצות בתרגילים מהסוג הזה.`,
};

export function lecturePrompt({ course, kind = 'lecture', fileName, slides, hint }) {
  const deck = slides.map((t, i) => `<slide n="${i + 1}">\n${t || '(עמוד ללא טקסט – כנראה תמונה/גרף/כתב יד)'}\n</slide>`).join('\n');
  return `להלן הטקסט של ${KIND_INTRO[kind] || KIND_INTRO.lecture} "${fileName}" בקורס ${course.short}.${hint ? `\nמידע נוסף: ${hint}` : ''}

<deck slides="${slides.length}">
${deck}
</deck>

הפק אובייקט JSON לפי הסכמה:
${KIND_FIELDS[kind] || KIND_FIELDS.lecture}`;
}

/**
 * Exam-prep unit: a lesson from an earlier semester of the course (e.g. the course's NotebookLM), as slide text
 * plus a transcript of the lesson itself – no deck file. Same schema as a lecture.
 */
export function prepPrompt({ course, lesson, semester, slides, transcript }) {
  const deck = slides.map((t, i) => `<slide n="${i + 1}">\n${t}\n</slide>`).join('\n');
  return `להלן החומר של שיעור ${lesson} בקורס ${course.short} מ${semester}: הטקסט של השקפים ותמלול של השיעור עצמו. השנה השיעור הזה עוד לא נלמד, והחומר משמש להכנה למבחן.
הטקסט של השקפים חולץ מ-PDF, ולכן לפעמים סדר המילים בשורה הפוך או מבולגן – שחזר את המשמעות. מספרי ה-slide מתייחסים לקטעים שבתוך <deck>.
מהתמלול קח את מה שהמרצה הדגיש, הסביר בדוגמאות או אמר שחשוב (במיוחד למבחן), ושלב את זה בסיכום, בשאלות ובטיפים למבחן. אל תצטט את התמלול ואל תזכיר שמות של סטודנטים.

<deck slides="${slides.length}">
${deck}
</deck>
${transcript ? `\n<transcript>\n${transcript}\n</transcript>\n` : ''}
הפק אובייקט JSON לפי הסכמה:
${KIND_FIELDS.lecture}`;
}

/** Structured study notes: sections in lecture order, each made of typed blocks (definition / example / rule …). */
const noteBlock = obj({
  type: { type: 'string', enum: ['text', 'definition', 'example', 'rule', 'important', 'mistake'] },
  title: str,
  body: str,
});
export const NOTES_SCHEMA = obj({
  subtitle: str,
  sections: {
    type: 'array',
    items: obj({ title: str, slideStart: { type: 'integer' }, slideEnd: { type: 'integer' }, blocks: { type: 'array', items: noteBlock } }),
  },
  takeaways: strArr,
});

const NOTES_FOCUS = {
  lecture: 'סדר הסעיפים לפי סדר ההרצאה. כל מושג חדש – בלוק definition; כל דוגמה מהשקפים (במיוחד מספרית) – בלוק example פתור צעד-אחר-צעד.',
  tutorial: 'סעיף לכל סוג בעיה בתרגול: קודם בלוק rule עם השיטה/האלגוריתם בצעדים, אחר כך כל תרגיל מהתרגול כבלוק example פתור במלואו, ובסוף mistake לטעויות הנפוצות.',
};

export function notesPrompt({ course, kind = 'lecture', fileName, slides, summary }) {
  const deck = slides.map((t, i) => `<slide n="${i + 1}">\n${t || '(עמוד ללא טקסט)'}\n</slide>`).join('\n');
  return `כתוב סיכום לימודי מסודר ל${KIND_INTRO[kind] || KIND_INTRO.lecture} "${fileName}" בקורס ${course.short} – הסיכום שהסטודנט קורא כדי לדעת את כל מה שחשוב לקחת מהשיעור, בלי לפתוח את השקפים.

<deck slides="${slides.length}">
${deck}
</deck>
${summary ? `\nסיכום קודם של אותו חומר (לעיון בלבד – אפשר להיעזר בו, אבל הסיכום החדש צריך להיות מסודר וחד יותר):\n<previous_summary>\n${summary}\n</previous_summary>\n` : ''}
הפק JSON לפי הסכמה:
- subtitle: משפט אחד שמונה את מה שהשיעור מכסה (למשל: "טענות, קשרים לוגיים, טבלאות אמת ותבניות הוכחה.").
- sections: 5–10 סעיפים שמכסים את **כל** החומר. title קצר (2–5 מילים) – הוא מופיע בתפריט הניווט. slideStart/slideEnd – טווח השקפים של הסעיף (0 אם לא ידוע).
- blocks בכל סעיף, לפי הסדר שבו כדאי ללמוד:
  - text – הסבר רציף וברור (פסקה או שתיים, אפשר רשימה). title ריק.
  - definition – הגדרה מדויקת של מושג. title = שם המושג (ובאנגלית בסוגריים אם רלוונטי). body = ההגדרה, עם המונח **מודגש**.
  - example – דוגמה קונקרטית, ואם יש חישוב – פתורה צעד-אחר-צעד עד התוצאה. title = כותרת קצרה לדוגמה.
  - rule – משפט, כלל, נוסחה, עיקרון או שיטה. title = שם הכלל. נוסחאות ב-LaTeX בשורה נפרדת ($$...$$).
  - important – נקודה שחייבים לזכור / תובנה מרכזית. title קצר.
  - mistake – טעות נפוצה ואיך להימנע ממנה. title קצר.
  ${NOTES_FOCUS[kind] || NOTES_FOCUS.lecture}
  כל סעיף מתחיל בבלוק text. בלי חזרות: כל רעיון מופיע פעם אחת, במקום הנכון. ענייני ותמציתי, אבל לא לדלג על שום נושא או הגדרה שמופיעים בחומר.
- takeaways: 5–8 משפטים – "מה לוקחים מהשיעור": הדברים הכי חשובים שצריך לזכור למבחן.
אל תשתמש בכותרות Markdown (# / ##) בתוך body.`;
}

/** Homework-level practice: new problems in the style and difficulty of the course's homework sheets. */
export const HOMEWORK_PRACTICE_SCHEMA = obj({
  quiz: { type: 'array', items: quizItem },
  problems: { type: 'array', items: obj({ question: str, solution: str, difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] }, topic: str }) },
});

export function homeworkPracticePrompt({ course, homework, lectures, taught, count, topic, avoid }) {
  return `לפניך חומרי התרגול של הקורס "${course.name}" (שיעורי בית ותרגולים, או ההרצאות כשאין עדיין תרגול), ותקצירי ההרצאות.

<style_examples>
${homework}
</style_examples>

<lectures_summary>
${lectures}
</lectures_summary>

<taught_so_far>
${taught.map((t) => `- ${t}`).join('\n')}
</taught_so_far>

צור תרגול חדש **באותה רמה, באותו סגנון ובאותו היקף** כמו חומרי התרגול שלמעלה:
- problems: ${count} תרגילים פתוחים חדשים (לא העתקה של תרגילים קיימים – אותם רעיונות עם נתונים/ניסוח אחרים). לכל תרגיל: question (נוסח מלא, Markdown, נוסחאות ב-LaTeX), solution (פתרון מלא צעד-אחר-צעד, כמו פתרון רשמי), difficulty, topic (נושא קצר).
- quiz: ${Math.max(4, Math.round(count * 1.2))} שאלות אמריקאיות באותה רמה (בעיקר חישוב/יישום), 4 אפשרויות, correctIndex מבוסס 0, הסבר מלא, slide = 0.
**לא להקדים את המאוחר:** כל תרגיל וכל שאלה חייבים להיות רק על נושאים מהרשימה taught_so_far – מה שכבר נלמד. חוברות ומאגרים בדוגמאות יכולים לכסות את כל הסמסטר; מהם לוקחים רק את הסגנון ואת הרמה, לא נושאים שעוד לא נלמדו.
${topic ? `התמקד בנושא: ${topic} (אם הוא ברשימה).` : 'פזר את התרגילים על פני הנושאים שכבר נלמדו.'}
אל תחזור על התרגילים שכבר נוצרו:
${avoid.map((q) => `- ${q}`).join('\n') || '- (אין)'}

הקפד על נכונות מלאה של כל פתרון ותשובה – בדוק את החישובים פעמיים.`;
}

export function practicePrompt({ course, title, material, count, difficulty, avoid }) {
  return `צור ${count} שאלות אמריקאיות חדשות ברמת מבחן בקורס "${course.name}" על החומר הבא ("${title}").
רמת קושי מבוקשת: ${difficulty === 'mixed' ? 'מעורבת' : difficulty}.
אל תחזור על השאלות הקיימות האלה:
${avoid.map((q) => `- ${q}`).join('\n') || '- (אין)'}

<material>
${material}
</material>

4 אפשרויות לכל שאלה, correctIndex מבוסס 0, הסבר מלא (כולל למה המסיחים שגויים), ומספר שקף רלוונטי (0 אם לא ידוע). שלב שאלות יישום וחישוב, לא רק שינון.`;
}

export function classifyPrompt({ courses, fileName, sample }) {
  return `שייך את קובץ ההרצאה לקורס המתאים.
קורסים:
${courses.map((c) => `- ${c.id}: ${c.name} (${c.tagline})`).join('\n')}

שם הקובץ: ${fileName}
תחילת התוכן:
${sample}

החזר courseId מהרשימה, confidence בין 0 ל-1, lessonNumber (0 אם לא ידוע) ו-title קצר לנושא ההרצאה.`;
}

export function chatSystem({ scope, context }) {
  return `אתה "המורה" – מורה פרטי חד ותכליתי באתר הלמידה של סטודנט שנה א' בהנדסת תעשייה וניהול (אוניברסיטת בן-גוריון).
${scope}

איך עונים:
- **אורך התשובה תואם את השאלה.** שאלה קצרה או עובדתית ("מה זה X?", "למה Y?") – 1–3 משפטים, ישר לעניין, כמו חבר שמבין בחומר. בלי הקדמות, בלי לחזור על השאלה, בלי כותרות ובלי "בשורה התחתונה".
- תשובה ארוכה ומפורטת רק כשמבקשים במפורש (סיכום, הסבר מעמיק, פתרון תרגיל, השוואה) – וגם אז הכי קצרה שאפשר. טבלה רק כשמבקשים השוואה או טבלה.
- שאלת המשך – ענה בדיוק על מה שנשאל עכשיו, בלי לחזור על מה שכבר נאמר. אם הסטודנט מבקש פורמט מסוים (קצר יותר, בנקודות, דוגמה, באנגלית) – בצע בדיוק את זה, וזה תקף לשאר השיחה.
- התבסס על חומר הקורס שלמטה. הפניה לשקף רק כשהיא מועילה, בסוף המשפט: (שקף 12). אל תמציא מספרי שקפים או נתונים.
- אם השאלה חורגת מהחומר – ענה מהידע הכללי, וציין בקצרה שזה מעבר להרצאות.
- בתרגיל חשבון – הדרך בקצרה ואז התוצאה. כשמבקשים לתרגל – שאלה אחת בכל פעם, ומשוב קצר על התשובה.
- כתוב בעברית. Markdown רק כשהוא באמת עוזר (רשימה קצרה, **הדגשה** של מונח).
- נוסחאות ב-LaTeX: $...$ בתוך שורה. לעולם אל תכתוב עברית בתוך LaTeX – נוסחה במילים כתוב כטקסט רגיל (**רווח = הכנסות − הוצאות**). ערך מוחלט: \\lvert x \\rvert. דולר כמטבע: \\$.

<course_material>
${context}
</course_material>`;
}

// ---------- grade composition from the course syllabus ----------
export const GRADING_SCHEMA = obj({
  components: {
    type: 'array',
    items: obj({
      name: str,
      weight: { type: 'number' },
      kind: { type: 'string', enum: ['exam', 'quiz', 'homework', 'project', 'lab', 'participation', 'other'] },
      shield: { type: 'boolean' },
    }),
  },
  minExamGrade: { type: 'number' },
  passGrade: { type: 'number' },
  notes: strArr,
  found: { type: 'boolean' },
});

export function gradingPrompt({ course, text, fromLecture = false }) {
  return `${fromLecture ? 'אלה השקפים של השיעורים הראשונים' : 'זה הסילבוס'} של הקורס "${course.name}" (${course.code}). חלץ ${fromLecture ? 'מהם' : 'ממנו'} את הרכב הציון הסופי.

- components: כל מרכיב בציון עם המשקל שלו באחוזים (המשקלות מסתכמים ל־100). שם קצר וברור כמו בסילבוס ("בוחן 1", "תרגילי בית", "בחינה סופית").
  kind: exam לבחינה הסופית, quiz לבוחן, homework לתרגילים/מטלות, project לעבודה/פרויקט, lab למעבדה, participation להשתתפות.
  shield: true רק אם כתוב שהמרכיב "מגן" (נספר רק אם הוא משפר את הציון).
  אם בוחן אחד מופיע כמה פעמים (בוחן 1, בוחן 2) – כל אחד מרכיב נפרד.
- minExamGrade: ציון סף בבחינה הסופית שבלעדיו לא עוברים את הקורס (0 אם אין).
- passGrade: ציון המעבר בקורס (0 אם לא כתוב).
- notes: עד 4 דרישות קצרות שחשוב לדעת לחישוב הציון (חובת הגשה, ציון סף במטלות, נוכחות, ממוצע של X הטובים מתוך Y). משפט קצר לכל אחת. בלי דברים כלליים.
- found: false אם אין בטקסט הרכב ציון ברור (ואז components ריק).

לא להמציא: רק מה שכתוב בטקסט.

<syllabus>
${text}
</syllabus>`;
}
