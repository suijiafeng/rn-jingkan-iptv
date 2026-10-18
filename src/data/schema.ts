import { normalizeGroups } from "../domain/channelLabels";
import { countryFromIptvOrgId } from "../domain/channelFacets";
import {
  channelGroupKey,
  qualityFromIptvOrgId,
} from "../domain/channelSources";
import { RepositoryError, type SqlExecutor } from "./sql";
import { synchronizeChecks } from "./availability";

export const SCHEMA_VERSION = 8;

/**
 * Brings a database at any older user_version up to SCHEMA_VERSION inside
 * the caller's exclusive transaction. A newer database is refused.
 */
export async function migrateSchema(tx: SqlExecutor): Promise<void> {
  const version = await tx.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version",
  );
  const current = version?.user_version ?? 0;
  if (current > SCHEMA_VERSION) throw new RepositoryError("newer_schema");
  if (current === SCHEMA_VERSION) return;
  if (current < 1) await createV1(tx);
  if (current < 2) await migrateV2(tx);
  if (current < 3) await migrateV3(tx);
  if (current < 4) await migrateV4(tx);
  if (current < 5) await migrateV5(tx);
  if (current < 6) await migrateV6(tx);
  if (current < 7) await migrateV7(tx);
  if (current < 8) {
    await tx.execAsync(
      "CREATE INDEX IF NOT EXISTS channels_stream_check ON channels(streamUrl, checkedAt DESC);",
    );
    await synchronizeChecks(tx);
  }
  await tx.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

/** v7: a source can be hidden without deleting its channels or user data. */
async function migrateV7(tx: SqlExecutor): Promise<void> {
  const columns = new Set(
    (await tx.getAllAsync<{ name: string }>("PRAGMA table_info(sources)")).map(
      (column) => column.name,
    ),
  );
  if (!columns.has("enabled"))
    await tx.execAsync(
      "ALTER TABLE sources ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1));",
    );
}

async function createV1(tx: SqlExecutor): Promise<void> {
  await tx.execAsync(`
        CREATE TABLE sources (
          id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('url','file')),
          location TEXT NOT NULL, content TEXT, createdAt INTEGER NOT NULL, lastSuccessAt INTEGER NOT NULL,
          lastErrorCategory TEXT, revision INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE channels (
          id TEXT PRIMARY KEY NOT NULL, sourceId TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
          identityKey TEXT NOT NULL, name TEXT NOT NULL, groupName TEXT NOT NULL, tvgId TEXT, logoUrl TEXT,
          streamUrl TEXT NOT NULL, sortIndex INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
          lastSeenRevision INTEGER NOT NULL, UNIQUE(sourceId, identityKey)
        );
        CREATE INDEX channels_source ON channels(sourceId, active, sortIndex);
        CREATE INDEX channels_name ON channels(name COLLATE NOCASE);
        CREATE TABLE favorites (channelId TEXT PRIMARY KEY NOT NULL REFERENCES channels(id) ON DELETE CASCADE, createdAt INTEGER NOT NULL);
        CREATE TABLE recents (channelId TEXT PRIMARY KEY NOT NULL REFERENCES channels(id) ON DELETE CASCADE, lastPlayedAt INTEGER NOT NULL);
        CREATE INDEX recents_time ON recents(lastPlayedAt DESC);
        CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      `);
}

/** v2: manual availability check columns; groups translated and split by ";". */
async function migrateV2(tx: SqlExecutor): Promise<void> {
  await tx.execAsync(`
    ALTER TABLE channels ADD COLUMN checkStatus TEXT CHECK(checkStatus IN ('ok','unreachable'));
    ALTER TABLE channels ADD COLUMN checkedAt INTEGER;
  `);
  const groups = await tx.getAllAsync<{ groupName: string }>(
    "SELECT DISTINCT groupName FROM channels",
  );
  for (const { groupName } of groups) {
    const normalized = normalizeGroups(groupName);
    if (normalized !== groupName)
      await tx.runAsync(
        "UPDATE channels SET groupName = ? WHERE groupName = ?",
        [normalized, groupName],
      );
  }
}

/** Metadata is populated only by an explicit import/refresh, never guessed. */
async function migrateV3(tx: SqlExecutor): Promise<void> {
  await tx.execAsync(`
    ALTER TABLE channels ADD COLUMN countries TEXT NOT NULL DEFAULT '';
    ALTER TABLE channels ADD COLUMN languages TEXT NOT NULL DEFAULT '';
  `);
}

/**
 * v4: languages looked up in the iptv-org database live apart from playlist
 * labels, so a refresh can clear removed labels yet keep the lookup.
 */
async function migrateV4(tx: SqlExecutor): Promise<void> {
  await tx.execAsync(
    "ALTER TABLE channels ADD COLUMN lookupLanguages TEXT NOT NULL DEFAULT '';",
  );
  // Backfill countries for already-imported iptv-org ids (offline, same
  // strict rule as import) so existing lists need no refresh.
  const rows = await tx.getAllAsync<{ id: string; tvgId: string }>(
    "SELECT id, tvgId FROM channels WHERE countries = '' AND tvgId IS NOT NULL",
  );
  // Grouped by country and chunked: one statement per ~900 rows instead of
  // one per channel (11k single updates held the splash for seconds).
  const byCountry = new Map<string, string[]>();
  for (const row of rows) {
    const [country] = countryFromIptvOrgId(row.tvgId);
    if (country)
      byCountry.set(country, [...(byCountry.get(country) ?? []), row.id]);
  }
  for (const [country, ids] of byCountry)
    for (let start = 0; start < ids.length; start += 900) {
      const chunk = ids.slice(start, start + 900);
      await tx.runAsync(
        `UPDATE channels SET countries = ? WHERE id IN (${chunk.map(() => "?").join(",")})`,
        [country, ...chunk],
      );
    }
}

/** v5: reliable logical-channel grouping and explicit stream quality. */
async function migrateV5(tx: SqlExecutor): Promise<void> {
  // Inspect each column so a retried/partially applied migration is safe.
  // Normal upgrades still execute atomically, but this also protects repaired
  // or development databases whose user_version lags their actual schema.
  const columns = new Set(
    (await tx.getAllAsync<{ name: string }>("PRAGMA table_info(channels)")).map(
      (column) => column.name,
    ),
  );
  if (!columns.has("groupKey"))
    await tx.execAsync(
      "ALTER TABLE channels ADD COLUMN groupKey TEXT NOT NULL DEFAULT '';",
    );
  if (!columns.has("qualityLabel"))
    await tx.execAsync("ALTER TABLE channels ADD COLUMN qualityLabel TEXT;");
  if (!columns.has("qualityRank"))
    await tx.execAsync("ALTER TABLE channels ADD COLUMN qualityRank INTEGER;");
  const rows = await tx.getAllAsync<{
    id: string;
    sourceId: string;
    identityKey: string;
    tvgId: string | null;
  }>("SELECT id, sourceId, identityKey, tvgId FROM channels");
  for (let start = 0; start < rows.length; start += 120) {
    const chunk = rows.slice(start, start + 120);
    await tx.runAsync(
      `UPDATE channels SET
        groupKey = CASE id ${chunk
          .map(() => "WHEN ? THEN ?")
          .join(" ")} ELSE groupKey END,
        qualityLabel = CASE id ${chunk
          .map(() => "WHEN ? THEN ?")
          .join(" ")} ELSE qualityLabel END,
        qualityRank = CASE id ${chunk
          .map(() => "WHEN ? THEN ?")
          .join(" ")} ELSE qualityRank END
        WHERE id IN (${chunk.map(() => "?").join(",")})`,
      [
        ...chunk.flatMap((row) => [
          row.id,
          channelGroupKey(row.sourceId, row.identityKey, row.tvgId),
        ]),
        ...chunk.flatMap((row) => [
          row.id,
          qualityFromIptvOrgId(row.tvgId)?.label ?? null,
        ]),
        ...chunk.flatMap((row) => [
          row.id,
          qualityFromIptvOrgId(row.tvgId)?.rank ?? null,
        ]),
        ...chunk.map((row) => row.id),
      ],
    );
  }
  await tx.execAsync(
    "CREATE INDEX IF NOT EXISTS channels_group ON channels(groupKey, active, qualityRank, sortIndex);",
  );
}

/**
 * v6: favorite/recent state belongs to a logical channel, not one stream
 * row. recent_groups also remembers the exact source last played.
 */
async function migrateV6(tx: SqlExecutor): Promise<void> {
  await tx.execAsync(`
    CREATE TABLE IF NOT EXISTS favorite_groups (
      groupKey TEXT PRIMARY KEY NOT NULL, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recent_groups (
      groupKey TEXT PRIMARY KEY NOT NULL, preferredChannelId TEXT,
      lastPlayedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS favorite_groups_time ON favorite_groups(createdAt DESC);
    CREATE INDEX IF NOT EXISTS recent_groups_time ON recent_groups(lastPlayedAt DESC);
  `);
  const legacyTables = new Set(
    (
      await tx.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('favorites','recents')",
      )
    ).map((table) => table.name),
  );
  if (legacyTables.has("favorites"))
    await tx.execAsync(`
      INSERT OR IGNORE INTO favorite_groups(groupKey, createdAt)
      SELECT c.groupKey, MIN(f.createdAt) FROM favorites f
      JOIN channels c ON c.id = f.channelId GROUP BY c.groupKey;
      DROP TABLE favorites;
    `);
  if (legacyTables.has("recents"))
    await tx.execAsync(`
      INSERT OR IGNORE INTO recent_groups(groupKey, preferredChannelId, lastPlayedAt)
      SELECT c.groupKey,
        (SELECT r2.channelId FROM recents r2
           JOIN channels c2 ON c2.id = r2.channelId
           WHERE c2.groupKey = c.groupKey
           ORDER BY r2.lastPlayedAt DESC, r2.channelId LIMIT 1),
        MAX(r.lastPlayedAt)
      FROM recents r JOIN channels c ON c.id = r.channelId
      GROUP BY c.groupKey;
      DROP TABLE recents;
    `);
}
