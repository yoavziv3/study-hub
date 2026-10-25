// A course's grade rows as the site shows them, from Moodle's grade report (gradereport_user_get_grade_items): the
// assessed activities (assignments, quizzes…) and the course total. The report also lists activities that carry
// no grade at all (a Zoom entry, say) – those are left out unless they actually have one.
const ASSESSED = new Set(['assign', 'quiz', 'workshop', 'scorm', 'lesson', 'h5pactivity', 'forum', 'glossary', 'data', 'lti', 'turnitintooltwo', 'feedback', 'survey', 'bigbluebuttonbn_graded']);

export function gradeRows(gradeItems, { site, text }) {
  return (gradeItems || [])
    .filter((g) => g.itemtype === 'course' || (g.itemtype === 'mod' && ((g.gradeformatted && g.gradeformatted !== '-') || ASSESSED.has(g.itemmodule))))
    .map((g) => ({
      name: g.itemtype === 'course' ? 'ציון הקורס' : g.itemname,
      total: g.itemtype === 'course',
      grade: g.gradeformatted && g.gradeformatted !== '-' ? g.gradeformatted : null,
      percentage: g.percentageformatted && g.percentageformatted !== '-' ? g.percentageformatted : null,
      range: g.rangeformatted || '',
      feedback: g.feedback ? text(g.feedback).replace(/\s+/g, ' ').trim().slice(0, 400) : '',
      url: g.itemmodule && g.cmid ? `${site}/mod/${g.itemmodule}/view.php?id=${g.cmid}` : null,
    }));
}
