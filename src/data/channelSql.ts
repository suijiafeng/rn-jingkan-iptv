import { M3U_LIMITS, utf8ByteLength } from "../domain/m3u";
import { synchronizeChecks } from "./availability";
import type {
  Channel,
  ChannelQuery,
  ImportPreview,
  Source,
} from "../domain/types";
import { normalizeRemoteUrl } from "../domain/url";
import { UNGROUPED } from "../domain/channelLabels";
import {
  normalizeCountries,
  normalizeLanguages,
} from "../domain/channelFacets";
import { channelGroupKey } from "../domain/channelSources";
import { RepositoryError, type SqlExecutor, type SqlValue } from "./sql";

/** SQL fragments, row mapping and batch writes shared by the repository. */

export interface RawSource extends Omit<Source, "enabled"> {
  enabled: number;
  content?: string | null;
}
export interface RawChannel extends Omit<
  Channel,
  "active" | "favorite" | "countries" | "languages"
> {
  active: number;
  favorite: number;
  countries: string;
  languages: string;
  lookupLanguages?: string;
  favoriteCreatedAt?: number | null;
  sourceCreatedAt?: number;
  groupRow?: number;
  preferredChannelId?: string | null;
  sourceEnabled?: number;
}

export const SOURCE_SELECT = `SELECT s.id, s.name, s.kind, s.location, s.createdAt, s.lastSuccessAt,
  s.lastErrorCategory, s.revision, s.enabled,
  (SELECT COUNT(*) FROM channels c WHERE c.sourceId = s.id AND c.active = 1) AS channelCount,
  (SELECT COUNT(DISTINCT c.groupKey) FROM channels c JOIN favorite_groups f ON f.groupKey = c.groupKey
    WHERE c.sourceId = s.id AND c.active = 1) AS favoriteCount
  FROM sources s`;
export const CHANNEL_SELECT = `SELECT c.*, s.name AS sourceName, s.createdAt AS sourceCreatedAt,
  s.enabled AS sourceEnabled,
  CASE WHEN fg.groupKey IS NULL THEN 0 ELSE 1 END AS favorite,
  fg.createdAt AS favoriteCreatedAt, rg.lastPlayedAt, rg.preferredChannelId
  FROM channels c JOIN sources s ON s.id = c.sourceId
  LEFT JOIN favorite_groups fg ON fg.groupKey = c.groupKey
  LEFT JOIN recent_groups rg ON rg.groupKey = c.groupKey`;
// Use a conservative bound below SQLite's historical 999-variable limit.
const MAX_INSERT_PARAMETERS = 900;
const CHANNEL_BOUND_COLUMNS = [
  "id",
  "sourceId",
  "identityKey",
  "groupKey",
  "name",
  "groupName",
  "tvgId",
  "logoUrl",
  "countries",
  "languages",
  "streamUrl",
  "qualityLabel",
  "qualityRank",
  "sortIndex",
  "lastSeenRevision",
];
// One collator: localeCompare with a locale builds a new one per comparison,
// which on Hermes/Android made listing groups take ~100 ms.
export const groupOrder = new Intl.Collator("zh-Hans-CN");
const CLEAN_UNREFERENCED = [
  `DELETE FROM channels WHERE active = 0
    AND groupKey NOT IN (SELECT groupKey FROM favorite_groups)
    AND groupKey NOT IN (SELECT groupKey FROM recent_groups)`,
  `DELETE FROM favorite_groups WHERE NOT EXISTS (
    SELECT 1 FROM channels c WHERE c.groupKey = favorite_groups.groupKey
  )`,
  `DELETE FROM recent_groups WHERE NOT EXISTS (
    SELECT 1 FROM channels c WHERE c.groupKey = recent_groups.groupKey
  )`,
] as const;

/** Drops rows and favorite/recent state no active channel refers to. */
export async function cleanUnreferenced(tx: SqlExecutor): Promise<void> {
  for (const statement of CLEAN_UNREFERENCED) await tx.runAsync(statement);
}

export function channelFilter(query: ChannelQuery): {
  where: string;
  params: SqlValue[];
} {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (!query.includeInactive) where.push("c.active = 1", "s.enabled = 1");
  if (query.sourceId) {
    where.push("c.sourceId = ?");
    params.push(query.sourceId);
  }
  if (query.groupName !== undefined) {
    if (!query.groupName || query.groupName === UNGROUPED) {
      where.push("(c.groupName = ? OR c.groupName = '')");
      params.push(UNGROUPED);
    } else {
      // groupName holds a ";"-joined list; match one whole member.
      where.push("(';' || c.groupName || ';') LIKE ? ESCAPE '\\'");
      params.push(`%;${query.groupName.replace(/[\\%_]/g, "\\$&")};%`);
    }
  }
  for (const [column, value] of [
    ["c.countries", query.country],
    [EFFECTIVE_LANGUAGES, query.language],
  ] as const) {
    if (value === undefined) continue;
    if (value === "") where.push(`${column} = ''`);
    else {
      where.push(`(';' || ${column} || ';') LIKE ? ESCAPE '\\'`);
      params.push(`%;${value.replace(/[\\%_]/g, "\\$&")};%`);
    }
  }
  if (query.search?.trim()) {
    where.push("c.name LIKE ? ESCAPE '\\' COLLATE NOCASE");
    params.push(`%${query.search.trim().replace(/[\\%_]/g, "\\$&")}%`);
  }
  if (query.mode === "favorites")
    where.push(
      "EXISTS (SELECT 1 FROM favorite_groups f WHERE f.groupKey = c.groupKey)",
    );
  if (query.mode === "recent")
    where.push(
      "EXISTS (SELECT 1 FROM recent_groups r WHERE r.groupKey = c.groupKey)",
    );
  return {
    where: where.length ? ` WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

export function assertPreview(preview: ImportPreview): void {
  if (!preview.channels.length) throw new RepositoryError("empty_import");
  if (preview.channels.length > M3U_LIMITS.maxEntries)
    throw new RepositoryError("invalid_input");
  const seen = new Set<string>();
  for (const channel of preview.channels) {
    if (!channel.identityKey || !channel.name || seen.has(channel.identityKey))
      throw new RepositoryError("invalid_input");
    normalizeRemoteUrl(channel.streamUrl);
    seen.add(channel.identityKey);
  }
}
export function assertContent(content: string): void {
  if (
    content.length > M3U_LIMITS.maxBytes ||
    utf8ByteLength(content) > M3U_LIMITS.maxBytes
  )
    throw new RepositoryError("invalid_input");
}
// Playlist labels win; otherwise the iptv-org lookup (if the user ran it).
const EFFECTIVE_LANGUAGES =
  "(CASE WHEN c.languages <> '' THEN c.languages ELSE c.lookupLanguages END)";

export function mapChannel(row: RawChannel): Channel {
  const {
    lookupLanguages,
    favoriteCreatedAt: _favoriteCreatedAt,
    sourceCreatedAt: _sourceCreatedAt,
    groupRow: _groupRow,
    preferredChannelId: _preferredChannelId,
    sourceEnabled,
    ...rest
  } = row;
  return {
    ...rest,
    countries: normalizeCountries(row.countries),
    languages: normalizeLanguages(row.languages || lookupLanguages),
    active: row.active === 1 && sourceEnabled !== 0,
    favorite: row.favorite === 1,
  };
}

export function mapSource(row: RawSource): Source {
  return { ...row, enabled: row.enabled === 1 };
}

/**
 * Inserts or updates a playlist's channels by stable identity (reliable
 * tvg-id or full URL), in batches that stay under SQLite's variable limit.
 */
export async function upsertChannels(
  tx: SqlExecutor,
  sourceId: string,
  revision: number,
  preview: ImportPreview,
  makeId: () => string,
): Promise<void> {
  const existing = await tx.getAllAsync<{ id: string; identityKey: string }>(
    "SELECT id, identityKey FROM channels WHERE sourceId = ?",
    [sourceId],
  );
  const identities = new Map(existing.map((row) => [row.identityKey, row.id]));
  // Derive batch capacity from the bound columns so adding metadata cannot
  // silently exceed SQLite's variable limit.
  const batchSize = Math.floor(
    MAX_INSERT_PARAMETERS / CHANNEL_BOUND_COLUMNS.length,
  );
  for (let start = 0; start < preview.channels.length; start += batchSize) {
    const batch = preview.channels.slice(start, start + batchSize);
    const params: SqlValue[] = [];
    batch.forEach((channel, offset) => {
      params.push(
        identities.get(channel.identityKey) ?? makeId(),
        sourceId,
        channel.identityKey,
        channelGroupKey(sourceId, channel.identityKey, channel.tvgId),
        channel.name,
        channel.groupName,
        channel.tvgId,
        channel.logoUrl,
        normalizeCountries(channel.countries?.join(";")).join(";"),
        normalizeLanguages(channel.languages?.join(";")).join(";"),
        channel.streamUrl,
        channel.qualityLabel ?? null,
        channel.qualityRank ?? null,
        start + offset,
        revision,
      );
    });
    await tx.runAsync(
      `INSERT INTO channels(${CHANNEL_BOUND_COLUMNS.join(",")},active)
      VALUES${batch.map(() => `(${CHANNEL_BOUND_COLUMNS.map(() => "?").join(",")},1)`).join(",")} ON CONFLICT(sourceId, identityKey) DO UPDATE SET
      name=excluded.name,groupKey=excluded.groupKey,groupName=excluded.groupName,tvgId=excluded.tvgId,logoUrl=excluded.logoUrl,
      countries=excluded.countries,languages=excluded.languages,
      lookupLanguages=CASE WHEN channels.tvgId IS excluded.tvgId THEN channels.lookupLanguages ELSE '' END,
      checkStatus=CASE WHEN channels.streamUrl=excluded.streamUrl THEN channels.checkStatus END,
      checkedAt=CASE WHEN channels.streamUrl=excluded.streamUrl THEN channels.checkedAt END,
      streamUrl=excluded.streamUrl,qualityLabel=excluded.qualityLabel,qualityRank=excluded.qualityRank,
      sortIndex=excluded.sortIndex,active=1,lastSeenRevision=excluded.lastSeenRevision`,
      params,
    );
  }
  await synchronizeChecks(tx, sourceId);
  // Favorite/recent state is keyed by groupKey, so newly imported
  // alternatives inherit it without copying per-stream rows.
}
