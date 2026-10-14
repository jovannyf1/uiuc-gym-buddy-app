export const ACTIVITIES = Object.freeze([
  'Strength training',
  'Cardio',
  'General workout',
  'Group fitness',
  'Stretching & mobility',
]);

export const LOCATIONS = Object.freeze(['ARC', 'CRCE']);
export const GENDERS = Object.freeze(['male', 'female', 'nonbinary', 'prefer-not-to-say']);
export const PARTNER_PREFERENCES = Object.freeze(['any', 'male', 'female', 'nonbinary']);
export const EXPERIENCE_LEVELS = Object.freeze(['beginner', 'intermediate', 'advanced']);

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'InputError';
    this.status = status;
  }
}

export function timeToMinutes(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new InputError('Use a valid time in HH:MM format.');
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function normalizeSlots(slots) {
  if (!Array.isArray(slots) || slots.length > 100) {
    throw new InputError('Add no more than 100 available time windows.');
  }
  const clean = slots.map(slot => {
    if (!slot || !Number.isInteger(slot.day) || slot.day < 0 || slot.day > 6) {
      throw new InputError('Choose a day from Monday through Sunday.');
    }
    const start = timeToMinutes(slot.start);
    const end = timeToMinutes(slot.end);
    if (end - start < 30) {
      throw new InputError('Each available window must be at least 30 minutes long.');
    }
    return { day: slot.day, start, end };
  }).sort((a, b) => a.day - b.day || a.start - b.start || a.end - b.end);

  const merged = [];
  for (const slot of clean) {
    const previous = merged.at(-1);
    if (previous && previous.day === slot.day && slot.start <= previous.end) {
      previous.end = Math.max(previous.end, slot.end);
    } else {
      merged.push({ ...slot });
    }
  }
  return merged.map(slot => ({
    day: slot.day,
    start: minutesToTime(slot.start),
    end: minutesToTime(slot.end),
  }));
}

export function overlapsFor(aSlots, bSlots) {
  const overlaps = [];
  for (const a of aSlots) {
    for (const b of bSlots) {
      if (a.day !== b.day) continue;
      const start = Math.max(timeToMinutes(a.start), timeToMinutes(b.start));
      const end = Math.min(timeToMinutes(a.end), timeToMinutes(b.end));
      if (end - start >= 30) overlaps.push({ day: a.day, start: minutesToTime(start), end: minutesToTime(end) });
    }
  }
  // The 100-window limit applies to user input, not the number of fragments
  // produced while intersecting two valid schedules.
  overlaps.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
  const merged = [];
  for (const slot of overlaps) {
    const previous = merged.at(-1);
    if (previous && previous.day === slot.day && slot.start <= previous.end) {
      if (slot.end > previous.end) previous.end = slot.end;
    } else {
      merged.push({ ...slot });
    }
  }
  return merged;
}

function acceptsGender(preference, gender) {
  return preference === 'any' || preference === gender;
}

export function matchDetails(current, candidate, currentSlots, candidateSlots) {
  if (!acceptsGender(current.partnerPreference, candidate.gender)
    || !acceptsGender(candidate.partnerPreference, current.gender)) return null;
  const sharedActivities = current.activities.filter(activity => candidate.activities.includes(activity));
  const sharedLocations = current.locations.filter(location => candidate.locations.includes(location));
  if (!sharedActivities.length || !sharedLocations.length) return null;
  const overlaps = overlapsFor(currentSlots, candidateSlots);
  if (!overlaps.length) return null;
  const overlapMinutes = overlaps.reduce((sum, slot) => sum + timeToMinutes(slot.end) - timeToMinutes(slot.start), 0);
  const score = Math.min(overlapMinutes, 600) + sharedActivities.length * 30 + sharedLocations.length * 20
    + (current.experience === candidate.experience ? 15 : 0);
  return { overlaps, sharedActivities, sharedLocations, score };
}

export function weekdayForDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InputError('Choose a valid meetup date.');
  }
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InputError('Choose a valid meetup date.');
  }
  return (date.getUTCDay() + 6) % 7;
}

export function chicagoNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
