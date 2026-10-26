# IEMprove · אתר למידה לסמסטר א׳

אתר למידה אישי לכל הקורסים בסמסטר: מצגות, סיכומים, חלוקה לנושאים לפי שיעור, תרגול, כרטיסיות, מילון מושגים, מעבדות אינטראקטיביות ומורה AI שמכיר את כל החומר.

## הפעלה
לחיצה כפולה על `start.command` – או בטרמינל:

```bash
npm start
```

האתר נפתח בכתובת http://localhost:5180

## הוספת הרצאות
שלוש דרכים, כולן אוטומטיות:
1. **כפתור "העלאת הרצאה"** באתר (או גרירת קבצים לכל מקום בדף).
2. **תיקיית `inbox/`** – כל PDF/PowerPoint שנשמר בה נקלט אוטומטית כשהאתר רץ.
   - `inbox/` – זיהוי הקורס אוטומטית לפי התוכן
   - `inbox/econ`, `inbox/calc`, `inbox/is`, `inbox/acc` – לקורס מסוים
   - קבצים שנקלטו עוברים ל-`inbox/נקלטו/`.

כל קובץ עובר: המרה לשקפים (PowerPoint דרך Microsoft PowerPoint שמותקן במחשב) ← חילוץ טקסט ← זיהוי קורס ומספר שיעור ← ניתוח AI שכותב סיכום, נושאים, שאלות, כרטיסיות ומילון מושגים.

## AI
ברירת המחדל: Claude Code שמותקן במחשב (משתמש בחשבון שלך – אין צורך במפתח).
לשימוש ב-Anthropic API במקום: מעתיקים את `.env.example` ל-`.env` ומגדירים `ANTHROPIC_API_KEY`.

## מבנה
- `server/` – שרת Express: העלאות, עיבוד קבצים, AI, חיפוש וצ'אט
- `client/` – React + Vite
- `data/` – ההרצאות, השקפים, התוכן וההתקדמות שלך
- `seed/content/` – התוכן שנכתב להרצאות הראשונות

## הפעלה אוטומטית
האתר עולה לבד כשנכנסים למחשב (LaunchAgent: `~/Library/LaunchAgents/com.studyhub.server.plist`), ומופעל מחדש אוטומטית אם הוא נופל. יומן: `logs/server.log`.

אחרי שינוי בקוד – הפעלה מחדש:
```bash
npx vite build && launchctl kickstart -k gui/$(id -u)/com.studyhub.server
```

לביטול ההפעלה האוטומטית:
```bash
launchctl bootout gui/$(id -u)/com.studyhub.server && rm ~/Library/LaunchAgents/com.studyhub.server.plist
```

## מודל
בדף "סנכרון מודל" באתר מתחברים פעם אחת עם שם המשתמש והסיסמה של BGU (נשמר רק מפתח גישה, ב-`data/moodle.json`).
מצגות הרצאה חדשות בקורסים המשויכים נמשכות אוטומטית כל 30 דקות.

## האתר בענן (Cloudflare Pages)
- כתובת: https://study-hub-git.pages.dev
- הפרויקט ב-Cloudflare מחובר ישירות ל-GitHub (`yoavziv3/study-hub`, ענף `main`): כל push בונה ומעלה את האתר אוטומטית, מכל מחשב.
- הגדרות הבנייה: Build command `npm run build:static`, Build output directory `dist-cloud`, משתנה `NODE_VERSION=22`.
- הרצאות חדשות (ממודל או מהעלאה) נשמרות ונדחפות אוטומטית מהמחשב כשהעיבוד שלהן מסתיים – ולכן מתעדכנות גם בענן.
- בגרסת הענן: הרצאות, תרגולים, שיעורי בית, שקפים, סיכומים, תרגול, כרטיסיות, מעבדות וחיפוש. העלאה, צ'אט, יצירת תרגילים וסנכרון מודל – רק באתר שרץ במחשב.
- בדיקה איזה commit באוויר: `/data/build.json`
