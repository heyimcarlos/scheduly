import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, 'yyyy-MM-dd');
}

export function getMinutesInTimeZone(date: Date, timeZone: string): number {
  const hour = Number(formatInTimeZone(date, timeZone, 'H'));
  const minute = Number(formatInTimeZone(date, timeZone, 'm'));
  return (hour * 60) + minute;
}

export function getTimeZoneShortName(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(date);

  return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
}

export function zonedLocalTimeToUtc(
  dateKey: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return fromZonedTime(new Date(year, month - 1, day, hour, minute, 0, 0), timeZone);
}

export function parseTimeStringToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour * 60) + minute;
}

export function isMinuteInWindow(
  minuteOfDay: number,
  startMinute: number,
  endMinute: number,
): boolean {
  if (startMinute <= endMinute) {
    return minuteOfDay >= startMinute && minuteOfDay < endMinute;
  }

  return minuteOfDay >= startMinute || minuteOfDay < endMinute;
}
