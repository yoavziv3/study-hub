import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_COURSES } from './courses.js';
import { schedulePublish } from './publish.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const DATA_DIR = process.env.STUDY_DATA_DIR ? path.resolve(process.env.STUDY_DATA_DIR) : path.join(ROOT, 'data'); // override for tests
export const LECTURES_DIR = path.join(DATA_DIR, 'lectures');
export const INBOX_DIR = path.join(ROOT, 'inbox');

fs.mkdirSync(LECTURES_DIR, { recursive: true });
fs.mkdirSync(INBOX_DIR, { recursive: true });

const COURSES_FILE = path.join(DATA_DIR, 'courses.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

let tmpSeq = 0;
async function writeJSON(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  // One tmp file per write: two writes of the same file at once used to share it and leave a mangled mix behind.
  const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2));
  await fsp.rename(tmp, file);
}

// ---------- courses ----------
export function listCourses() {
  const saved = readJSON(COURSES_FILE, null) || [];
  // Add any course defined in code but missing from the saved list (e.g. a newly added course).
  const missing = DEFAULT_COURSES.filter((d) => !saved.some((c) => c.id === d.id));
  if (missing.length || !saved.length) {
    const merged = [...saved, ...missing];
    fs.writeFileSync(COURSES_FILE, JSON.stringify(merged, null, 2));
    return merged;
  }
  return saved;
}

export async function patchCourse(id, patch) {
  const courses = listCourses().map((c) => (c.id === id ? { ...c, ...patch } : c));
  await writeJSON(COURSES_FILE, courses);
  schedulePublish('פרטי קורס');
  return courses.find((c) => c.id === id);
}

/** A course created automatically from a student's Moodle enrollment (e.g. linear algebra). */
export async function addCourse(course) {
  const courses = listCourses();
  if (courses.some((c) => c.id === course.id)) return courses.find((c) => c.id === course.id);
  await writeJSON(COURSES_FILE, [...courses, course]);
  schedulePublish(`קורס חדש: ${course.short}`);
  return course;
}

export function getCourse(id) {
  return listCourses().find((c) => c.id === id) || null;
}

// ---------- lectures ----------
export const lectureDir = (id) => path.join(LECTURES_DIR, id);

export function listLectures(courseId, { withHeld = false } = {}) {
  const ids = fs.existsSync(LECTURES_DIR) ? fs.readdirSync(LECTURES_DIR) : [];
  const all = ids
    .map((id) => readJSON(path.join(LECTURES_DIR, id, 'meta.json'), null))
    .filter(Boolean)
    // Held items (e.g. exam-prep units waiting for the semester's own decks) stay on disk but out of the site.
    .filter((m) => withHeld || !m.held)
    .filter((m) => !courseId || m.courseId === courseId);
  return all.sort((a, b) => (a.lessonNumber || 99) - (b.lessonNumber || 99) || (a.unitNumber || 0) - (b.unitNumber || 0) || a.createdAt.localeCompare(b.createdAt));
}

export function getLecture(id) {
  return readJSON(path.join(lectureDir(id), 'meta.json'), null);
}

export async function saveLecture(meta) {
  meta.updatedAt = new Date().toISOString();
  await writeJSON(path.join(lectureDir(meta.id), 'meta.json'), meta);
  if (meta.status === 'ready') schedulePublish(meta.title);
  return meta;
}

export async function patchLecture(id, patch) {
  const meta = getLecture(id);
  if (!meta) return null;
  return saveLecture({ ...meta, ...patch });
}

export const getContent = (id) => readJSON(path.join(lectureDir(id), 'content.json'), null);
export const saveContent = async (id, content) => {
  await writeJSON(path.join(lectureDir(id), 'content.json'), content);
  schedulePublish(content?.title);
};
export const getSlides = (id) => readJSON(path.join(lectureDir(id), 'slides.json'), []);
export const saveSlides = (id, slides) => writeJSON(path.join(lectureDir(id), 'slides.json'), slides);

export async function deleteLecture(id) {
  await fsp.rm(lectureDir(id), { recursive: true, force: true });
  schedulePublish('מחיקת הרצאה');
}

export function newLectureId(courseId) {
  const stamp = Date.now().toString(36).slice(-5);
  const rand = Math.random().toString(36).slice(2, 5);
  return `${courseId || 'new'}-${stamp}${rand}`;
}

// ---------- links from the course's Moodle page (Zoom, recordings, external links, syllabus) ----------
const linksFile = (courseId) => path.join(DATA_DIR, 'links', `${courseId}.json`);
export const getLinks = (courseId) => readJSON(linksFile(courseId), []);
export async function saveLinks(courseId, links) {
  if (JSON.stringify(getLinks(courseId)) === JSON.stringify(links)) return;
  await writeJSON(linksFile(courseId), links);
  schedulePublish('קישורים מהמודל');
}

// ---------- homework-level practice generated per course ----------
const practiceFile = (courseId) => path.join(DATA_DIR, 'practice', `${courseId}.json`);
export const getPractice = (courseId) => readJSON(practiceFile(courseId), { quiz: [], problems: [] });
export async function savePractice(courseId, value) {
  await writeJSON(practiceFile(courseId), value);
  schedulePublish('תרגול ברמת שיעורי בית');
}

// ---------- progress (a single JSON blob owned by the client) ----------
export const getProgress = () => readJSON(PROGRESS_FILE, {});
export const saveProgress = (value) => writeJSON(PROGRESS_FILE, value);
