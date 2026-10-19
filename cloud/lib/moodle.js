// Moodle web-service calls made by the cloud on behalf of a signed-in student (the same API the Moodle app uses).

export const moodleSite = (env) => (env.MOODLE_URL || 'https://moodle.bgu.ac.il/moodle').replace(/\/$/, '');

export class MoodleError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export async function rest(env, token, wsfunction, params = {}) {
  const body = new URLSearchParams({ wstoken: token, wsfunction, moodlewsrestformat: 'json' });
  const flat = (prefix, v) => {
    if (Array.isArray(v)) v.forEach((x, i) => flat(`${prefix}[${i}]`, x));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => flat(`${prefix}[${k}]`, x));
    else body.append(prefix, String(v));
  };
  Object.entries(params).forEach(([k, v]) => flat(k, v));
  const res = await fetch(`${moodleSite(env)}/webservice/rest/server.php`, { method: 'POST', body });
  if (!res.ok) throw new MoodleError(`המודל לא זמין כרגע (${res.status})`, 'unavailable');
  const data = await res.json();
  if (data && data.exception) throw new MoodleError(data.message || data.errorcode, data.errorcode);
  return data;
}

/** Exchange the student's Moodle username + password for a web-service token. The password is not kept anywhere. */
export async function tokenFor(env, username, password) {
  const body = new URLSearchParams({ username, password, service: 'moodle_mobile_app' });
  const res = await fetch(`${moodleSite(env)}/login/token.php`, { method: 'POST', body });
  if (!res.ok) throw new MoodleError(`המודל לא זמין כרגע (${res.status})`, 'unavailable');
  const data = await res.json();
  if (data.token) return data.token;
  if (data.errorcode === 'invalidlogin') throw new MoodleError('שם המשתמש או הסיסמה של המודל שגויים', 'invalidlogin');
  throw new MoodleError(data.error || 'ההתחברות למודל נכשלה', data.errorcode || 'login');
}

export async function enrolledCourses(env, token, userid) {
  const list = await rest(env, token, 'core_enrol_get_users_courses', { userid });
  return list.map((c) => ({ id: c.id, shortname: c.shortname, fullname: c.fullname }));
}

// BGU short names: [dept 3][degree 1][course 4][group 2][year 4][semester 1], e.g. 214197110120271.
// Only this year's academic courses become site courses (not the library course, exam guides, old courses…).
export const academicYear = (d = new Date()) => (d.getUTCMonth() >= 7 ? d.getUTCFullYear() + 1 : d.getUTCFullYear());
export function isCurrentAcademic(c) {
  const m = String(c.shortname || '').match(/^\d{8}\d{2}(\d{4})\d$/);
  return !!m && Number(m[1]) >= academicYear();
}
