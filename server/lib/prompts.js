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
המשימה: להפוך מצגת הרצאה לחומר לימוד מלא ומקצועי לקראת מבחן. היצמד לחומר שבמצגת, ובמקום שהמצגת מקוצרת – השלם הסבר והקשר כפי שמרצה היה מסביר בכיתה, בלי להמציא עובדות שאינן נכונות.
${STYLE}`;
}

export function lecturePrompt({ course, fileName, slides, hint }) {
  const deck = slides.map((t, i) => `<slide n="${i + 1}">\n${t || '(שקף ללא טקסט – כנראה תמונה/גרף)'}\n</slide>`).join('\n');
  return `להלן הטקסט של כל שקפי ההרצאה "${fileName}" בקורס ${course.short}.${hint ? `\nמידע נוסף: ${hint}` : ''}

<deck slides="${slides.length}">
${deck}
</deck>

הפק אובייקט JSON לפי הסכמה:
- title: כותרת קצרה ומדויקת להרצאה (בלי "הרצאה 1" – רק הנושא).
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
- examTips: 3–6 טיפים – טעויות נפוצות ומה חשוב לזכור למבחן.`;
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
