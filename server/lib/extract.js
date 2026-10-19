import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import JSZip from 'jszip';

const run = promisify(execFile);

// Bidi control marks that pdftotext leaves around Hebrew runs.
const BIDI = /[‎‏‪-‮⁦-⁩]/g;
export const cleanText = (s) =>
  s.replace(BIDI, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

const decode = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

async function which(cmd) {
  try {
    const { stdout } = await run('/usr/bin/which', [cmd]);
    return stdout.trim() || null;
  } catch {
    const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/Applications/LibreOffice.app/Contents/MacOS'];
    for (const dir of extra) {
      const p = path.join(dir, cmd);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }
}

export async function toolsStatus() {
  const [pdftoppm, pdftotext, soffice] = await Promise.all([which('pdftoppm'), which('pdftotext'), which('soffice')]);
  const powerpoint = process.platform === 'darwin' && fs.existsSync('/Applications/Microsoft PowerPoint.app');
  return { pdftoppm, pdftotext, soffice, powerpoint };
}

// ---------- PPTX → PDF ----------
// PowerPoint is sandboxed: opening files in a new folder triggers a "grant access" dialog that blocks
// automation. Its own container is always accessible, so files are staged there for conversion.
const PPT_STAGE = path.join(os.homedir(), 'Library/Containers/com.microsoft.Powerpoint/Data/study-hub-convert');
const PPT_SCRIPT = `
on run argv
  set inPath to item 1 of argv
  set outPath to item 2 of argv
  with timeout of 150 seconds
    tell application "Microsoft PowerPoint"
      set p to open POSIX file inPath
      repeat 40 times
        if (count of presentations) > 0 then exit repeat
        delay 0.5
      end repeat
      set p to presentation 1
      save p in POSIX file outPath as save as PDF
      close p saving no
    end tell
  end timeout
end run`;

async function convertWithPowerPoint(input, outPdf) {
  await fsp.mkdir(PPT_STAGE, { recursive: true });
  const stamp = Date.now().toString(36);
  const stagedIn = path.join(PPT_STAGE, `${stamp}${path.extname(input)}`);
  const stagedOut = path.join(PPT_STAGE, `${stamp}.pdf`);
  await fsp.copyFile(input, stagedIn);
  try {
    await run('/usr/bin/osascript', ['-e', PPT_SCRIPT, stagedIn, stagedOut], { timeout: 180000 });
    if (!fs.existsSync(stagedOut)) return false;
    await fsp.copyFile(stagedOut, outPdf);
    return true;
  } finally {
    await fsp.rm(stagedIn, { force: true });
    await fsp.rm(stagedOut, { force: true });
  }
}

let convertLock = Promise.resolve();

export async function convertToPdf(input, outPdf) {
  const ext = path.extname(input).toLowerCase();
  if (ext === '.pdf') {
    await fsp.copyFile(input, outPdf);
    return true;
  }
  const tools = await toolsStatus();
  // PowerPoint can only handle one document at a time reliably, so serialize conversions.
  const job = convertLock.then(async () => {
    if (tools.soffice) {
      const outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'study-conv-'));
      try {
        await run(tools.soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, input], { timeout: 180000 });
        const produced = path.join(outDir, path.basename(input, ext) + '.pdf');
        if (fs.existsSync(produced)) {
          await fsp.copyFile(produced, outPdf);
          return true;
        }
      } catch (e) {
        console.warn('[convert] soffice failed:', e.message);
      } finally {
        await fsp.rm(outDir, { recursive: true, force: true });
      }
    }
    if (tools.powerpoint) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          if (await convertWithPowerPoint(input, outPdf)) return true;
        } catch (e) {
          console.warn(`[convert] PowerPoint attempt ${attempt} failed:`, e.message.split('\n').pop());
        }
      }
    }
    return false;
  });
  convertLock = job.catch(() => {});
  return job;
}

// ---------- slide images ----------
export async function renderSlides(pdf, outDir) {
  await fsp.mkdir(outDir, { recursive: true });
  const tools = await toolsStatus();
  if (!tools.pdftoppm) return 0;
  await run(tools.pdftoppm, ['-jpeg', '-jpegopt', 'quality=84', '-scale-to', '1600', pdf, path.join(outDir, 's')], { timeout: 600000 });
  await run(tools.pdftoppm, ['-jpeg', '-jpegopt', 'quality=70', '-scale-to', '360', pdf, path.join(outDir, 't')], { timeout: 600000 });
  // pdftoppm pads page numbers to the page-count width; normalize to 001.jpg / t001.jpg.
  const files = await fsp.readdir(outDir);
  let count = 0;
  for (const f of files) {
    const m = f.match(/^([st])-(\d+)\.jpg$/);
    if (!m) continue;
    const n = String(parseInt(m[2], 10)).padStart(3, '0');
    await fsp.rename(path.join(outDir, f), path.join(outDir, m[1] === 's' ? `${n}.jpg` : `t${n}.jpg`));
    if (m[1] === 's') count++;
  }
  return count;
}

// ---------- text ----------
export async function pdfTextPerPage(pdf) {
  const tools = await toolsStatus();
  if (!tools.pdftotext) return [];
  const { stdout } = await run(tools.pdftotext, ['-enc', 'UTF-8', pdf, '-'], { maxBuffer: 64 * 1024 * 1024 });
  const pages = stdout.split('\f');
  if (pages.length && !pages[pages.length - 1].trim()) pages.pop();
  return pages.map(cleanText);
}

export async function pptxTextPerSlide(file) {
  const zip = await JSZip.loadAsync(await fsp.readFile(file));
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  const out = [];
  for (const name of slideNames) {
    const xml = await zip.file(name).async('string');
    // Skip slides hidden in the deck; PowerPoint drops them from the PDF export too.
    if (/<p:sld[^>]*\sshow="0"/.test(xml)) continue;
    const paras = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((m) =>
      decode([...m[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join('')).trim()
    );
    const num = name.match(/\d+/)[0];
    let notes = '';
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${num}.xml`);
    if (notesFile) {
      const nx = await notesFile.async('string');
      notes = decode([...nx.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => t[1]).join(' ')).trim();
      if (/^\d+$/.test(notes)) notes = '';
    }
    out.push(cleanText(paras.filter(Boolean).join('\n') + (notes ? `\n[הערות דובר] ${notes}` : '')));
  }
  return out;
}

export async function extractSlidesText(original, pdf) {
  const ext = path.extname(original).toLowerCase();
  let pdfPages = [];
  if (pdf && fs.existsSync(pdf)) pdfPages = await pdfTextPerPage(pdf).catch(() => []);
  if (ext === '.pptx') {
    const pptx = await pptxTextPerSlide(original).catch(() => []);
    // Prefer the deck's own text (cleaner ordering) when it lines up with the rendered pages.
    if (pptx.length && (!pdfPages.length || pptx.length === pdfPages.length)) return pptx;
  }
  return pdfPages;
}
