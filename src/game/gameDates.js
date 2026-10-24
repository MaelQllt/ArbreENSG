function parisDateParts(date) {
  const values = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(values
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
}

function parisEffectiveDate(date) {
  const { year, month, day, hour } = parisDateParts(date);
  return new Date(Date.UTC(year, month - 1, day - (hour < 12 ? 1 : 0)));
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

export function parisDateKey(date) {
  const { year, month, day } = parisDateParts(date);
  return dateKey(new Date(Date.UTC(year, month - 1, day)));
}

export function dailyPeriodKey(date) {
  return dateKey(parisEffectiveDate(date));
}

export function weeklyPeriodKey(date) {
  const effectiveDate = parisEffectiveDate(date);
  const daysSinceMonday = (effectiveDate.getUTCDay() + 6) % 7;
  effectiveDate.setUTCDate(effectiveDate.getUTCDate() - daysSinceMonday);
  return dateKey(effectiveDate);
}

export function formatArchiveDate(periodKey) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(periodKey + 'T12:00:00Z'));
}

export function formatArchiveMonth(date) {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function getArchiveMonthCells(month) {
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const leadingCells = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return [
    ...Array(leadingCells).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => (
      dateKey(new Date(Date.UTC(year, monthIndex, index + 1)))
    )),
  ];
}

export function getNextParisNoon(date) {
  const parts = parisDateParts(date);
  const day = parts.day + (parts.hour < 12 ? 0 : 1);
  return parisWallTimeToUtc(parts.year, parts.month, day, 12);
}

function parisWallTimeToUtc(year, month, day, hour) {
  const targetWallTime = Date.UTC(year, month - 1, day, hour);
  let guess = targetWallTime;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const local = parisDateParts(new Date(guess));
    const representedWallTime = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second
    );
    guess += targetWallTime - representedWallTime;
  }
  return guess;
}

function getNextParisMondayNoon(date) {
  const { year, month, day, hour } = parisDateParts(date);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const daysUntilMonday = (8 - calendarDate.getUTCDay()) % 7;
  const daysToAdd = daysUntilMonday === 0 && hour >= 12 ? 7 : daysUntilMonday;
  calendarDate.setUTCDate(calendarDate.getUTCDate() + daysToAdd);
  return parisWallTimeToUtc(
    calendarDate.getUTCFullYear(),
    calendarDate.getUTCMonth() + 1,
    calendarDate.getUTCDate(),
    12
  );
}

export function formatCountdown(milliseconds) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return String(hours).padStart(2, '0') + 'h' + String(minutes).padStart(2, '0') + 'min';
}

export function formatWeeklyReset(date) {
  const nextReset = new Date(getNextParisMondayNoon(date));
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  }).formatToParts(nextReset);
  const values = Object.fromEntries(parts
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, value]));
  return 'Prochain défi ' + values.weekday + ' ' + values.day + '/' + values.month + ' à 12h';
}
