/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import {
  createRepository,
  Repository,
  type SqlDatabase,
  type SqlExecutor,
  type SqlValue,
} from "../src/data/repository";
import { parseM3U } from "../src/domain/m3u";
import type { ImportPreview, Source } from "../src/domain/types";

class TestDatabase implements SqlDatabase {
  readonly native = new DatabaseSync(":memory:");
  failWhen?: (sql: string, params: SqlValue[]) => boolean;
  async execAsync(sql: string): Promise<void> {
    this.native.exec(sql);
  }
  async runAsync(
    sql: string,
    params: SqlValue[] = [],
  ): Promise<{ changes: number; lastInsertRowId: number }> {
    if (this.failWhen?.(sql, params)) throw new Error("simulated disk failure");
    const result = this.native.prepare(sql).run(...params);
    return {
      changes: Number(result.changes),
      lastInsertRowId: Number(result.lastInsertRowid),
    };
  }
  async getFirstAsync<T>(
    sql: string,
    params: SqlValue[] = [],
  ): Promise<T | null> {
    return (this.native.prepare(sql).get(...params) as T | undefined) ?? null;
  }
  async getAllAsync<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.native.prepare(sql).all(...params) as T[];
  }
  async withExclusiveTransactionAsync(
    task: (tx: SqlExecutor) => Promise<void>,
  ): Promise<void> {
    this.native.exec("BEGIN IMMEDIATE");
    try {
      await task(this);
      this.native.exec("COMMIT");
    } catch (error) {
      this.native.exec("ROLLBACK");
      throw error;
    }
  }
}

const content = (
  items: { name: string; url: string; id?: string; group?: string }[],
) =>
  "#EXTM3U\n" +
  items
    .map(
      (c) =>
        `#EXTINF:-1 tvg-id="${c.id ?? ""}" group-title="${c.group ?? "新闻"}",${c.name}\n${c.url}`,
    )
    .join("\n");
const initialText = content([
  {
    name: "央视 新闻",
    id: "news",
    url: "https://a.example.com/live?token=old",
  },
  { name: "CCTV Sports", url: "http://a.example.com/sport", group: "体育" },
  { name: "财经 100%_频道", url: "https://a.example.com/finance" },
]);

let db: TestDatabase;
let repo: Repository;
let tick: number;
async function importInitial(): Promise<Source> {
  return repo.importSource({
    name: "测试来源",
    kind: "file",
    location: "channels.m3u",
    content: initialText,
    preview: await parseM3U(initialText),
  });
}

beforeEach(async () => {
  db = new TestDatabase();
  tick = 1700000000000;
  let seq = 0;
  repo = await createRepository(db, {
    now: () => tick++,
    makeId: () => `record-${++seq}`,
  });
});
afterEach(() => {
  db.native.close();
});

describe("SQLite repository with real SQLite", () => {
  it("migrates once, stores file source privately and reopens without data loss", async () => {
    const source = await importInitial();
    expect(source).toMatchObject({
      name: "测试来源",
      kind: "file",
      location: "channels.m3u",
      revision: 1,
      channelCount: 3,
    });
    expect(await repo.getSourceContent(source.id)).toBe(initialText);
    const [channel] = await repo.listChannels();
    await repo.toggleFavorite(channel.id);
    repo = await createRepository(db);
    expect(await repo.listFavorites()).toMatchObject([
      { id: channel.id, favorite: true },
    ]);
    expect(await db.getFirstAsync("PRAGMA user_version")).toEqual({
      user_version: 1,
    });
  });

  it("imports and filters by source, group and literal search", async () => {
    const source = await importInitial();
    expect(await repo.listGroups(source.id)).toEqual(["体育", "新闻"]);
    expect(
      await repo.listChannels({
        search: "  cctv ",
        groupName: "体育",
        sourceId: source.id,
      }),
    ).toMatchObject([{ name: "CCTV Sports" }]);
    expect(await repo.listChannels({ search: "100%_" })).toHaveLength(1);
    expect(await repo.listChannels({ search: "%" })).toHaveLength(1);
    expect(await repo.listChannels({ search: "' OR 1=1 --" })).toHaveLength(0);
  });

  it("preserves stable IDs, favorites and recents across trusted ID URL-token refresh", async () => {
    const source = await importInitial();
    const [channel] = await repo.listChannels();
    await repo.toggleFavorite(channel.id);
    await repo.recordRecent(channel.id);
    const token = await repo.beginRefresh(source.id);
    const replacement = content([
      {
        name: "更新名称",
        id: "news",
        url: "https://b.example.com/live?token=new",
      },
    ]);
    const updated = await repo.refreshSource(
      source.id,
      token.revision,
      await parseM3U(replacement),
      { generation: token.generation, content: replacement },
    );
    expect(updated).toMatchObject({
      revision: 2,
      channelCount: 1,
      favoriteCount: 1,
    });
    expect(await repo.listChannels()).toMatchObject([
      {
        id: channel.id,
        name: "更新名称",
        streamUrl: "https://b.example.com/live?token=new",
        active: true,
        favorite: true,
      },
    ]);
    expect(await repo.listRecent()).toMatchObject([{ id: channel.id }]);
    expect(await repo.getSourceContent(source.id)).toBe(replacement);
  });

  it("retains missing referenced channels as inactive and never matches by name", async () => {
    const source = await importInitial();
    const [, sport, finance] = await repo.listChannels();
    await repo.toggleFavorite(sport.id);
    await repo.recordRecent(finance.id);
    const replacement = content([
      { name: sport.name, url: "https://a.example.com/sport?newToken=true" },
    ]);
    await repo.refreshSource(
      source.id,
      source.revision,
      await parseM3U(replacement),
    );
    const channels = await repo.listChannels();
    expect(channels).toHaveLength(1);
    expect(channels[0].id).not.toBe(sport.id);
    expect(await repo.listFavorites()).toMatchObject([
      { id: sport.id, active: false },
    ]);
    expect(await repo.listRecent()).toMatchObject([
      { id: finance.id, active: false },
    ]);
    expect(await repo.listChannels({ includeInactive: true })).toHaveLength(3);
    await repo.toggleFavorite(sport.id);
    await repo.clearRecent();
    expect(await repo.listChannels({ includeInactive: true })).toHaveLength(1);
  });

  it("rolls back a mid-refresh database failure without losing old source or links", async () => {
    const source = await importInitial();
    const [channel] = await repo.listChannels();
    await repo.toggleFavorite(channel.id);
    const before = await repo.listChannels();
    const replacement = await parseM3U(
      content([
        { name: "新一", url: "https://a.example.com/new1" },
        { name: "新二", url: "https://a.example.com/new2" },
      ]),
    );
    let writes = 0;
    db.failWhen = (sql) =>
      sql.startsWith("INSERT INTO channels") && ++writes === 2;
    await expect(repo.refreshSource(source.id, 1, replacement)).rejects.toThrow(
      "simulated disk failure",
    );
    db.failWhen = undefined;
    expect(await repo.listChannels()).toEqual(before);
    expect(await repo.getSource(source.id)).toEqual(
      source === null ? null : { ...source, favoriteCount: 1 },
    );
    expect(await repo.listFavorites()).toHaveLength(1);
  });

  it("rolls back all of a failed import", async () => {
    let writes = 0;
    db.failWhen = (sql) =>
      sql.startsWith("INSERT INTO channels") && ++writes === 2;
    await expect(importInitial()).rejects.toThrow("simulated disk failure");
    db.failWhen = undefined;
    expect(await repo.listSources()).toEqual([]);
    expect(await repo.listChannels()).toEqual([]);
  });

  it("rejects empty refresh and keeps the prior revision", async () => {
    const source = await importInitial();
    const preview = await parseM3U(initialText);
    preview.channels = [];
    await expect(
      repo.refreshSource(source.id, 1, preview),
    ).rejects.toMatchObject({ code: "empty_import" });
    expect((await repo.getSource(source.id))?.revision).toBe(1);
    expect(await repo.listChannels()).toHaveLength(3);
  });

  it("rejects a stale revision and an older refresh generation", async () => {
    const source = await importInitial();
    const preview = await parseM3U(initialText);
    const first = await repo.beginRefresh(source.id);
    const second = await repo.beginRefresh(source.id);
    await expect(
      repo.refreshSource(source.id, first.revision, preview, {
        generation: first.generation,
      }),
    ).rejects.toMatchObject({ code: "stale_refresh" });
    await repo.refreshSource(source.id, second.revision, preview, {
      generation: second.generation,
    });
    await expect(
      repo.refreshSource(source.id, first.revision, preview),
    ).rejects.toMatchObject({ code: "stale_refresh" });
    expect((await repo.getSource(source.id))?.revision).toBe(2);
  });

  it("cancels refresh and prevents a deleted source from being resurrected", async () => {
    const source = await importInitial();
    const preview = await parseM3U(initialText);
    const first = await repo.beginRefresh(source.id);
    repo.cancelRefresh(source.id);
    await expect(
      repo.refreshSource(source.id, 1, preview, {
        generation: first.generation,
      }),
    ).rejects.toMatchObject({ code: "stale_refresh" });
    await repo.deleteSource(source.id);
    await expect(
      repo.refreshSource(source.id, 1, preview),
    ).rejects.toMatchObject({ code: "source_missing" });
    expect(await repo.listSources()).toEqual([]);
  });

  it("deletes all links on source removal and does not touch another source", async () => {
    const one = await importInitial();
    const two = await importInitial();
    for (const channel of await repo.listChannels()) {
      await repo.toggleFavorite(channel.id);
      await repo.recordRecent(channel.id);
    }
    await repo.deleteSource(one.id);
    expect(await repo.listSources()).toMatchObject([{ id: two.id }]);
    expect(await repo.listFavorites()).toHaveLength(3);
    expect(await repo.listRecent()).toHaveLength(3);
    expect(await db.getAllAsync("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("keeps only the 100 most recently played channels and updates in place", async () => {
    const text = content(
      Array.from({ length: 105 }, (_, i) => ({
        name: `频道 ${i}`,
        url: `https://a.example.com/${i}`,
      })),
    );
    await repo.importSource({
      name: "Many",
      kind: "url",
      location: "https://a.example.com/list",
      preview: await parseM3U(text),
    });
    const channels = await repo.listChannels();
    for (const channel of channels) await repo.recordRecent(channel.id);
    let recent = await repo.listRecent();
    expect(recent).toHaveLength(100);
    expect(recent[0].id).toBe(channels[104].id);
    expect(recent.some((c) => c.id === channels[0].id)).toBe(false);
    await repo.recordRecent(channels[5].id);
    recent = await repo.listRecent();
    expect(recent).toHaveLength(100);
    expect(recent[0].id).toBe(channels[5].id);
  });

  it("renames sources, safely stores settings and clears all private app data", async () => {
    const source = await importInitial();
    await repo.renameSource(source.id, " 我的频道 ");
    expect((await repo.listChannels())[0].sourceName).toBe("我的频道");
    expect(await repo.getSetting("trustedRemoteAllowed", false)).toBe(false);
    await repo.setSetting("trustedRemoteAllowed", true);
    expect(await repo.getSetting("trustedRemoteAllowed", false)).toBe(true);
    await repo.setSourceError(source.id, "timeout", 1);
    expect((await repo.getSource(source.id))?.lastErrorCategory).toBe(
      "timeout",
    );
    await expect(
      repo.setSourceError(source.id, "https://a.example.com?token=secret"),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await repo.clearAll();
    expect(await repo.listSources()).toEqual([]);
    expect(await repo.listChannels({ includeInactive: true })).toEqual([]);
    expect(await repo.getSourceContent(source.id)).toBeNull();
    expect(await repo.getSetting("trustedRemoteAllowed", false)).toBe(false);
  });

  it("does not rewrite a database newer than this app", async () => {
    await db.execAsync("PRAGMA user_version = 2");
    await expect(createRepository(db)).rejects.toMatchObject({
      code: "newer_schema",
    });
    expect(await db.getFirstAsync("PRAGMA user_version")).toEqual({
      user_version: 2,
    });
  });

  it("serializes simultaneous writes without duplicate favorites", async () => {
    await importInitial();
    const [channel] = await repo.listChannels();
    expect(
      await Promise.all([
        repo.toggleFavorite(channel.id),
        repo.toggleFavorite(channel.id),
      ]),
    ).toEqual([true, false]);
    expect(await repo.listFavorites()).toEqual([]);
  });

  it("rejects invalid preview duplicate identities before touching storage", async () => {
    const preview = await parseM3U(initialText);
    const duplicate: ImportPreview = {
      ...preview,
      channels: [preview.channels[0], preview.channels[0]],
    };
    await expect(
      repo.importSource({
        name: "Invalid",
        kind: "url",
        location: "https://a.example.com/list",
        preview: duplicate,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await repo.listSources()).toEqual([]);
  });
});
