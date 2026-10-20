const DAY_MS = 24 * 60 * 60 * 1000;

/** "今天", "昨天" or "N 天前" by calendar day; "" for no timestamp. */
export function daysAgo(timestamp: number | null | undefined, now: number) {
  if (
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    timestamp <= 0
  )
    return "";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.max(
    0,
    Math.ceil((startOfToday.getTime() - timestamp) / DAY_MS),
  );
  return days === 0 ? "今天" : days === 1 ? "昨天" : `${days} 天前`;
}
