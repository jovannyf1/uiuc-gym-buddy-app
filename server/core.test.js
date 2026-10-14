import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSlots, overlapsFor, matchDetails, weekdayForDate, InputError } from './core.js';

const person = (overrides = {}) => ({
  gender: 'female', partnerPreference: 'any', experience: 'beginner',
  activities: ['Strength training'], locations: ['ARC'], ...overrides,
});

test('availability merges overlapping windows but keeps separate days', () => {
  assert.deepEqual(normalizeSlots([
    { day: 1, start: '17:00', end: '18:00' },
    { day: 0, start: '10:00', end: '11:00' },
    { day: 1, start: '17:30', end: '19:00' },
  ]), [
    { day: 0, start: '10:00', end: '11:00' },
    { day: 1, start: '17:00', end: '19:00' },
  ]);
  assert.throws(() => normalizeSlots([{ day: 0, start: '10:00', end: '10:15' }]), InputError);
});

test('matches require reciprocal gender preference, common activity, place, and 30-minute overlap', () => {
  const first = person({ gender: 'male', partnerPreference: 'female' });
  const second = person({ partnerPreference: 'male' });
  const firstSlots = [{ day: 0, start: '17:00', end: '18:00' }];
  const secondSlots = [{ day: 0, start: '17:30', end: '18:30' }];
  assert.deepEqual(matchDetails(first, second, firstSlots, secondSlots)?.overlaps, [
    { day: 0, start: '17:30', end: '18:00' },
  ]);
  assert.equal(matchDetails(first, person({ partnerPreference: 'female' }), firstSlots, secondSlots), null);
  assert.equal(matchDetails(first, person({ locations: ['CRCE'] }), firstSlots, secondSlots), null);
  assert.equal(matchDetails(first, second, firstSlots, [{ day: 0, start: '17:45', end: '18:30' }]), null);
  assert.equal(matchDetails(first, person({ gender: 'nonbinary', partnerPreference: 'male' }), firstSlots, secondSlots), null);
  assert.ok(matchDetails(person({ gender: 'nonbinary', partnerPreference: 'nonbinary' }),
    person({ gender: 'nonbinary', partnerPreference: 'nonbinary' }), firstSlots, secondSlots));
});

test('meetup date weekday uses Monday zero and rejects impossible dates', () => {
  assert.equal(weekdayForDate('2026-10-19'), 0);
  assert.equal(weekdayForDate('2026-10-25'), 6);
  assert.throws(() => weekdayForDate('2026-02-30'), InputError);
});

test('many valid windows can create more than 100 shared fragments', () => {
  const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const first = [];
  const second = [];
  for (let day = 0; day < 7; day += 1) {
    for (let index = 0; index < 13; index += 1) {
      const start = index * 105;
      first.push({ day, start: clock(start), end: clock(start + 100) });
      second.push({ day, start: clock(start + 50), end: clock(start + 150) });
    }
  }
  assert.ok(overlapsFor(normalizeSlots(first), normalizeSlots(second)).length > 100);
});
