import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, Bell, Smartphone, ArrowLeft, ArrowRight, Building2, CircleHelp } from 'lucide-react';

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

const STEPS = [
  {
    icon: BookOpen,
    title: 'הקורסים שלך, מסודרים',
    text: 'כל קורס שאתם רשומים אליו במודל מופיע בתפריט: המצגות, סיכום מסודר לכל שיעור, תרגול וכרטיסיות. בלשונית "סיכומים" של כל קורס – כל השיעורים במסמך אחד.',
    note: 'הסיכומים נכתבים בעזרת AI. מצאתם טעות? יש "דיווח על טעות" ליד כל סעיף.',
  },
  {
    icon: Bell,
    title: 'הגשות ועדכונים במקום אחד',
    text: 'בדף העדכונים: חומר חדש, הודעות מהמרצים וההגשות הקרובות שלכם עם ספירה לאחור – ומה בדיוק צריך להגיש.',
    note: 'בלחיצה אחת מוסיפים את ההגשות ליומן בטלפון ומקבלים תזכורת 3 ימים ויום לפני. ההגשה עצמה – כרגיל במודל.',
  },
  {
    icon: Smartphone,
    title: 'גם בטלפון, כמו אפליקציה',
    text: IS_IOS
      ? 'ב-Safari: כפתור השיתוף ← "הוסף למסך הבית". האתר ייפתח כמו אפליקציה, וסיכומים שכבר פתחתם יעבדו גם בלי אינטרנט.'
      : 'בתפריט הדפדפן: "התקנת אפליקציה" או "הוספה למסך הבית". האתר ייפתח כמו אפליקציה, וסיכומים שכבר פתחתם יעבדו גם בלי אינטרנט.',
    note: 'טיפ: החיפוש למעלה מחפש בכל החומר – מושגים, הגדרות ושקפים.',
  },
  {
    icon: Building2,
    title: 'מערכת שעות מהפורטל',
    text: 'בעמוד "מערכת שעות" מחברים את הפורטל, והקבוצות, החדרים והביטולים שלכם מתעדכנים לבד. ההתראות והעדכונים מגיעים רק על מה שקשור אליכם.',
    note: 'אפשר גם לבחור קבוצות ידנית, בלי לחבר את הפורטל.',
  },
  {
    icon: CircleHelp,
    title: 'ועוד הרבה, עם הסבר',
    text: 'בתפריט, "איך משתמשים", יש הסבר על כל חלק באתר: ציונים וממוצע, לוח מבחנים, תרגול וכרטיסיות, סיכומים, הכנה למבחן ועוד.',
    note: 'אפשר לחזור אליו בכל רגע.',
  },
];

/** A short tour shown once, the first time a student signs in; the last step opens the full guide. */
export default function Onboarding({ name, onDone, onGuide }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <motion.div className="overlay" style={{ placeItems: 'center' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="card onboarding" role="dialog" aria-modal="true" initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }}>
        <div className="onboarding-top">
          {i === 0 && <div className="onboarding-hi">ברוכים הבאים{name ? `, ${name}` : ''} 👋</div>}
          <button className="btn sm ghost" onClick={onDone}>דילוג</button>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.22 }}>
            <div className="onboarding-icon"><step.icon size={28} /></div>
            <h2>{step.title}</h2>
            <p>{step.text}</p>
            <div className="onboarding-note">{step.note}</div>
          </motion.div>
        </AnimatePresence>
        <div className="onboarding-foot">
          <div className="onboarding-dots">{STEPS.map((_, j) => <span key={j} className={j === i ? 'on' : ''} />)}</div>
          <div className="row" style={{ gap: 8 }}>
            {i > 0 && <button className="btn sm ghost" onClick={() => setI(i - 1)}><ArrowRight size={15} /> הקודם</button>}
            {last && onGuide && <button className="btn" onClick={onGuide}>למדריך</button>}
            <button className="btn accent" onClick={() => (last ? onDone() : setI(i + 1))}>{last ? 'בואו נתחיל' : <>הבא <ArrowLeft size={15} /></>}</button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
