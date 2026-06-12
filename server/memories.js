// Shared "on this day" date math, used by the API route and the morning
// memories push notification.

export function shiftDate(dateStr, { years = 0, months = 0, days = 0 }) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCMonth(d.getUTCMonth() - months);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function targetsFor(today) {
  const targets = [
    { label: '1 month ago', date: shiftDate(today, { months: 1 }) },
    { label: '3 months ago', date: shiftDate(today, { months: 3 }) },
    { label: '6 months ago', date: shiftDate(today, { months: 6 }) },
  ];
  for (let y = 1; y <= 10; y++) {
    targets.push({ label: y === 1 ? '1 year ago' : `${y} years ago`, date: shiftDate(today, { years: y }) });
  }
  return targets.filter((t) => t.date < today);
}
