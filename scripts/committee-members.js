// Who besides the site's owner may open the degree committee's page, through the cloud's admin channel:
//   node --env-file=.env scripts/committee-members.js                 list the members
//   node --env-file=.env scripts/committee-members.js add <moodle-username> [...]
//   node --env-file=.env scripts/committee-members.js remove <moodle-username> [...]
// A member must have signed in to the site once, so that their account exists.
const CLOUD = (process.env.CLOUD_URL || '').replace(/\/$/, '');
const SECRET = process.env.STUDY_ADMIN_SECRET || '';
if (!CLOUD || !SECRET) {
  console.error('CLOUD_URL and STUDY_ADMIN_SECRET must be set in .env');
  process.exit(1);
}
const [action, ...names] = process.argv.slice(2);
if (action && !['add', 'remove'].includes(action)) {
  console.error('usage: committee-members.js [add|remove <username> ...]');
  process.exit(1);
}
const res = await fetch(`${CLOUD}/api/admin/committee`, {
  method: action ? 'POST' : 'GET',
  headers: { Authorization: `Bearer ${SECRET}`, ...(action ? { 'Content-Type': 'application/json' } : {}) },
  body: action ? JSON.stringify({ [action]: names }) : undefined,
});
if (!res.ok) {
  console.error(`the cloud answered ${res.status}`);
  process.exit(1);
}
const { members, notFound } = await res.json();
if (notFound?.length) console.error(`no single signed-in user with the username: ${notFound.join(', ')} (they must sign in to the site once)`);
console.log(members.length ? members.map((m) => `${m.username || '?'}  ${m.fullname || ''}`).join('\n') : 'no committee members besides the owner');
