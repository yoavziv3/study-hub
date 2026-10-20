// Personal calendar feed (iCalendar): pending Moodle submissions + the student's own deadlines,
// each with alarms N days before (the student's reminder setting, default 3 and 1 days),
// and the exam sittings – the university's official dates (מועדים and quizzes, for the student's group) or the
// dates the student entered – with reminders a week and a day before, and the weekly classes of the student's
// chosen groups (from the course catalog).

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

/** A course's sittings for this student: official dates of their group, own dates replacing מועד א׳/ב׳. */
export function examSittings(course, progress) {
  const all = course.exams?.groups || {};
  const groups = Object.keys(all).sort((a, b) => Number(a) - Number(b));
  const picked = progress.examGroup?.[course.id] || progress.classGroups?.[course.id]?.['שעור'];
  let list = all[picked && all[picked] ? picked : groups[0]] || [];
  const own = progress.exams?.[course.id];
  if (own && (own.a || own.b)) {
    list = list.filter((e) => e.quiz);
    if (own.a) list.push({ key: 'a', label: 'מועד א׳', date: own.a });
    if (own.b) list.push({ key: 'b', label: 'מועד ב׳', date: own.b });
  }
  return list;
}

export function calendarFeed({ user, deadlines, progress, courses }) {
  const days = String(user.reminder_days || '3,1').split(',').map(Number).filter(Boolean);
  const short = Object.fromEntries(courses.map((c) => [c.id, c.short]));
  const done = progress.deadlinesDone || {};
  const items = [
    ...deadlines.filter((d) => !done[d.moodleKey] && !d.submitted).map((d) => ({
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
    'X-WR-CALNAME:מחברת – הגשות, מבחנים ושיעורים',
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
  for (const c of courses) {
    for (const ev of examSittings(c, progress)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || '')) continue;
      const day = ev.date.replace(/-/g, '');
      const end = new Date(`${ev.date}T12:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      const summary = `${ev.quiz ? 'בוחן' : 'מבחן'}: ${c.short} – ${ev.label}`;
      // With a published start time: a 3-hour event in Israel time; otherwise an all-day event.
      const timed = /^\d{1,2}:\d{2}$/.test(ev.time || '');
      const [hh, mm] = timed ? ev.time.split(':') : [];
      lines.push(
        'BEGIN:VEVENT',
        `UID:${esc(`exam-${c.id}-${ev.key}@study-hub`)}`,
        `DTSTAMP:${now}`,
        ...(timed
          ? [`DTSTART;TZID=Asia/Jerusalem:${day}T${hh.padStart(2, '0')}${mm}00`, `DURATION:PT3H`]
          : [`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replace(/-/g, '')}`]),
        `SUMMARY:${esc(summary)}`,
        ...(ev.place?.length ? [`LOCATION:${esc(ev.place.join(' · '))}`] : []),
        'TRANSP:TRANSPARENT'
      );
      for (const [d, text] of [[7, 'בעוד שבוע'], [1, 'מחר']]) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-P${d}D`, `DESCRIPTION:${esc(`${text}: ${summary}`)}`, 'END:VALARM');
      }
      lines.push('END:VEVENT');
    }
  }
  // Weekly classes of the student's chosen groups, from this week until the course's first exam.
  for (const c of courses) {
    const pick = progress.classGroups?.[c.id] || {};
    const firstExam = examSittings(c, progress).filter((e) => !e.quiz).map((e) => e.date).sort()[0];
    const until = firstExam ? `${firstExam.replace(/-/g, '')}T000000Z` : null;
    for (const g of c.classes || []) {
      if (pick[g.type] !== g.group) continue;
      for (const sl of g.slots || []) {
        const first = new Date();
        first.setUTCDate(first.getUTCDate() - 7 + ((sl.day - first.getUTCDay() + 7) % 7));
        const day = first.toISOString().slice(0, 10).replace(/-/g, '');
        const t = (x) => x.replace(':', '') + '00';
        const label = g.type === 'שעור' ? 'שיעור' : g.type;
        lines.push(
          'BEGIN:VEVENT',
          `UID:${esc(`class-${c.id}-${g.group}-${sl.day}-${sl.start}@study-hub`)}`,
          `DTSTAMP:${now}`,
          `DTSTART;TZID=Asia/Jerusalem:${day}T${t(sl.start)}`,
          `DTEND;TZID=Asia/Jerusalem:${day}T${t(sl.end)}`,
          `RRULE:FREQ=WEEKLY${until ? `;UNTIL=${until}` : ';COUNT=16'}`,
          `SUMMARY:${esc(`${c.short} · ${label}`)}`,
          ...(sl.place || sl.mode ? [`LOCATION:${esc(sl.place || sl.mode)}`] : []),
          `DESCRIPTION:${esc(`${label} ${g.group}${g.lecturer ? ` · ${g.lecturer}` : ''}`)}`,
          'TRANSP:OPAQUE',
          'END:VEVENT'
        );
      }
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
