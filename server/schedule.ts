export function syncDelay(
  lastAttempt: string | null,
  intervalMinutes: number,
  now = Date.now(),
) {
  const previous = lastAttempt ? Date.parse(lastAttempt) : NaN;
  if (!Number.isFinite(previous)) return 0;
  return Math.max(0, previous + intervalMinutes * 60_000 - now);
}
