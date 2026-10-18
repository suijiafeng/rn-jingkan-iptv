import { M3U_LIMITS, utf8ByteLength } from "../domain/m3u";
import type {
  Channel,
  ChannelQuery,
  ImportPreview,
  ImportSourceInput,
  RefreshToken,
  Source,
} from "../domain/types";
import { normalizeRemoteUrl } from "../domain/url";
import {
  normalizeGroups,
  splitGroups,
  UNGROUPED,
} from "../domain/channelLabels";
import {
  buildFacetOptions,
  countryFromIptvOrgId,
  normalizeCountries,
  normalizeLanguages,
  type ChannelFacetOptions,
  type FacetChannel,
} from "../domain/channelFacets";

export const SCHEMA_VERSION = 4;

export type SqlValue = string | number | null;
export interface SqlExecutor {
  execAsync(sql: string): Promise<void>;
  runAsync(
    sql: string,
    params?: SqlValue[],
  ): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
}
export interface SqlDatabase extends SqlExecutor {
  withExclusiveTransactionAsync(
    task: (tx: SqlExecutor) => Promise<void>,
  ): Promise<void>;
}

export class RepositoryError extends Error {
  constructor(
    public readonly code:
      | "source_missing"
      | "stale_refresh"
      | "empty_import"
      | "invalid_input"
      | "newer_schema"
      | "channel_missing",
  ) {
    super(
      {
        source_missing: "来源已删除。",
        stale_refresh: "此刷新已过期，请重新刷新。",
        empty_import: "没有有效频道，原数据保持不变。",
        invalid_input: "导入数据不完整。",
        newer_schema: "本地数据由更新版本创建，请更新应用。",
        channel_missing: "频道已不可用。",
      }[code],
    );
    this.name = "RepositoryError";
  }
}

interface RawSource extends Source {
  content?: string | null;
}
interface RawChannel extends Omit<
  Channel,
  "active" | "favorite" | "countries" | "languages"
> {
  active: number;
  favorite: number;
  countries: string;
  languages: string;
  lookupLanguages?: string;
}
export interface RefreshOptions {
  content?: string;
  location?: string;
  generation?: number;
}
export interface RepositoryOptions {
  now?: () => number;
  makeId?: () => string;
}

const SOURCE_SELECT = `SELECT s.id, s.name, s.kind, s.location, s.createdAt, s.lastSuccessAt,
  s.lastErrorCategory, s.revision,
  (SELECT COUNT(*) FROM channels c WHERE c.sourceId = s.id AND c.active = 1) AS channelCount,
  (SELECT COUNT(*) FROM channels c JOIN favorites f ON f.channelId = c.id WHERE c.sourceId = s.id) AS favoriteCount
  FROM sources s`;
const CHANNEL_SELECT = `SELECT c.*, s.name AS sourceName,
  CASE WHEN f.channelId IS NOT NULL THEN 1 ELSE 0 END AS favorite,
  r.lastPlayedAt AS lastPlayedAt FROM channels c JOIN sources s ON s.id = c.sourceId
  LEFT JOIN favorites f ON f.channelId = c.id LEFT JOIN recents r ON r.channelId = c.id`;
// Use a conservative bound below SQLite's historical 999-variable limit.
const MAX_INSERT_PARAMETERS = 900;
const CHANNEL_BOUND_COLUMNS = [
  "id",
  "sourceId",
  "identityKey",
  "name",
  "groupName",
  "tvgId",
  "logoUrl",
  "countries",
  "languages",
  "streamUrl",
  "sortIndex",
  "lastSeenRevision",
];
// One collator: localeCompare with a locale builds a new one per comparison,
// which on Hermes/Android made listing groups take ~100 ms.
const groupOrder = new Intl.Collator("zh-Hans-CN");
const CLEAN_UNREFERENCED = `DELETE FROM channels WHERE active = 0
  AND NOT EXISTS (SELECT 1 FROM favorites WHERE channelId = channels.id)
  AND NOT EXISTS (SELECT 1 FROM recents WHERE channelId = channels.id)`;

function makeId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // These are local record identifiers, not credentials or security capabilities.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const digit = Math.floor(Math.random() * 16);
    return (char === "x" ? digit : (digit & 3) | 8).toString(16);
  });
}

function channelFilter(query: ChannelQuery): {
  where: string;
  params: SqlValue[];
} {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (
    !query.includeInactive &&
    query.mode !== "favorites" &&
    query.mode !== "recent"
  )
    where.push("c.active = 1");
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
  if (query.mode === "favorites") where.push("f.channelId IS NOT NULL");
  if (query.mode === "recent") where.push("r.channelId IS NOT NULL");
  return {
    where: where.length ? ` WHERE ${where.join(" AND ")}` : "",
    params,
  };
}

function assertPreview(preview: ImportPreview): void {
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
function assertContent(content: string): void {
  if (
    content.length > M3U_LIMITS.maxBytes ||
    utf8ByteLength(content) > M3U_LIMITS.maxBytes
  )
    throw new RepositoryError("invalid_input");
}
// Playlist labels win; otherwise the iptv-org lookup (if the user ran it).
const EFFECTIVE_LANGUAGES =
  "(CASE WHEN c.languages <> '' THEN c.languages ELSE c.lookupLanguages END)";

function mapChannel(row: RawChannel): Channel {
  const { lookupLanguages, ...rest } = row;
  return {
    ...rest,
    countries: normalizeCountries(row.countries),
    languages: normalizeLanguages(row.languages || lookupLanguages),
    active: row.active === 1,
    favorite: row.favorite === 1,
  };
}

export class Repository {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly generations = new Map<string, number>();
  private readonly now: () => number;
  private readonly makeId: () => string;

  constructor(
    private readonly db: SqlDatabase,
    options: RepositoryOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.makeId = options.makeId ?? makeId;
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async initialize(): Promise<void> {
    await this.serialize(async () => {
      await this.db.execAsync(
        "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON;",
      );
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        const version = await tx.getFirstAsync<{ user_version: number }>(
          "PRAGMA user_version",
        );
        const current = version?.user_version ?? 0;
        if (current > SCHEMA_VERSION) throw new RepositoryError("newer_schema");
        if (current === SCHEMA_VERSION) return;
        if (current < 1) await this.createV1(tx);
        if (current < 2) await this.migrateV2(tx);
        if (current < 3) await this.migrateV3(tx);
        if (current < 4) await this.migrateV4(tx);
        await tx.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
      });
    });
  }

  private async createV1(tx: SqlExecutor): Promise<void> {
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
  private async migrateV2(tx: SqlExecutor): Promise<void> {
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
  private async migrateV3(tx: SqlExecutor): Promise<void> {
    await tx.execAsync(`
      ALTER TABLE channels ADD COLUMN countries TEXT NOT NULL DEFAULT '';
      ALTER TABLE channels ADD COLUMN languages TEXT NOT NULL DEFAULT '';
    `);
  }

  /**
   * v4: languages looked up in the iptv-org database live apart from playlist
   * labels, so a refresh can clear removed labels yet keep the lookup.
   */
  private async migrateV4(tx: SqlExecutor): Promise<void> {
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

  async listSources(): Promise<Source[]> {
    return this.db.getAllAsync<Source>(
      `${SOURCE_SELECT} ORDER BY s.createdAt, s.id`,
    );
  }

  async getSource(id: string): Promise<Source | null> {
    return this.db.getFirstAsync<Source>(`${SOURCE_SELECT} WHERE s.id = ?`, [
      id,
    ]);
  }

  async getSourceContent(id: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ content: string | null }>(
      "SELECT content FROM sources WHERE id = ?",
      [id],
    );
    return row?.content ?? null;
  }

  async listChannels(query: ChannelQuery = {}): Promise<Channel[]> {
    const { where, params } = channelFilter(query);
    // Channels the last check found unreachable sink to the end (recent keeps
    // pure play order); everything else keeps the playlist/favorite order.
    const order =
      query.mode === "recent"
        ? "r.lastPlayedAt DESC, c.id"
        : query.mode === "favorites"
          ? "COALESCE(c.checkStatus = 'unreachable', 0), f.createdAt DESC, c.id"
          : "COALESCE(c.checkStatus = 'unreachable', 0), s.createdAt, s.id, c.sortIndex, c.id";
    let page = "";
    if (query.limit !== undefined || query.offset) {
      page = " LIMIT ? OFFSET ?";
      params.push(query.limit ?? -1, query.offset ?? 0);
    }
    const rows = await this.db.getAllAsync<RawChannel>(
      `${CHANNEL_SELECT}${where} ORDER BY ${order}${page}`,
      params,
    );
    return rows.map(mapChannel);
  }

  /** Row count for the same filter as listChannels (paging ignored). */
  async countChannels(query: ChannelQuery = {}): Promise<number> {
    const { where, params } = channelFilter(query);
    const row = await this.db.getFirstAsync<{ total: number }>(
      `SELECT COUNT(*) AS total FROM channels c
  LEFT JOIN favorites f ON f.channelId = c.id LEFT JOIN recents r ON r.channelId = c.id${where}`,
      params,
    );
    return row?.total ?? 0;
  }

  /** One channel by id (any state), for starting playback without the catalog. */
  async getChannel(id: string): Promise<Channel | null> {
    const row = await this.db.getFirstAsync<RawChannel>(
      `${CHANNEL_SELECT} WHERE c.id = ?`,
      [id],
    );
    return row ? mapChannel(row) : null;
  }

  listFavorites(): Promise<Channel[]> {
    return this.listChannels({ mode: "favorites" });
  }
  listRecent(): Promise<Channel[]> {
    return this.listChannels({ mode: "recent" });
  }

  async listGroups(sourceId?: string): Promise<string[]> {
    const rows = await this.db.getAllAsync<{ groupName: string }>(
      `SELECT DISTINCT groupName FROM channels WHERE active = 1${sourceId ? " AND sourceId = ?" : ""}`,
      sourceId ? [sourceId] : [],
    );
    const groups = new Set(rows.flatMap((row) => splitGroups(row.groupName)));
    const ungrouped = groups.delete(UNGROUPED);
    const sorted = [...groups].sort((a, b) => groupOrder.compare(a, b));
    return ungrouped ? [...sorted, UNGROUPED] : sorted;
  }

  async listFacets(sourceId?: string): Promise<ChannelFacetOptions> {
    return buildFacetOptions(await this.listFacetRows(sourceId));
  }

  /** Distinct facet combinations of active channels, for narrowing options. */
  async listFacetRows(sourceId?: string): Promise<FacetChannel[]> {
    const rows = await this.db.getAllAsync<{
      countries: string;
      languages: string;
      groupName: string;
    }>(
      `SELECT DISTINCT countries, CASE WHEN languages <> '' THEN languages ELSE lookupLanguages END AS languages, groupName FROM channels WHERE active = 1${sourceId ? " AND sourceId = ?" : ""}`,
      sourceId ? [sourceId] : [],
    );
    return rows.map((row) => ({
      ...row,
      countries: normalizeCountries(row.countries),
      languages: normalizeLanguages(row.languages),
    }));
  }

  async importSource(input: ImportSourceInput): Promise<Source> {
    assertPreview(input.preview);
    if (!input.name.trim() || !input.location.trim())
      throw new RepositoryError("invalid_input");
    const location =
      input.kind === "url"
        ? normalizeRemoteUrl(input.location)
        : input.location;
    if (input.kind === "file") {
      if (input.content === undefined)
        throw new RepositoryError("invalid_input");
      assertContent(input.content);
    }
    return this.serialize(async () => {
      const id = this.makeId();
      const now = this.now();
      let source: Source | null = null;
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync(
          "INSERT INTO sources(id,name,kind,location,content,createdAt,lastSuccessAt,lastErrorCategory,revision) VALUES(?,?,?,?,?,?,?,NULL,1)",
          [
            id,
            input.name.trim(),
            input.kind,
            location,
            input.kind === "file" ? input.content! : null,
            now,
            now,
          ],
        );
        await this.upsertChannels(tx, id, 1, input.preview);
        source = await tx.getFirstAsync<Source>(
          `${SOURCE_SELECT} WHERE s.id = ?`,
          [id],
        );
      });
      return source!;
    });
  }

  /** Call when a refresh starts, before downloading. Only the newest token can commit. */
  async beginRefresh(sourceId: string): Promise<RefreshToken> {
    return this.serialize(async () => {
      const source = await this.getSource(sourceId);
      if (!source) throw new RepositoryError("source_missing");
      const generation = (this.generations.get(sourceId) ?? 0) + 1;
      this.generations.set(sourceId, generation);
      return { sourceId, revision: source.revision, generation };
    });
  }

  cancelRefresh(sourceId: string): void {
    this.generations.set(sourceId, (this.generations.get(sourceId) ?? 0) + 1);
  }

  async refreshSource(
    sourceId: string,
    expectedRevision: number,
    preview: ImportPreview,
    options: RefreshOptions = {},
  ): Promise<Source> {
    assertPreview(preview);
    if (options.content !== undefined) assertContent(options.content);
    return this.serialize(async () => {
      let result: Source | null = null;
      const checkGeneration = () => {
        if (
          options.generation !== undefined &&
          this.generations.get(sourceId) !== options.generation
        )
          throw new RepositoryError("stale_refresh");
      };
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        checkGeneration();
        const source = await tx.getFirstAsync<RawSource>(
          "SELECT * FROM sources WHERE id = ?",
          [sourceId],
        );
        if (!source) throw new RepositoryError("source_missing");
        if (source.revision !== expectedRevision)
          throw new RepositoryError("stale_refresh");
        const revision = source.revision + 1;
        const location =
          options.location === undefined
            ? source.location
            : source.kind === "url"
              ? normalizeRemoteUrl(options.location)
              : options.location;
        await tx.runAsync("UPDATE channels SET active = 0 WHERE sourceId = ?", [
          sourceId,
        ]);
        await this.upsertChannels(tx, sourceId, revision, preview);
        await tx.runAsync(
          "UPDATE sources SET revision = ?, lastSuccessAt = ?, lastErrorCategory = NULL, location = ?, content = ? WHERE id = ?",
          [
            revision,
            this.now(),
            location,
            source.kind === "file"
              ? (options.content ?? source.content ?? null)
              : null,
            sourceId,
          ],
        );
        await tx.runAsync(CLEAN_UNREFERENCED);
        result = await tx.getFirstAsync<Source>(
          `${SOURCE_SELECT} WHERE s.id = ?`,
          [sourceId],
        );
        checkGeneration();
      });
      return result!;
    });
  }

  private async upsertChannels(
    tx: SqlExecutor,
    sourceId: string,
    revision: number,
    preview: ImportPreview,
  ): Promise<void> {
    const existing = await tx.getAllAsync<{ id: string; identityKey: string }>(
      "SELECT id, identityKey FROM channels WHERE sourceId = ?",
      [sourceId],
    );
    const identities = new Map(
      existing.map((row) => [row.identityKey, row.id]),
    );
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
          identities.get(channel.identityKey) ?? this.makeId(),
          sourceId,
          channel.identityKey,
          channel.name,
          channel.groupName,
          channel.tvgId,
          channel.logoUrl,
          normalizeCountries(channel.countries?.join(";")).join(";"),
          normalizeLanguages(channel.languages?.join(";")).join(";"),
          channel.streamUrl,
          start + offset,
          revision,
        );
      });
      await tx.runAsync(
        `INSERT INTO channels(${CHANNEL_BOUND_COLUMNS.join(",")},active)
        VALUES${batch.map(() => `(${CHANNEL_BOUND_COLUMNS.map(() => "?").join(",")},1)`).join(",")} ON CONFLICT(sourceId, identityKey) DO UPDATE SET
        name=excluded.name,groupName=excluded.groupName,tvgId=excluded.tvgId,logoUrl=excluded.logoUrl,
        countries=excluded.countries,languages=excluded.languages,
        lookupLanguages=CASE WHEN channels.tvgId IS excluded.tvgId THEN channels.lookupLanguages ELSE '' END,
        checkStatus=CASE WHEN channels.streamUrl=excluded.streamUrl THEN channels.checkStatus END,
        checkedAt=CASE WHEN channels.streamUrl=excluded.streamUrl THEN channels.checkedAt END,
        streamUrl=excluded.streamUrl,sortIndex=excluded.sortIndex,active=1,lastSeenRevision=excluded.lastSeenRevision`,
        params,
      );
    }
  }

  /**
   * Fills languages looked up in the iptv-org database (user-triggered).
   * Stored apart from playlist labels and applied only while the channel
   * still has the tvg-id that was looked up; playlist labels still win.
   */
  async saveLookedUpLanguages(
    updates: { channelId: string; tvgId: string; languages: string[] }[],
  ): Promise<number> {
    let changed = 0;
    await this.serialize(async () => {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        for (const update of updates) {
          const value = normalizeLanguages(update.languages.join(";")).join(
            ";",
          );
          if (!value) continue;
          const result = await tx.runAsync(
            "UPDATE channels SET lookupLanguages = ? WHERE id = ? AND tvgId = ?",
            [value, update.channelId, update.tvgId],
          );
          changed += result.changes;
        }
      });
    });
    return changed;
  }

  /**
   * Stores manual availability results. A result only applies while the
   * channel still has the URL that was checked (a refresh may replace it).
   */
  async saveCheckResults(
    results: { channelId: string; streamUrl: string; ok: boolean }[],
  ): Promise<void> {
    if (!results.length) return;
    await this.serialize(async () => {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        const now = this.now();
        for (const result of results)
          await tx.runAsync(
            "UPDATE channels SET checkStatus = ?, checkedAt = ? WHERE id = ? AND streamUrl = ?",
            [
              result.ok ? "ok" : "unreachable",
              now,
              result.channelId,
              result.streamUrl,
            ],
          );
      });
    });
  }

  async renameSource(sourceId: string, name: string): Promise<void> {
    if (!name.trim()) throw new RepositoryError("invalid_input");
    await this.serialize(async () => {
      const result = await this.db.runAsync(
        "UPDATE sources SET name = ? WHERE id = ?",
        [name.trim(), sourceId],
      );
      if (!result.changes) throw new RepositoryError("source_missing");
    });
  }

  async setSourceError(
    sourceId: string,
    category: string,
    expectedRevision?: number,
  ): Promise<void> {
    // Callers provide only a category, never an exception string containing a URL.
    if (!/^[a-z_]{1,40}$/.test(category))
      throw new RepositoryError("invalid_input");
    await this.serialize(async () => {
      await this.db.runAsync(
        `UPDATE sources SET lastErrorCategory = ? WHERE id = ?${expectedRevision === undefined ? "" : " AND revision = ?"}`,
        expectedRevision === undefined
          ? [category, sourceId]
          : [category, sourceId, expectedRevision],
      );
    });
  }

  async deleteSource(sourceId: string): Promise<void> {
    this.cancelRefresh(sourceId);
    await this.serialize(async () => {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync("DELETE FROM sources WHERE id = ?", [sourceId]);
      });
    });
  }

  async toggleFavorite(channelId: string): Promise<boolean> {
    return this.serialize(async () => {
      let favorite = false;
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        const channel = await tx.getFirstAsync<{ id: string }>(
          "SELECT id FROM channels WHERE id = ?",
          [channelId],
        );
        if (!channel) throw new RepositoryError("channel_missing");
        const existing = await tx.getFirstAsync<{ channelId: string }>(
          "SELECT channelId FROM favorites WHERE channelId = ?",
          [channelId],
        );
        favorite = !existing;
        if (favorite)
          await tx.runAsync(
            "INSERT INTO favorites(channelId,createdAt) VALUES(?,?)",
            [channelId, this.now()],
          );
        else
          await tx.runAsync("DELETE FROM favorites WHERE channelId = ?", [
            channelId,
          ]);
        await tx.runAsync(CLEAN_UNREFERENCED);
      });
      return favorite;
    });
  }

  /** Call only after playback actually starts for the current session. */
  async recordRecent(channelId: string): Promise<void> {
    await this.serialize(async () => {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        const channel = await tx.getFirstAsync<{ id: string }>(
          "SELECT id FROM channels WHERE id = ? AND active = 1",
          [channelId],
        );
        if (!channel) return;
        await tx.runAsync(
          "INSERT INTO recents(channelId,lastPlayedAt) VALUES(?,?) ON CONFLICT(channelId) DO UPDATE SET lastPlayedAt=excluded.lastPlayedAt",
          [channelId, this.now()],
        );
        await tx.runAsync(
          "DELETE FROM recents WHERE channelId NOT IN (SELECT channelId FROM recents ORDER BY lastPlayedAt DESC, channelId LIMIT 100)",
        );
        await tx.runAsync(CLEAN_UNREFERENCED);
      });
    });
  }

  async removeRecent(channelId: string): Promise<void> {
    await this.serialize(async () => {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync("DELETE FROM recents WHERE channelId = ?", [
          channelId,
        ]);
        await tx.runAsync(CLEAN_UNREFERENCED);
      });
    });
  }

  async clearRecent(): Promise<void> {
    await this.serialize(async () => {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync("DELETE FROM recents");
        await tx.runAsync(CLEAN_UNREFERENCED);
      });
    });
  }

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      [key],
    );
    if (!row) return fallback;
    try {
      const value: unknown = JSON.parse(row.value);
      return typeof value === typeof fallback &&
        (value !== null || fallback === null)
        ? (value as T)
        : fallback;
    } catch {
      return fallback;
    }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    if (!json) throw new RepositoryError("invalid_input");
    await this.serialize(async () => {
      await this.db.runAsync(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [key, json],
      );
    });
  }

  async clearAll(): Promise<void> {
    for (const key of this.generations.keys()) this.cancelRefresh(key);
    await this.serialize(async () => {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync("DELETE FROM sources");
        await tx.runAsync("DELETE FROM settings");
      });
      // Best-effort truncate WAL; secure_delete erases freed cells, not guaranteed physical sanitization.
      try {
        await this.db.execAsync("PRAGMA wal_checkpoint(TRUNCATE);");
      } catch {
        // The deletion is already committed; checkpoint failure must not report it as failed.
      }
    });
  }
}

export async function createRepository(
  db: SqlDatabase,
  options: RepositoryOptions = {},
): Promise<Repository> {
  const repository = new Repository(db, options);
  await repository.initialize();
  return repository;
}

/** Minimal native API, checked structurally against the installed expo-sqlite version. */
export interface NativeSqliteConnection {
  execAsync(sql: string): Promise<void>;
  runAsync(
    sql: string,
    params: SqlValue[],
  ): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync<T>(sql: string, params: SqlValue[]): Promise<T | null>;
  getAllAsync<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  closeAsync(): Promise<void>;
}
export interface NativeSqliteProvider {
  openDatabaseAsync(
    filename: string,
    options?: { useNewConnection?: boolean },
  ): Promise<NativeSqliteConnection>;
}

/** Exported to test connection-local SQLite behavior without loading React Native. */
export async function createNativeRepository(
  SQLite: NativeSqliteProvider,
): Promise<Repository> {
  const filename = "jingkan-private.db";
  const db = await SQLite.openDatabaseAsync(filename);
  // Expo's exclusive helper creates another connection. Connection-local
  // PRAGMAs must be applied before BEGIN so foreign-key cascades remain on.
  const adapter: SqlDatabase = {
    execAsync: (sql) => db.execAsync(sql),
    runAsync: (sql, params = []) => db.runAsync(sql, params),
    getFirstAsync: (sql, params = []) => db.getFirstAsync(sql, params),
    getAllAsync: (sql, params = []) => db.getAllAsync(sql, params),
    async withExclusiveTransactionAsync(task) {
      const tx = await SQLite.openDatabaseAsync(filename, {
        useNewConnection: true,
      });
      try {
        await tx.execAsync(
          "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON; BEGIN IMMEDIATE;",
        );
        await task({
          execAsync: (sql) => tx.execAsync(sql),
          runAsync: (sql, params = []) => tx.runAsync(sql, params),
          getFirstAsync: (sql, params = []) => tx.getFirstAsync(sql, params),
          getAllAsync: (sql, params = []) => tx.getAllAsync(sql, params),
        });
        await tx.execAsync("COMMIT;");
      } catch (error) {
        try {
          await tx.execAsync("ROLLBACK;");
        } catch {
          /* Preserve the original failure. */
        }
        throw error;
      } finally {
        await tx.closeAsync();
      }
    },
  };
  try {
    return await createRepository(adapter);
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}

let repositoryPromise: Promise<Repository> | undefined;
export function openRepository(): Promise<Repository> {
  if (!repositoryPromise) {
    repositoryPromise = import("expo-sqlite")
      .then(createNativeRepository)
      .catch((error: unknown) => {
        repositoryPromise = undefined;
        throw error;
      });
  }
  return repositoryPromise;
}
