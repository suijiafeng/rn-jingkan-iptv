import { normalizeRemoteUrl } from "../domain/url";
import { channelGroupKey } from "../domain/channelSources";
import { utf8ByteLength } from "../domain/m3u";
import type { SqlExecutor, SqlValue } from "./sql";

export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
const MAX_ROWS = 100_000;
const SOURCE_COLUMNS = [
  "id",
  "name",
  "kind",
  "location",
  "content",
  "createdAt",
  "lastSuccessAt",
  "revision",
] as const;
const CHANNEL_COLUMNS = [
  "id",
  "sourceId",
  "identityKey",
  "name",
  "groupName",
  "tvgId",
  "logoUrl",
  "streamUrl",
  "sortIndex",
  "active",
  "lastSeenRevision",
  "countries",
  "languages",
  "lookupLanguages",
  "groupKey",
  "qualityLabel",
  "qualityRank",
] as const;
const PREFERENCES = [
  "mobileWarning",
  "swipeReverse",
  "skipUnreachable",
] as const;
type BackupRow = Record<string, SqlValue>;
export interface LocalBackup {
  format: "jingkan-backup";
  version: 1;
  createdAt: number;
  sources: BackupRow[];
  channels: BackupRow[];
  favorites: BackupRow[];
  preferences: Record<string, boolean>;
}
export class BackupError extends Error {
  constructor(message = "备份格式无效或数据不完整，请选择静看导出的备份。") {
    super(message);
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BackupError();
  return value as Record<string, unknown>;
}
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) throw new BackupError();
  return value.map(object);
}
function string(value: unknown, empty = false): string {
  if (
    typeof value !== "string" ||
    (!empty && !value.trim()) ||
    value.length > MAX_BACKUP_BYTES
  )
    throw new BackupError();
  return value;
}
function integer(value: unknown, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
    throw new BackupError();
  return value;
}
function select(
  row: Record<string, unknown>,
  columns: readonly string[],
): BackupRow {
  return Object.fromEntries(
    columns.map((key) => {
      const value = row[key];
      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number"
      )
        throw new BackupError();
      return [key, value];
    }),
  ) as BackupRow;
}

/** Strictly bounded, versioned local data; no SQL or arbitrary settings from files. */
export function parseBackup(text: string): LocalBackup {
  if (text.length > MAX_BACKUP_BYTES || utf8ByteLength(text) > MAX_BACKUP_BYTES)
    throw new BackupError("备份超过 32 MiB 上限。");
  try {
    const data = object(JSON.parse(text));
    if (data.format !== "jingkan-backup" || data.version !== 1)
      throw new BackupError("备份版本不受支持，请更新静看后重试。");
    const sourceIds = new Set<string>();
    const sources = rows(data.sources).map((row) => {
      const id = string(row.id);
      if (sourceIds.has(id)) throw new BackupError();
      sourceIds.add(id);
      string(row.name);
      const location = string(row.location);
      if (row.kind === "url") {
        normalizeRemoteUrl(location);
        if (row.content !== null) throw new BackupError();
      } else if (row.kind === "file") string(row.content, true);
      else throw new BackupError();
      integer(row.createdAt);
      integer(row.lastSuccessAt);
      integer(row.revision, 1);
      return select(row, SOURCE_COLUMNS);
    });
    const channelIds = new Set<string>(),
      identities = new Set<string>(),
      groupKeys = new Set<string>();
    const channels = rows(data.channels).map((row) => {
      const id = string(row.id),
        sourceId = string(row.sourceId),
        identityKey = string(row.identityKey);
      const identity = JSON.stringify([sourceId, identityKey]);
      if (
        !sourceIds.has(sourceId) ||
        channelIds.has(id) ||
        identities.has(identity)
      )
        throw new BackupError();
      channelIds.add(id);
      identities.add(identity);
      string(row.name);
      string(row.groupName, true);
      const tvgId = row.tvgId === null ? null : string(row.tvgId);
      normalizeRemoteUrl(string(row.streamUrl));
      if (
        identityKey !== `url:${row.streamUrl}` &&
        (!tvgId || identityKey !== `id:${tvgId}`)
      )
        throw new BackupError();
      const groupKey = channelGroupKey(sourceId, identityKey, tvgId);
      if (row.groupKey !== groupKey) throw new BackupError();
      groupKeys.add(groupKey);
      if (row.logoUrl !== null) {
        const logo = normalizeRemoteUrl(string(row.logoUrl));
        if (!logo) throw new BackupError();
      }
      for (const key of ["countries", "languages", "lookupLanguages"])
        string(row[key], true);
      integer(row.sortIndex);
      integer(row.lastSeenRevision, 1);
      if (row.active !== 0 && row.active !== 1) throw new BackupError();
      if (row.qualityLabel !== null) string(row.qualityLabel);
      if (row.qualityRank !== null) integer(row.qualityRank);
      return select(row, CHANNEL_COLUMNS);
    });
    const favoriteKeys = new Set<string>();
    const favorites = rows(data.favorites).map((row) => {
      const key = string(row.groupKey);
      if (!groupKeys.has(key) || favoriteKeys.has(key)) throw new BackupError();
      favoriteKeys.add(key);
      integer(row.createdAt);
      return select(row, ["groupKey", "createdAt"]);
    });
    const preferences: Record<string, boolean> = {};
    const saved = object(data.preferences);
    for (const key of PREFERENCES) {
      if (typeof saved[key] !== "boolean") throw new BackupError();
      preferences[key] = saved[key];
    }
    return {
      format: "jingkan-backup",
      version: 1,
      createdAt: integer(data.createdAt),
      sources,
      channels,
      favorites,
      preferences,
    };
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError();
  }
}

export async function readBackup(
  tx: SqlExecutor,
  now: number,
): Promise<LocalBackup> {
  const preferences: Record<string, boolean> = {};
  for (const key of PREFERENCES) {
    const row = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      [key],
    );
    preferences[key] =
      row?.value === "true" ||
      (row?.value !== "false" && key !== "swipeReverse");
  }
  return {
    format: "jingkan-backup",
    version: 1,
    createdAt: now,
    sources: await tx.getAllAsync<BackupRow>(
      `SELECT ${SOURCE_COLUMNS.join(",")} FROM sources ORDER BY createdAt,id`,
    ),
    channels: await tx.getAllAsync<BackupRow>(
      `SELECT ${CHANNEL_COLUMNS.join(",")} FROM channels WHERE active = 1 OR groupKey IN (SELECT groupKey FROM favorite_groups) ORDER BY sourceId,sortIndex,id`,
    ),
    favorites: await tx.getAllAsync<BackupRow>(
      "SELECT groupKey,createdAt FROM favorite_groups ORDER BY groupKey",
    ),
    preferences,
  };
}

/** Caller owns one exclusive transaction; failure rolls back the entire replacement. */
export async function writeBackup(
  tx: SqlExecutor,
  backup: LocalBackup,
): Promise<void> {
  for (const table of [
    "recent_groups",
    "favorite_groups",
    "channels",
    "sources",
    "settings",
  ])
    await tx.runAsync(`DELETE FROM ${table}`);
  for (const [table, columns, entries] of [
    ["sources", SOURCE_COLUMNS, backup.sources],
    ["channels", CHANNEL_COLUMNS, backup.channels],
    ["favorite_groups", ["groupKey", "createdAt"], backup.favorites],
  ] as const) {
    const batchSize = Math.floor(900 / columns.length);
    for (let offset = 0; offset < entries.length; offset += batchSize) {
      const batch = entries.slice(offset, offset + batchSize);
      await tx.runAsync(
        `INSERT INTO ${table}(${columns.join(",")}) VALUES ${batch.map(() => `(${columns.map(() => "?").join(",")})`).join(",")}`,
        batch.flatMap((row) => columns.map((key) => row[key])),
      );
    }
  }
  for (const key of PREFERENCES)
    await tx.runAsync("INSERT INTO settings(key,value) VALUES(?,?)", [
      key,
      JSON.stringify(backup.preferences[key]),
    ]);
}
