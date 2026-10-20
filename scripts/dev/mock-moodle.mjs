// Mock of the BGU Moodle web services for local end-to-end tests (fictional students and test credentials only).
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.argv[2] || 9911);
const PDF = process.argv[3];
const BASE = `http://localhost:${PORT}/moodle`;
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

const COURSES = {
  68380: { id: 68380, shortname: '142131410120271', fullname: 'מבוא לכלכלה לתעשיה וניהול סמ 1' },
  68600: { id: 68600, shortname: '364141410120271', fullname: 'יסודות מערכות מידע' },
  68470: { id: 68470, shortname: '681140210120271', fullname: 'חשבונאות פיננסית וניהולית סמ 1' },
  68587: { id: 68587, shortname: '500500060120271', fullname: 'מבוא לפיזיקה - מכניקה' },
  67017: { id: 67017, shortname: '214197110120271', fullname: 'חדו"א 1 להנדסה (27א)' },
  99001: { id: 99001, shortname: '201111710120271', fullname: 'אלגברה לינארית להנדסה סמ 1' },
  57054: { id: 57054, shortname: '170170720271', fullname: 'קורס הכרת הספרייה' },
};
const USERS = {
  'test-alice': { pw: 'alice-test-pass', token: 'a'.repeat(32), userid: 501, fullname: 'אליס בדיקה', courses: [68380, 67017, 57054] },
  'test-all': { pw: 'all-test-pass', token: 'c'.repeat(32), userid: 503, fullname: 'כל הקורסים', courses: [68380, 67017, 68600, 68470, 68587] },
  'test-bob': { pw: 'bob-test-pass', token: 'b'.repeat(32), userid: 502, fullname: 'בוב בדיקה', courses: [68380, 99001] },
};
const byToken = (t) => Object.entries(USERS).find(([, u]) => u.token === t);

const handlers = {
  core_webservice_get_site_info: (u, name) => ({ userid: u.userid, username: name, fullname: u.fullname, functions: [] }),
  core_enrol_get_users_courses: (u) => u.courses.map((id) => COURSES[id]),
  core_calendar_get_action_events_by_timesort: (u) => ({
    events: [
      u.courses.includes(68380) && { id: 7001, modulename: 'assign', instance: 202001, name: "יש להגיש את 'תרגיל 1'", activityname: 'תרגיל 1', timesort: now() + 2 * DAY, course: COURSES[68380], url: `${BASE}/mod/assign/view.php?id=1`, action: { name: 'הוספת הגשה', actionable: true } },
      u.courses.includes(99001) && { id: 7002, modulename: 'assign', instance: 303001, name: "יש להגיש את 'גיליון 1'", activityname: 'גיליון 1', timesort: now() + 5 * DAY, course: COURSES[99001], url: `${BASE}/mod/assign/view.php?id=2`, action: { name: 'הוספת הגשה', actionable: true } },
    ].filter(Boolean),
  }),
  gradereport_overview_get_course_grades: (u) => ({ grades: u.courses.map((id) => ({ courseid: id, grade: id === 99001 ? '88.00' : '-' })) }),
  gradereport_user_get_grade_items: (u, _n, p) => ({
    usergrades: [{ gradeitems: [
      { itemtype: 'mod', itemname: 'גיליון 0', itemmodule: 'assign', cmid: 3, gradeformatted: Number(p.courseid) === 99001 ? '88.00' : '-', percentageformatted: Number(p.courseid) === 99001 ? '88.00 %' : '-', feedback: '<p>עבודה טובה</p>' },
      { itemtype: 'course', itemname: null, gradeformatted: '-', percentageformatted: '-' },
    ] }],
  }),
  core_course_get_contents: (u, _n, p) => {
    if (Number(p.courseid) !== 99001 || !u.courses.includes(99001)) return [];
    const file = (name, id) => ({ type: 'file', filename: name, filepath: '/', filesize: 1000, timemodified: now() - 5 * DAY, fileurl: `${BASE}/webservice/pluginfile.php/${id}/mod_resource/content/1/${encodeURIComponent(name)}` });
    return [
      { name: 'שבוע 1', modules: [{ id: 11, modname: 'resource', name: 'הרצאה 1 – מרחבים וקטוריים', contents: [file('הרצאה 1 - מרחבים וקטוריים.pdf', 11)] }] },
      { name: 'תרגילים', modules: [{ id: 12, modname: 'resource', name: 'תרגיל בית 1', contents: [file('תרגיל בית 1.pdf', 12)] }] },
    ];
  },
  mod_assign_get_assignments: () => ({ courses: [] }),
  // alice left a draft of economics' תרגיל 1; bob submitted linear algebra's גיליון 1.
  mod_assign_get_submission_status: (u, name, p) => {
    const id = Number(p.assignid);
    const status = name === 'test-alice' && id === 202001 ? 'draft' : name === 'test-bob' && id === 303001 ? 'submitted' : 'new';
    return { lastattempt: { submission: { status } } };
  },
  mod_quiz_get_quizzes_by_courses: () => ({ quizzes: [] }),
  mod_forum_get_forums_by_courses: (u, _n, p) => (Number(p['courseids[0]'] ?? p.courseids?.[0]) === 99001 ? [{ id: 801, course: 99001, type: 'news' }] : []),
  mod_forum_get_forum_discussions: () => ({ discussions: [{ discussion: 9001, name: 'ברוכים הבאים לאלגברה לינארית', message: '<p>שלום לכולם, התרגול הראשון ביום שני.</p>', userfullname: 'מרצה בדיקה', created: now() - DAY }] }),
};

const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  if (url.pathname === '/moodle/login/token.php') {
    const p = Object.fromEntries(new URLSearchParams(await readBody(req)));
    const u = USERS[p.username];
    if (!u || u.pw !== p.password) return send(res, 200, { error: 'Invalid login, please try again', errorcode: 'invalidlogin' });
    return send(res, 200, { token: u.token, privatetoken: null });
  }
  if (url.pathname === '/moodle/webservice/rest/server.php') {
    const raw = new URLSearchParams(await readBody(req));
    const p = Object.fromEntries(raw);
    const found = byToken(p.wstoken);
    if (!found) return send(res, 200, { exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token - token not found' });
    const fn = handlers[p.wsfunction];
    if (!fn) return send(res, 200, { exception: 'webservice_access_exception', errorcode: 'accessexception', message: `no ${p.wsfunction}` });
    const params = { ...p, courseids: [...raw.keys()].filter((k) => k.startsWith('courseids[')).map((k) => raw.get(k)) };
    return send(res, 200, fn(found[1], found[0], params));
  }
  if (url.pathname.startsWith('/moodle/webservice/pluginfile.php/')) {
    if (!byToken(url.searchParams.get('token'))) return send(res, 403, { error: 'forbidden' });
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    return fs.createReadStream(PDF).pipe(res);
  }
  send(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log(`mock moodle on ${BASE}`));
