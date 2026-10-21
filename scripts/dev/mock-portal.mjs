// Mock of the BGU student portal's API (portal.bgu.ac.il) for local tests of the portal sync – fictional user only.
// Point the cloud at it with PORTAL_URL=http://localhost:9922 in .dev.vars. The shape follows the portal's own
// front-end: StandardLogin → { succeed, token }, Home/Index → page data with a schedule block (scheduleByDays).
import http from 'node:http';

const PORT = Number(process.argv[2] || 9922);
const USER = { userName: 'test-alice', password: 'alice-portal-pass', id: '000000018' };
const tokens = new Set();

const lesson = (name, type, timeStart, timeEnd, location, extra = {}) => ({ name, type, timeStart, timeEnd, location, online: false, hybrid: true, canceled: false, notifications: [], ...extra });
const schedule = () => [
  { dayName: 'יום ראשון', ranges: [] },
  { dayName: 'יום שני', ranges: [{ slots: [lesson('חדו"א 1 להנדסה', 'שעור', 10, 12, 'בניין כתות לימוד [35] חדר 115')] }] },
  { dayName: 'יום שלישי', ranges: [] },
  {
    dayName: 'יום רביעי',
    ranges: [{
      slots: [
        // The room moved: the catalog still says NIBN [41] חדר 001.
        lesson('חדו"א 1 להנדסה', 'שעור', 10, 12, 'בניין אולמות להרצאות [92] חדר 002', {
          notifications: [{ date: new Date(Date.now() - 3600e3).toISOString(), title: 'שינוי חדר', content: 'השיעור יתקיים בבניין 92 חדר 002 במקום בניין 41 חדר 001.' }],
        }),
        lesson('מבוא לכלכלה להנדסת תעשייה וניהול', 'תרגיל', 16, 18, 'צוקר, גולדשטיין-גורן [72] חדר 217', { canceled: true }),
      ],
    }],
  },
  { dayName: 'יום חמישי', ranges: [] },
  { dayName: 'יום שישי', ranges: [] },
];

http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  let input = {};
  try { input = JSON.parse(body || '{}'); } catch { /* empty */ }
  console.log(req.method, req.url);
  if (req.url === '/Portal/Account/StandardLogin') {
    const ok = input.userName === USER.userName && input.password === USER.password && input.id === USER.id;
    if (!ok) return send(400, { succeed: false, message: 'אחד או יותר מהפרטים שהוזנו שגויים' });
    const token = `tok-${Math.random().toString(36).slice(2)}`;
    tokens.add(token);
    return send(200, { succeed: true, token, loginId: 1 });
  }
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (req.url === '/Portal/Api/Home/Index') {
    if (!tokens.has(auth)) return send(401, { message: 'Unauthorized' });
    // The portal answers some calls with JSON inside a string.
    return send(200, JSON.stringify({ pageId: 1234, blocks: [{ alias: 'StudentCoursesAndScheduleBlockList', data: { semesterListFilter: [{ value: '2027-1', checked: true }], timeRange: [], scheduleByDays: schedule() } }] }));
  }
  if (req.url === '/umbraco/api/PortalGeneralSettingsApi/GetPortalAppSettings') return send(200, { apisTimeout: 60 });
  send(404, { message: 'not found' });
}).listen(PORT, () => console.log(`mock portal on http://localhost:${PORT}`));
