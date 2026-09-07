function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function localJournalDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export function isJournalDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}

export function formatJournalDate(
  dateKey: string,
  locales: Intl.LocalesArgument = "en-US",
  currentDate = new Date(),
): string {
  if (!isJournalDateKey(dateKey)) return dateKey;
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locales, {
    weekday: "short",
    month: "short",
    day: "2-digit",
    ...(year === currentDate.getFullYear() ? {} : { year: "numeric" }),
  }).format(new Date(year, month - 1, day, 12));
}

export function shiftJournalDateKey(dateKey: string, days: number): string {
  if (!isJournalDateKey(dateKey)) return dateKey;
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day + days, 12);
  return localJournalDateKey(date);
}

export function formatJournalDayGroup(
  timestamp: number,
  locales: Intl.LocalesArgument = "en-US",
  currentDate = new Date(),
): string {
  const dateKey = localJournalDateKey(new Date(timestamp));
  const todayKey = localJournalDateKey(currentDate);
  if (dateKey === todayKey) return "Today";
  if (dateKey === shiftJournalDateKey(todayKey, -1)) return "Yesterday";
  return formatJournalDate(dateKey, locales, currentDate);
}
