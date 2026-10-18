import type {
  Channel,
  ChannelQuery,
  ImportPreview,
  ImportSourceInput,
  RefreshToken,
  Source,
} from "../domain/types";
import { normalizeRemoteUrl } from "../domain/url";
import { parseBackup, readBackup, writeBackup } from "./backup";
import {
  buildFacetOptions,
  normalizeLanguages,
  type ChannelFacetOptions,
  type FacetChannel,
} from "../domain/channelFacets";
import { RepositoryError, type SqlDatabase } from "./sql";
import { migrateSchema } from "./schema";
import {
  assertContent,
  assertPreview,
  CHANNEL_SELECT,
  cleanUnreferenced,
  mapChannel,
  mapSource,
  SOURCE_SELECT,
  upsertChannels,
  type RawChannel,
  type RawSource,
} from "./channelSql";
import {
  countChannelRows,
  queryChannels,
  queryChannelSources,
  queryFacetRows,
  queryGroups,
} from "./channelReads";

export interface RefreshOptions {
  content?: string;
  location?: string;
  generation?: number;
}
export interface RepositoryOptions {
  now?: () => number;
  makeId?: () => string;
}

function makeId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // These are local record identifiers, not credentials or security capabilities.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const digit = Math.floor(Math.random() * 16);
    return (char === "x" ? digit : (digit & 3) | 8).toString(16);
  });
}

/**
 * The only persistent store. Writes run one at a time; imports, refreshes
 * and every multi-row change are single transactions.
 */
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
      await this.db.withExclusiveTransactionAsync(migrateSchema);
    });
  }

  async listSources(): Promise<Source[]> {
    const rows = await this.db.getAllAsync<RawSource>(
      `${SOURCE_SELECT} ORDER BY s.createdAt, s.id`,
    );
    return rows.map(mapSource);
  }

  async getSource(id: string): Promise<Source | null> {
    const row = await this.db.getFirstAsync<RawSource>(
      `${SOURCE_SELECT} WHERE s.id = ?`,
      [id],
    );
    return row ? mapSource(row) : null;
  }

  async getSourceContent(id: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ content: string | null }>(
      "SELECT content FROM sources WHERE id = ?",
      [id],
    );
    return row?.content ?? null;
  }

  listChannels(query: ChannelQuery = {}): Promise<Channel[]> {
    return queryChannels(this.db, query);
  }

  /** Row count for the same filter as listChannels (paging ignored). */
  countChannels(query: ChannelQuery = {}): Promise<number> {
    return countChannelRows(this.db, query);
  }

  /** One channel by id (any state), for starting playback without the catalog. */
  async getChannel(id: string): Promise<Channel | null> {
    const row = await this.db.getFirstAsync<RawChannel>(
      `${CHANNEL_SELECT} WHERE c.id = ?`,
      [id],
    );
    return row ? mapChannel(row) : null;
  }

  /** Active alternatives: last played, then unlabelled main, then low-to-high. */
  listChannelSources(groupKey: string): Promise<Channel[]> {
    return queryChannelSources(this.db, groupKey);
  }

  listFavorites(): Promise<Channel[]> {
    return this.listChannels({ mode: "favorites" });
  }
  listRecent(): Promise<Channel[]> {
    return this.listChannels({ mode: "recent" });
  }

  listGroups(sourceId?: string): Promise<string[]> {
    return queryGroups(this.db, sourceId);
  }

  async listFacets(sourceId?: string): Promise<ChannelFacetOptions> {
    return buildFacetOptions(await this.listFacetRows(sourceId));
  }

  /** Distinct facet combinations of active channels, for narrowing options. */
  listFacetRows(sourceId?: string): Promise<FacetChannel[]> {
    return queryFacetRows(this.db, sourceId);
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
        await upsertChannels(tx, id, 1, input.preview, this.makeId);
        const row = await tx.getFirstAsync<RawSource>(
          `${SOURCE_SELECT} WHERE s.id = ?`,
          [id],
        );
        source = row ? mapSource(row) : null;
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
        await upsertChannels(tx, sourceId, revision, preview, this.makeId);
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
        await cleanUnreferenced(tx);
        const row = await tx.getFirstAsync<RawSource>(
          `${SOURCE_SELECT} WHERE s.id = ?`,
          [sourceId],
        );
        result = row ? mapSource(row) : null;
        checkGeneration();
      });
      return result!;
    });
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

  async setSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
    if (!enabled) this.cancelRefresh(sourceId);
    await this.serialize(async () => {
      const result = await this.db.runAsync(
        "UPDATE sources SET enabled = ? WHERE id = ?",
        [enabled ? 1 : 0, sourceId],
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
        await cleanUnreferenced(tx);
      });
    });
  }

  async toggleFavorite(channelId: string): Promise<boolean> {
    return this.serialize(async () => {
      let favorite = false;
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        const channel = await tx.getFirstAsync<{
          id: string;
          groupKey: string;
        }>("SELECT id, groupKey FROM channels WHERE id = ?", [channelId]);
        if (!channel) throw new RepositoryError("channel_missing");
        const existing = await tx.getFirstAsync<{ groupKey: string }>(
          "SELECT groupKey FROM favorite_groups WHERE groupKey = ?",
          [channel.groupKey],
        );
        favorite = !existing;
        if (favorite) {
          const active = await tx.getFirstAsync<{ id: string }>(
            `SELECT c.id FROM channels c JOIN sources s ON s.id = c.sourceId
             WHERE c.groupKey = ? AND c.active = 1 AND s.enabled = 1 LIMIT 1`,
            [channel.groupKey],
          );
          if (!active) throw new RepositoryError("channel_missing");
          await tx.runAsync(
            "INSERT INTO favorite_groups(groupKey,createdAt) VALUES(?,?)",
            [channel.groupKey, this.now()],
          );
        } else
          await tx.runAsync("DELETE FROM favorite_groups WHERE groupKey = ?", [
            channel.groupKey,
          ]);
        await cleanUnreferenced(tx);
      });
      return favorite;
    });
  }

  /** Call only after playback actually starts for the current session. */
  async recordRecent(channelId: string): Promise<void> {
    await this.serialize(async () => {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
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
          [channel.groupKey, channel.id, this.now()],
        );
        await tx.runAsync(
          `DELETE FROM recent_groups WHERE groupKey NOT IN (
             SELECT groupKey FROM recent_groups
             ORDER BY lastPlayedAt DESC, groupKey LIMIT 100
           )`,
        );
        await cleanUnreferenced(tx);
      });
    });
  }

  async removeRecent(channelId: string): Promise<void> {
    await this.serialize(async () => {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync(
          `DELETE FROM recent_groups WHERE groupKey = (
             SELECT groupKey FROM channels WHERE id = ?
           )`,
          [channelId],
        );
        await cleanUnreferenced(tx);
      });
    });
  }

  async clearRecent(): Promise<void> {
    await this.serialize(async () => {
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync("DELETE FROM recent_groups");
        await cleanUnreferenced(tx);
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
        await tx.runAsync("DELETE FROM favorite_groups");
        await tx.runAsync("DELETE FROM recent_groups");
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

  /** Consistent offline snapshot, excluding viewing history and permissions. */
  exportBackup(): Promise<string> {
    return this.serialize(async () => {
      let text = "";
      await this.db.withExclusiveTransactionAsync(async (tx) => {
        text = JSON.stringify(await readBackup(tx, this.now()));
        parseBackup(text);
      });
      return text;
    });
  }

  async restoreBackup(text: string): Promise<void> {
    const backup = parseBackup(text);
    for (const key of this.generations.keys()) this.cancelRefresh(key);
    return this.serialize(() =>
      this.db.withExclusiveTransactionAsync((tx) => writeBackup(tx, backup)),
    );
  }
}
