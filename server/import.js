import ICAL from 'ical.js';

// All previews use UIUC local dates. Calendar titles, locations, and images are
// deliberately never included in the result.
const TIME_ZONE = 'America/Chicago';
const OPEN_MINUTE = 6 * 60;
const CLOSE_MINUTE = 22 * 60;
const MIN_SLOT_MINUTES = 60;
const MAX_CALENDAR_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_OCCURRENCES = 20_000;
const IMAGE_WARNINGS = {
  unclear_time: 'At least one time in the screenshot was unclear and needs manual review.',
  ambiguous_date: 'At least one date in the screenshot was unclear and needs manual review.',
  partial_week: 'The screenshot may show only part of the week.',
  unreadable_image: 'The screenshot could not be read clearly. Try a sharper image.',
};

const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function dateParts(date, formatter = chicagoFormatter) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function addDays(day, count) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function nextSevenDays(now) {
  const today = dateParts(now).day;
  return Array.from({ length: 7 }, (_, index) => addDays(today, index));
}

function minuteToTime(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

// The application stores recurring availability with Monday=0 through Sunday=6.
// Dates are only used while interpreting a one-time upload; they are not saved.
function toWeeklySlot(slot) {
  const sundayBased = new Date(`${slot.day}T12:00:00Z`).getUTCDay();
  return { day: (sundayBased + 6) % 7, start: slot.start, end: slot.end };
}

function timeToMinute(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value)) {
    throw new Error('An imported time is invalid. Please enter that time manually.');
  }
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function intervalToBusy(start, end, days, result) {
  const startStamp = `${start.day}T${minuteToTime(start.minute)}`;
  const endStamp = `${end.day}T${minuteToTime(end.minute)}`;
  if (endStamp <= startStamp) return;

  for (const day of days) {
    if (startStamp >= `${addDays(day, 1)}T00:00` || endStamp <= `${day}T00:00`) continue;
    const startMinute = start.day < day ? 0 : start.minute;
    const endMinute = end.day > day ? 24 * 60 : end.minute;
    const clippedStart = Math.max(OPEN_MINUTE, startMinute);
    const clippedEnd = Math.min(CLOSE_MINUTE, endMinute);
    if (clippedEnd > clippedStart) result.push({ day, start: minuteToTime(clippedStart), end: minuteToTime(clippedEnd) });
  }
}

function normalizeBusy(blocks, days) {
  if (!Array.isArray(blocks) || blocks.length > 500) {
    throw new Error('The imported schedule has too many time blocks to review.');
  }
  const allowedDays = new Set(days);
  const byDay = new Map(days.map(day => [day, []]));
  for (const block of blocks) {
    if (!block || !allowedDays.has(block.day)) {
      throw new Error('An imported date is outside the next seven days. Please review the schedule.');
    }
    const start = timeToMinute(block.start);
    const end = timeToMinute(block.end);
    if (start >= end) {
      throw new Error('An imported time range is invalid. Please review the schedule.');
    }
    const clippedStart = Math.max(OPEN_MINUTE, start);
    const clippedEnd = Math.min(CLOSE_MINUTE, end);
    if (clippedEnd > clippedStart) byDay.get(block.day).push([clippedStart, clippedEnd]);
  }

  const merged = [];
  for (const day of days) {
    const intervals = byDay.get(day).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const dayMerged = [];
    for (const [start, end] of intervals) {
      const last = dayMerged.at(-1);
      if (last && start <= last[1]) last[1] = Math.max(last[1], end);
      else dayMerged.push([start, end]);
    }
    for (const [start, end] of dayMerged) merged.push({ day, start: minuteToTime(start), end: minuteToTime(end) });
  }
  return merged;
}

function deriveSuggestedDateSlots(busy, days) {
  const normalized = normalizeBusy(busy, days);
  const suggestions = [];
  for (const day of days) {
    let cursor = OPEN_MINUTE;
    for (const block of normalized.filter(item => item.day === day)) {
      const start = timeToMinute(block.start);
      if (start - cursor >= MIN_SLOT_MINUTES) {
        suggestions.push({ day, start: minuteToTime(cursor), end: minuteToTime(start) });
      }
      cursor = Math.max(cursor, timeToMinute(block.end));
    }
    if (CLOSE_MINUTE - cursor >= MIN_SLOT_MINUTES) {
      suggestions.push({ day, start: minuteToTime(cursor), end: minuteToTime(CLOSE_MINUTE) });
    }
  }
  return suggestions;
}

export function deriveSuggestedSlots(busy, days) {
  return deriveSuggestedDateSlots(busy, days).map(toWeeklySlot);
}

function wallTimeToDate(time, timeZone) {
  const target = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second || 0);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(({ type, value }) => [type, value]));
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const correction = target - observed;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess);
}

function icalTimeToChicago(time, item, propertyName, warnings) {
  if (time.isDate) {
    return { day: `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`, minute: 0 };
  }
  const explicitZone = item.component.getFirstProperty(propertyName)?.getParameter('tzid');
  const zone = time.zone?.tzid;
  let instant;
  if (explicitZone || zone === 'floating' || !zone) {
    const preferredZone = explicitZone || TIME_ZONE;
    try {
      instant = wallTimeToDate(time, preferredZone);
    } catch {
      if (zone && zone !== 'floating') {
        // Some Outlook and Apple exports use a VTIMEZONE with a custom TZID.
        // ical.js can interpret that component even when Intl cannot.
        instant = time.toJSDate();
      } else {
        warnings.add('A calendar timezone was not recognized; its times were treated as UIUC local time.');
        instant = wallTimeToDate(time, TIME_ZONE);
      }
    }
  } else {
    instant = time.toJSDate();
  }
  return dateParts(instant);
}

function isUnavailable(item) {
  const component = item.component;
  return component.getFirstPropertyValue('status') !== 'CANCELLED'
    && component.getFirstPropertyValue('transp') !== 'TRANSPARENT';
}

function calendarPreview(file, days) {
  if (file.buffer.length > MAX_CALENDAR_BYTES) throw new Error('Calendar exports must be under 5 MB.');
  const source = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (!source.includes('BEGIN:VCALENDAR')) throw new Error('This file is not a valid .ics calendar export.');
  let calendar;
  try {
    calendar = new ICAL.Component(ICAL.parse(source));
  } catch {
    throw new Error('This calendar export could not be read. Try exporting it again as an .ics file.');
  }
  if (calendar.name.toLowerCase() !== 'vcalendar') throw new Error('This file is not a valid .ics calendar export.');

  const warnings = new Set();
  const busy = [];
  const components = calendar.getAllSubcomponents('vevent');
  const masters = components.filter(component => !component.getFirstProperty('recurrence-id'));
  const exceptions = components.filter(component => component.getFirstProperty('recurrence-id'));
  const exceptionsByUid = new Map();
  for (const component of exceptions) {
    const uid = component.getFirstPropertyValue('uid');
    if (!uid) continue;
    if (!exceptionsByUid.has(uid)) exceptionsByUid.set(uid, []);
    exceptionsByUid.get(uid).push(component);
  }
  const windowEnd = `${addDays(days.at(-1), 1)}T00:00`;

  for (const component of masters) {
    let event;
    try { event = new ICAL.Event(component); } catch { warnings.add('One calendar event could not be read.'); continue; }
    for (const exceptionComponent of exceptionsByUid.get(component.getFirstPropertyValue('uid')) || []) {
      try { event.relateException(new ICAL.Event(exceptionComponent)); }
      catch { warnings.add('One edited recurring event could not be read. Review the imported times.'); }
    }
    if (!isUnavailable(event)) continue;
    try {
      if (event.isRecurring()) {
        // Supplying a `from` time to ical.js changes recurring occurrences to
        // that time of day. Iterate from DTSTART to preserve each event's time.
        const iterator = event.iterator();
        let count = 0;
        let occurrence;
        while ((occurrence = iterator.next()) && count < MAX_OCCURRENCES) {
          count += 1;
          const details = event.getOccurrenceDetails(occurrence);
          const item = details.item;
          const start = icalTimeToChicago(details.startDate, item, 'dtstart', warnings);
          if (`${start.day}T${minuteToTime(start.minute)}` >= windowEnd) break;
          if (!isUnavailable(item)) continue;
          const end = icalTimeToChicago(details.endDate, item, 'dtend', warnings);
          intervalToBusy(start, end, days, busy);
        }
        if (count >= MAX_OCCURRENCES) warnings.add('A long recurring event was only partially read. Review its times.');
      } else {
        const start = icalTimeToChicago(event.startDate, event, 'dtstart', warnings);
        const end = icalTimeToChicago(event.endDate, event, 'dtend', warnings);
        intervalToBusy(start, end, days, busy);
      }
    } catch {
      warnings.add('One calendar event could not be read. Review the imported times.');
    }
  }

  if (components.length === 0) warnings.add('No calendar events were found in this export.');
  if (components.length > 0 && busy.length === 0) warnings.add('No busy times were found between 06:00 and 22:00 during the next seven days.');
  warnings.add('Suggestions use the next seven days; saved open times repeat weekly. Review them when your calendar changes.');
  const normalized = normalizeBusy(busy, days);
  return { source: 'calendar', busy: normalized.map(toWeeklySlot), suggestedSlots: deriveSuggestedSlots(normalized, days), warnings: [...warnings] };
}

function imageMimeType(file) {
  const mime = String(file.mimetype || '').toLowerCase();
  const data = file.buffer;
  if (mime === 'image/png' && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return mime;
  if (mime === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return mime;
  if (mime === 'image/webp' && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return mime;
  throw new Error('Upload a PNG, JPEG, or WebP screenshot.');
}

async function screenshotPreview(file, days, { fetchImpl, apiKey }) {
  if (file.buffer.length > MAX_IMAGE_BYTES) throw new Error('Screenshots must be under 10 MB.');
  const mime = imageMimeType(file);
  if (!apiKey) {
    throw new Error('Screenshot interpretation is not configured yet. Add OPENAI_API_KEY to the server, or import an .ics file or enter times manually.');
  }
  const schema = {
    type: 'object', additionalProperties: false, required: ['busy', 'warnings'],
    properties: {
      busy: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['day', 'start', 'end'],
          properties: {
            day: { type: 'string', enum: days },
            start: { type: 'string', pattern: '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' },
            end: { type: 'string', pattern: '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' },
          },
        },
      },
      warnings: { type: 'array', items: { type: 'string', enum: Object.keys(IMAGE_WARNINGS) } },
    },
  };
  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(45_000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      store: false,
      max_output_tokens: 1200,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: `Read only the occupied times visible in this schedule screenshot. Today in ${TIME_ZONE} is ${days[0]}; the next seven dates are ${days.join(', ')}. If the image is a recurring weekly class schedule, map weekday names to these dates. If it has specific dates, use only those dates. Return busy ranges as local YYYY-MM-DD days and 24-hour HH:MM times. Do not infer unseen events, titles, locations, names, or gym availability. For warnings use only these codes: unclear_time, ambiguous_date, partial_week, unreadable_image. Return an empty busy array if no times are readable.` },
          { type: 'input_image', image_url: `data:${mime};base64,${file.buffer.toString('base64')}` },
        ],
      }],
      text: { format: { type: 'json_schema', name: 'schedule_preview', strict: true, schema } },
    }),
    });
  } catch {
    throw new Error('Screenshot interpretation is unavailable right now. Please retry or enter times manually.');
  }
  if (!response.ok) {
    throw new Error(`Screenshot interpretation failed (AI service returned ${response.status}). Please retry or enter times manually.`);
  }
  let payload;
  try { payload = await response.json(); } catch { throw new Error('The AI service returned an unreadable response.'); }
  const outputText = payload.output_text
    || payload.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text;
  if (!outputText) throw new Error('The AI service did not return a readable schedule. Please try another screenshot.');
  let parsed;
  try { parsed = JSON.parse(outputText); } catch { throw new Error('The AI service returned an invalid schedule. Please try another screenshot.'); }
  const busy = normalizeBusy(parsed.busy, days);
  // Do not pass model-written prose back to the app; it could repeat a private
  // title or person's name from the screenshot.
  const warnings = Array.isArray(parsed.warnings)
    ? [...new Set(parsed.warnings)].filter(item => Object.hasOwn(IMAGE_WARNINGS, item)).map(item => IMAGE_WARNINGS[item])
    : [];
  warnings.push('Review every extracted time before applying it; screenshots can be misread.');
  if (busy.length === 0) warnings.push('No busy times were detected in this screenshot.');
  warnings.push('Suggestions use the next seven days; saved open times repeat weekly. Review them when your schedule changes.');
  return { source: 'screenshot', busy: busy.map(toWeeklySlot), suggestedSlots: deriveSuggestedSlots(busy, days), warnings };
}

export async function previewImport(file, options = {}) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new Error('Choose an .ics calendar export or a screenshot to import.');
  }
  const days = nextSevenDays(options.now instanceof Date ? options.now : new Date());
  const name = String(file.originalname || '').toLowerCase();
  const mime = String(file.mimetype || '').toLowerCase();
  if (name.endsWith('.ics') || mime === 'text/calendar') return calendarPreview(file, days);
  if (mime.startsWith('image/') || /\.(png|jpe?g|webp)$/.test(name)) {
    return screenshotPreview(file, days, {
      fetchImpl: options.fetchImpl || globalThis.fetch,
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
    });
  }
  throw new Error('Upload an .ics calendar export or a PNG, JPEG, or WebP screenshot.');
}
