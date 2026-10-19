import { LineChart, Globe2, TrendingDown, Scale, BookOpenCheck, Gauge, Triangle, Gamepad2, Layers3, Spline } from 'lucide-react';
import { PPFLab, TradeLab } from './EconLabs.jsx';
import { DepreciationLab, EquationLab, JournalLab, RatiosLab } from './AccLabs.jsx';
import { PyramidLab, SystemsGame, DIKWLab } from './ISLabs.jsx';
import { DerivativeLab } from './CalcLabs.jsx';

// Interactive tools per course. Each one is tied to a specific lecture in the course.
export const LABS = {
  econ: [
    { id: 'ppf', title: 'בונה עקומת התמורה', description: 'עובדים עם תפוקות שונות, עקומה קמורה, נקודות יעילות ומסחר במשק קטן.', source: 'הרצאה 1', icon: LineChart, Component: PPFLab },
    { id: 'trade', title: 'יתרון יחסי וסחר', description: 'שני משקים, יחס חליפין, ומתי המסחר משתלם לשני הצדדים.', source: 'הרצאה 1', icon: Globe2, Component: TradeLab },
  ],
  acc: [
    { id: 'equation', title: 'הזהות החשבונאית בפעולה', description: 'העסק של מר שמיר – פעולה אחר פעולה, והמאזן תמיד מאוזן.', source: 'יחידה 4', icon: Scale, Component: EquationLab },
    { id: 'journal', title: 'מאמן פקודות יומן', description: 'חובה או זכות? תרגול רישום כפול וחשבונות חתך.', source: 'יחידות 6–7', icon: BookOpenCheck, Component: JournalLab },
    { id: 'depreciation', title: 'מחשבון פחת', description: 'קו ישר, סכום ספרות השנים ויתרה פוחתת – ורווח הון במכירה.', source: 'יחידה 8', icon: TrendingDown, Component: DepreciationLab },
    { id: 'ratios', title: 'מנתח יחסים פיננסיים', description: 'נזילות, יציבות, רווחיות ויעילות – על נתוני אור השמש.', source: 'יחידה 9', icon: Gauge, Component: RatiosLab },
  ],
  is: [
    { id: 'pyramid', title: 'פירמידת אנתוני', description: 'דרגים בארגון, סוגי מידע, סוגי החלטות ומערכות.', source: 'שיעור 2', icon: Triangle, Component: PyramidLab },
    { id: 'game', title: 'איזו מערכת מידע זו?', description: 'TPS, MIS, DSS, BI, EIS או ERP – משחק זיהוי.', source: 'שיעור 2', icon: Gamepad2, Component: SystemsGame },
    { id: 'dikw', title: 'סולם DIKW', description: 'נתונים, מידע, ידע וחוכמה – עם הדוגמאות מהשיעור.', source: 'שיעור 1', icon: Layers3, Component: DIKWLab },
  ],
  calc: [
    { id: 'derivative', title: 'הנגזרת כגבול', description: 'מיתר שמתכנס למשיק – מקטינים את h ורואים את ההגדרה קורמת עור וגידים.', source: 'כלי עזר כללי', icon: Spline, Component: DerivativeLab },
  ],
};
