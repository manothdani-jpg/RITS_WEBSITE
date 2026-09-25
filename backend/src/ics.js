// Minimal RFC 5545 iCalendar (.ics) generation — just enough for read-only
// public event exports. No recurrence, alarms, or attendees; events here
// only ever have a start time, so DTEND is a default 2-hour placeholder.

function foldLine(line) {
  // RFC 5545: lines SHOULD be folded at 75 octets; continuation lines
  // start with a single space. Fine to approximate octets as chars here —
  // event names/descriptions are plain text, not heavy in multi-byte UTF-8.
  if (line.length <= 75) return line;
  const chunks = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length) {
    chunks.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return chunks.join("\r\n");
}

function escapeText(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function toIcsUtc(date) {
  return new Date(date).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function buildEventLines(ev, { siteUrl } = {}) {
  const start = new Date(ev.event_date);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const lines = [
    "BEGIN:VEVENT",
    foldLine(`UID:${ev.id}@ritamilsangam.org`),
    foldLine(`DTSTAMP:${toIcsUtc(new Date())}`),
    foldLine(`DTSTART:${toIcsUtc(start)}`),
    foldLine(`DTEND:${toIcsUtc(end)}`),
    foldLine(`SUMMARY:${escapeText(ev.name)}`),
  ];
  if (ev.description) lines.push(foldLine(`DESCRIPTION:${escapeText(ev.description)}`));
  if (ev.location) lines.push(foldLine(`LOCATION:${escapeText(ev.location)}`));
  if (siteUrl) lines.push(foldLine(`URL:${escapeText(siteUrl)}`));
  lines.push("END:VEVENT");
  return lines;
}

function buildCalendar(events, opts) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rhode Island Tamil Sangam//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const ev of events) lines.push(...buildEventLines(ev, opts));
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

module.exports = { buildCalendar };
