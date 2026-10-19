import { cleanUnreferenced } from "./channelSql";
import { RepositoryError, type SqlExecutor } from "./sql";

/**
 * Favorites and recents are kept per logical channel (groupKey), so another
 * source of the same channel keeps them. Each function runs inside the
 * caller's exclusive transaction.
 */

export async function toggleFavorite(
  tx: SqlExecutor,
  channelId: string,
  now: number,
): Promise<boolean> {
  const channel = await tx.getFirstAsync<{
    id: string;
    groupKey: string;
  }>("SELECT id, groupKey FROM channels WHERE id = ?", [channelId]);
  if (!channel) throw new RepositoryError("channel_missing");
  const existing = await tx.getFirstAsync<{ groupKey: string }>(
    "SELECT groupKey FROM favorite_groups WHERE groupKey = ?",
    [channel.groupKey],
  );
  const favorite = !existing;
  if (favorite) {
    const active = await tx.getFirstAsync<{ id: string }>(
      `SELECT c.id FROM channels c JOIN sources s ON s.id = c.sourceId
       WHERE c.groupKey = ? AND c.active = 1 AND s.enabled = 1 LIMIT 1`,
      [channel.groupKey],
    );
    if (!active) throw new RepositoryError("channel_missing");
    await tx.runAsync(
      "INSERT INTO favorite_groups(groupKey,createdAt) VALUES(?,?)",
      [channel.groupKey, now],
    );
  } else
    await tx.runAsync("DELETE FROM favorite_groups WHERE groupKey = ?", [
      channel.groupKey,
    ]);
  await cleanUnreferenced(tx);
  return favorite;
}

/** Keeps the newest 100 logical channels. */
export async function recordRecent(
  tx: SqlExecutor,
  channelId: string,
  now: number,
): Promise<void> {
  const channel = await tx.getFirstAsync<{
    id: string;
    groupKey: string;
  }>(
    `SELECT c.id, c.groupKey FROM channels c JOIN sources s ON s.id = c.sourceId
     WHERE c.id = ? AND c.active = 1 AND s.enabled = 1`,
    [channelId],
  );
  if (!channel) return;
  await tx.runAsync(
    `INSERT INTO recent_groups(groupKey,preferredChannelId,lastPlayedAt)
     VALUES(?,?,?) ON CONFLICT(groupKey) DO UPDATE SET
     preferredChannelId=excluded.preferredChannelId,
     lastPlayedAt=excluded.lastPlayedAt`,
    [channel.groupKey, channel.id, now],
  );
  await tx.runAsync(
    `DELETE FROM recent_groups WHERE groupKey NOT IN (
       SELECT groupKey FROM recent_groups
       ORDER BY lastPlayedAt DESC, groupKey LIMIT 100
     )`,
  );
  await cleanUnreferenced(tx);
}

export async function removeRecent(
  tx: SqlExecutor,
  channelId: string,
): Promise<void> {
  await tx.runAsync(
    `DELETE FROM recent_groups WHERE groupKey = (
       SELECT groupKey FROM channels WHERE id = ?
     )`,
    [channelId],
  );
  await cleanUnreferenced(tx);
}

export async function clearRecent(tx: SqlExecutor): Promise<void> {
  await tx.runAsync("DELETE FROM recent_groups");
  await cleanUnreferenced(tx);
}
