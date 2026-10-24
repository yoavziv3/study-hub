// The degree committee's view (the owner only): every course's weekly meetings laid over each other, to find the
// hours when nobody has class and a make-up lecture, tutorial or office hour can go in (client Committee page).
// The site's own courses come with their class groups from the catalog; courses the site doesn't carry (linear
// algebra) are kept here in `extra`, refreshed from the same catalog. `lines` is which registration paths the
// cohort actually has per course, from the faculty's list: [lecture] or [lecture, tutorial] group numbers.
// data/committee.json is published like the other data, but the cloud serves it to the owner alone (gate.js).
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { DATA_DIR, getCourse } from './store.js';
import { schedulePublish } from './publish.js';
import { fetchCatalog } from './catalog.js';

const FILE = path.join(DATA_DIR, 'committee.json');
const REFRESH_MS = 12 * 3600000;

const SEED = {
  extra: [{ id: 'la', code: '214-1-9321', name: 'אלגברה לינארית', short: 'אלגברה', color: 'teal', classes: [], checkedAt: null }],
  // The cohort's registration options (faculty list): which lecture group goes with which tutorial groups.
  lines: {
    la: [['6', '61'], ['6', '62'], ['6', '63'], ['6', '64'], ['6', '65'], ['6', '66']],
    calc: [['9', '93'], ['3', '31'], ['3', '32'], ['3', '33']],
    acc: [['1', '11'], ['2', '21']],
    is: [['1'], ['2']],
    econ: [['2', '21'], ['2', '22'], ['3', '31'], ['3', '32']],
    // Physics: every group meets Friday 8:00-12:00 (lecture) and 12:00-14:00 (tutorial), online.
    phys: [['1', '11'], ['2', '12'], ['3', '13']],
  },
};

export function committeeData() {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    // The registration lines are the faculty's list, kept in this file's code; the file keeps the courses' catalog data.
    return { ...SEED, ...saved, lines: SEED.lines };
  } catch {
    return SEED;
  }
}

async function save(value) {
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
  await fsp.rename(tmp, FILE);
  schedulePublish('מערכת הועד');
}

/** Re-reads the extra courses' class groups from the catalog (at most every 12 hours each, or now with force). */
export async function refreshCommittee({ force = false } = {}) {
  const data = committeeData();
  const term = getCourse('calc')?.term || getCourse('econ')?.term;
  if (!term) return { checked: 0 };
  let checked = 0;
  let changed = false;
  for (const c of data.extra) {
    if (!force && c.checkedAt && Date.now() - Date.parse(c.checkedAt) < REFRESH_MS && c.classes?.length) continue;
    try {
      const page = await fetchCatalog(c.code, term);
      checked++;
      if (!page?.classes?.length) continue;
      if (JSON.stringify(page.classes) !== JSON.stringify(c.classes)) changed = true;
      c.classes = page.classes;
      c.checkedAt = new Date().toISOString();
    } catch (e) {
      console.error(`[committee] ${c.short}:`, e.message);
    }
  }
  if (changed || !fs.existsSync(FILE)) await save(data);
  return { checked, changed };
}

export function startCommittee() {
  setTimeout(() => refreshCommittee().catch(() => {}), 45000).unref?.();
  setInterval(() => refreshCommittee().catch(() => {}), REFRESH_MS).unref?.();
}
