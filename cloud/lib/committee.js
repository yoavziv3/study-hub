// Who may open the degree committee's page ("מערכת הועד"): the site's owner and the members the owner added.
// A member sees that page and the data it needs (committee.json and every course's weekly meetings) – nothing else
// of what the owner sees (system status, other students' courses and material, other students' portal notices).
import { ownerUserId } from './health.js';
import { siteCourses } from './account.js';

/** True for the site's owner and for any added member. */
export async function isCommittee(env, user) {
  if ((await ownerUserId(env)) === user.id) return true;
  return !!(await env.DB.prepare('SELECT 1 AS x FROM committee_members WHERE moodle_userid = ?').bind(user.moodle_userid).first());
}

/** The courses the committee page lays over each other: name, colour and weekly meetings only – no material. */
export async function committeeCourses(env, request) {
  return (await siteCourses(env, request))
    .filter((c) => !c.remote && c.classes?.length)
    .map((c) => ({ id: c.id, name: c.name, short: c.short, color: c.color, term: c.term, classes: c.classes }));
}

const clean = (v) => String(v ?? '').trim().toLowerCase();

/** The admin channel: list the members, or add/remove them by the Moodle username they sign in with. */
export async function committeeAdmin(env, body) {
  const notFound = [];
  const find = async (name) => {
    const rows = (await env.DB.prepare('SELECT id, moodle_userid, username, fullname FROM users WHERE lower(username) = ?').bind(clean(name)).all()).results;
    if (rows.length !== 1) { notFound.push(name); return null; }
    return rows[0];
  };
  for (const name of body.add || []) {
    const u = await find(name);
    if (u) await env.DB.prepare('INSERT OR IGNORE INTO committee_members (moodle_userid, added_at) VALUES (?, ?)').bind(u.moodle_userid, Date.now()).run();
  }
  for (const name of body.remove || []) {
    const u = await find(name);
    if (u) await env.DB.prepare('DELETE FROM committee_members WHERE moodle_userid = ?').bind(u.moodle_userid).run();
  }
  const members = (await env.DB.prepare('SELECT u.username, u.fullname, m.added_at FROM committee_members m LEFT JOIN users u ON u.moodle_userid = m.moodle_userid ORDER BY m.added_at').all()).results;
  return { members, notFound };
}
