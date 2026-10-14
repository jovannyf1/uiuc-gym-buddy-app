import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSuggestedSlots, previewImport } from './import.js';

const NOW = new Date('2026-10-09T12:00:00.000Z'); // Friday morning in Champaign

test('free windows subtract and merge busy blocks, keeping only gaps of at least one hour', () => {
  const slots = deriveSuggestedSlots([
    { day: '2026-10-09', start: '08:00', end: '08:30' },
    { day: '2026-10-09', start: '06:00', end: '07:00' },
    { day: '2026-10-09', start: '10:00', end: '10:30' },
    { day: '2026-10-09', start: '10:15', end: '11:00' },
  ], ['2026-10-09']);
  assert.deepEqual(slots, [
    { day: 4, start: '07:00', end: '08:00' },
    { day: 4, start: '08:30', end: '10:00' },
    { day: 4, start: '11:00', end: '22:00' },
  ]);
});

test('calendar import reads one-off and weekly events without exposing event details', async () => {
  const ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//Illini Test//EN\r
BEGIN:VEVENT\r
UID:one-off\r
SUMMARY:Private appointment\r
DTSTART;TZID=America/Chicago:20261009T090000\r
DTEND;TZID=America/Chicago:20261009T100000\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:recurring\r
SUMMARY:Confidential class\r
DTSTART;TZID=America/Chicago:20260928T170000\r
DTEND;TZID=America/Chicago:20260928T180000\r
RRULE:FREQ=WEEKLY;BYDAY=MO\r
END:VEVENT\r
END:VCALENDAR\r
`;
  const result = await previewImport({
    buffer: Buffer.from(ics), mimetype: 'text/calendar', originalname: 'calendar.ics',
  }, { now: NOW });

  assert.equal(result.source, 'calendar');
  assert.deepEqual(result.busy, [
    { day: 4, start: '09:00', end: '10:00' },
    { day: 0, start: '17:00', end: '18:00' },
  ]);
  assert.deepEqual(result.suggestedSlots.filter(slot => slot.day === 4), [
    { day: 4, start: '06:00', end: '09:00' },
    { day: 4, start: '10:00', end: '22:00' },
  ]);
  assert.ok(!JSON.stringify(result).includes('Private appointment'));
  assert.ok(!JSON.stringify(result).includes('Confidential class'));
});

test('calendar import respects edited occurrences and all-day commitments', async () => {
  const ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:repeat\r
DTSTART;TZID=America/Chicago:20260928T170000\r
DTEND;TZID=America/Chicago:20260928T180000\r
RRULE:FREQ=WEEKLY;BYDAY=MO\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:repeat\r
RECURRENCE-ID;TZID=America/Chicago:20261012T170000\r
DTSTART;TZID=America/Chicago:20261012T190000\r
DTEND;TZID=America/Chicago:20261012T200000\r
SUMMARY:Private reschedule\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:all-day\r
DTSTART;VALUE=DATE:20261010\r
DTEND;VALUE=DATE:20261011\r
END:VEVENT\r
END:VCALENDAR\r
`;
  const result = await previewImport({
    buffer: Buffer.from(ics), mimetype: 'text/calendar', originalname: 'schedule.ics',
  }, { now: NOW });
  assert.deepEqual(result.busy, [
    { day: 5, start: '06:00', end: '22:00' },
    { day: 0, start: '19:00', end: '20:00' },
  ]);
  assert.equal(result.suggestedSlots.some(slot => slot.day === 5), false);
  assert.ok(!JSON.stringify(result).includes('Private reschedule'));
});

test('calendar import converts UTC events to UIUC time and skips cancelled events', async () => {
  const ics = `BEGIN:VCALENDAR\r
VERSION:2.0\r
BEGIN:VEVENT\r
UID:utc\r
DTSTART:20261009T140000Z\r
DTEND:20261009T150000Z\r
END:VEVENT\r
BEGIN:VEVENT\r
UID:cancelled\r
STATUS:CANCELLED\r
DTSTART:20261009T170000Z\r
DTEND:20261009T180000Z\r
END:VEVENT\r
END:VCALENDAR\r
`;
  const result = await previewImport({
    buffer: Buffer.from(ics), mimetype: 'text/calendar', originalname: 'google.ics',
  }, { now: NOW });
  assert.deepEqual(result.busy, [{ day: 4, start: '09:00', end: '10:00' }]);
});

test('screenshot import requires a server-side API key', async () => {
  const file = {
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
    mimetype: 'image/png',
    originalname: 'schedule.png',
  };
  await assert.rejects(() => previewImport(file, { now: NOW, apiKey: '' }), /OPENAI_API_KEY/);
});

test('screenshot import uses the Responses image input and validates extracted times', async () => {
  const file = {
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
    mimetype: 'image/png',
    originalname: 'schedule.png',
  };
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({
        busy: [{ day: '2026-10-09', start: '12:00', end: '13:00' }], warnings: [],
      }) }] }] }),
    };
  };
  const result = await previewImport(file, { now: NOW, apiKey: 'test-only-key', fetchImpl });
  assert.equal(request.store, false);
  assert.equal(request.model, process.env.OPENAI_MODEL || 'gpt-4.1-mini');
  assert.equal(request.input[0].content[1].type, 'input_image');
  assert.match(request.input[0].content[1].image_url, /^data:image\/png;base64,/);
  assert.equal(request.text.format.type, 'json_schema');
  assert.deepEqual(result.busy, [{ day: 4, start: '12:00', end: '13:00' }]);

  const privateWarningFetch = async () => ({
    ok: true,
    json: async () => ({ output_text: JSON.stringify({
      busy: [], warnings: ['Private event: therapy', 'unclear_time'],
    }) }),
  });
  const sanitized = await previewImport(file, { now: NOW, apiKey: 'test-only-key', fetchImpl: privateWarningFetch });
  assert.ok(!JSON.stringify(sanitized).includes('Private event'));
  assert.ok(sanitized.warnings.some(warning => warning.includes('unclear')));

  const invalidFetch = async () => ({
    ok: true,
    json: async () => ({ output_text: JSON.stringify({
      busy: [{ day: '2026-10-20', start: '25:00', end: '26:00' }], warnings: [],
    }) }),
  });
  await assert.rejects(() => previewImport(file, { now: NOW, apiKey: 'test-only-key', fetchImpl: invalidFetch }), /outside the next seven days/);
});
