// Personal calendar feed (iCalendar): pending Moodle submissions + the student's own deadlines,
// each with alarms N days before (the student's reminder setting, default 3 and 1 days).

const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Lines longer than 75 octets must be folded (RFC 5545 §3.1); fold on character boundaries.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function calendarFeed({ user, deadlines, progress, courses }) {
  const days = String(user.reminder_days || '3,1').split(',').map(Number).filter(Boolean);
  const short = Object.fromEntries(courses.map((c) => [c.id, c.short]));
  const done = progress.deadlinesDone || {};
  const items = [
    ...deadlines.filter((d) => !done[d.moodleKey]).map((d) => ({
      uid: `${d.moodleKey}@study-hub`,
      title: d.title,
      course: short[d.courseId] || d.courseName,
      dueAt: d.dueAt,
      url: d.url,
      note: d.action,
    })),
    ...(progress.manualDeadlines || []).filter((d) => !d.done).map((d) => ({
      uid: `manual-${d.id}@study-hub`,
      title: d.title,
      course: short[d.courseId] || '',
      dueAt: d.dueAt,
      url: '',
      note: d.note,
    })),
  ];
  const now = stamp(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Study Hub//Deadlines//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:הגשות – מחברת',
    'X-WR-TIMEZONE:Asia/Jerusalem',
    'REFRESH-INTERVAL;VALUE=DURATION:PT2H',
    'X-PUBLISHED-TTL:PT2H',
  ];
  for (const it of items) {
    if (Number.isNaN(new Date(it.dueAt).getTime())) continue;
    const summary = `הגשה: ${it.title}${it.course ? ` (${it.course})` : ''}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(it.uid)}`,
      `DTSTAMP:${now}`,
      `DTSTART:${stamp(it.dueAt)}`,
      `DTEND:${stamp(it.dueAt)}`,
      `SUMMARY:${esc(summary)}`,
      ...(it.url ? [`URL:${esc(it.url)}`] : []),
      `DESCRIPTION:${esc([it.note, it.url].filter(Boolean).join('\n'))}`,
      'TRANSP:TRANSPARENT'
    );
    for (const d of days) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-P${d}D`, `DESCRIPTION:${esc(`בעוד ${d === 1 ? 'יום' : d === 2 ? 'יומיים' : `${d} ימים`}: ${summary}`)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
