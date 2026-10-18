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
import { UNGROUPED } from "../src/domain/channelLabels";

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
  items: {
    name: string;
    url: string;
    id?: string;
    group?: string;
    country?: string;
    language?: string;
  }[],
) =>
  "#EXTM3U\n" +
  items
    .map(
      (c) =>
        `#EXTINF:-1 tvg-id="${c.id ?? ""}" group-title="${c.group ?? "新闻"}" tvg-country="${c.country ?? ""}" tvg-language="${c.language ?? ""}",${c.name}\n${c.url}`,
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
  it("collapses reliable duplicate channels to the lowest declared quality and retains every source", async () => {
    const playlist = content([
      {
        name: "CCTV-1 高清",
        id: "CCTV1.cn@HD",
        url: "https://a.example.com/hd",
      },
      {
        name: "CCTV-1 标清",
        id: "CCTV1.cn@SD",
        url: "https://a.example.com/sd",
      },
    ]);
    const source = await repo.importSource({
      name: "主列表",
      kind: "file",
      location: "one.m3u",
      content: playlist,
      preview: await parseM3U(playlist),
    });
    const shown = await repo.listChannels();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      sourceId: source.id,
      qualityLabel: "标清",
      qualityRank: 576,
    });
    expect(await repo.countChannels()).toBe(1);
    const alternatives = await repo.listChannelSources(shown[0].groupKey!);
    expect(alternatives.map((item) => item.qualityLabel)).toEqual([
      "标清",
      "高清",
    ]);
    expect(shown[0]).not.toHaveProperty("groupRow");
    expect(shown[0]).not.toHaveProperty("favoriteCreatedAt");
    expect(shown[0]).not.toHaveProperty("sourceCreatedAt");
  });

  it("keeps inactive variants out of favorites and falls back to an active source", async () => {
    const first = content([
      {
        name: "CCTV-1 标清",
        id: "CCTV1.cn@SD",
        url: "https://a.example.com/sd",
      },
      {
        name: "CCTV-1 高清",
        id: "CCTV1.cn@HD",
        url: "https://a.example.com/hd",
      },
    ]);
    const source = await repo.importSource({
      name: "主列表",
      kind: "file",
      location: "one.m3u",
      content: first,
      preview: await parseM3U(first),
    });
    const [sd] = await repo.listChannels();
    await repo.toggleFavorite(sd.id);
    const second = content([
      {
        name: "CCTV-1 高清",
        id: "CCTV1.cn@HD",
        url: "https://a.example.com/hd",
      },
    ]);
    await repo.refreshSource(source.id, source.revision, await parseM3U(second));

    expect(await repo.listFavorites()).toMatchObject([
      { active: true, qualityLabel: "高清" },
    ]);
    expect(await repo.listChannelSources(sd.groupKey!)).toMatchObject([
      { active: true, qualityLabel: "高清" },
    ]);
  });

  it("remembers the played source and otherwise prefers an unlabelled main source", async () => {
    const playlist = content([
      {
        name: "CCTV-1 标清",
        id: "CCTV1.cn@SD",
        url: "https://a.example.com/sd",
      },
      {
        name: "CCTV-1 主源",
        id: "CCTV1.cn",
        url: "https://a.example.com/main",
      },
      {
        name: "CCTV-1 高清",
        id: "CCTV1.cn@HD",
        url: "https://a.example.com/hd",
      },
    ]);
    await repo.importSource({
      name: "主列表",
      kind: "file",
      location: "one.m3u",
      content: playlist,
      preview: await parseM3U(playlist),
    });
    const [shown] = await repo.listChannels();
    expect(shown.qualityLabel).toBe("标清");
    let alternatives = await repo.listChannelSources(shown.groupKey!);
    expect(alternatives.map((item) => item.name)).toEqual([
      "CCTV-1 主源",
      "CCTV-1 标清",
      "CCTV-1 高清",
    ]);

    const hd = alternatives.find((item) => item.qualityLabel === "高清")!;
    await repo.recordRecent(hd.id);
    expect(await repo.listRecent()).toMatchObject([{ id: hd.id }]);
    alternatives = await repo.listChannelSources(shown.groupKey!);
    expect(alternatives[0].id).toBe(hd.id);
  });

  it("does not add a favorite through an inactive group with no playable row", async () => {
    const source = await importInitial();
    const [channel] = await repo.listChannels();
    await repo.refreshSource(
      source.id,
      source.revision,
      await parseM3U(
        content([{ name: "其他", id: "other", url: "https://a.example.com/other" }]),
      ),
    );
    await expect(repo.toggleFavorite(channel.id)).rejects.toMatchObject({
      code: "channel_missing",
    });
    expect(await repo.listFavorites()).toEqual([]);
  });

  it("batches large imports across statement boundaries and keeps order and IDs on refresh", async () => {
    const run = jest.spyOn(db, "runAsync");
    const many = (prefix: string) =>
      content(
        Array.from({ length: 250 }, (_, i) => ({
          name: `${prefix}${i}`,
          id: `ch${i}`,
          url: `https://a.example.com/${prefix}${i}`,
          country: "CN;US",
          language: "zh;en",
        })),
      );
    const first = many("旧");
    const source = await repo.importSource({
      name: "大列表",
      kind: "file",
      location: "big.m3u",
      content: first,
      preview: await parseM3U(first),
    });
    const before = await repo.listChannels();
    expect(before).toHaveLength(250);
    expect(before.map((c) => c.sortIndex)).toEqual(
      Array.from({ length: 250 }, (_, i) => i),
    );
    const token = await repo.beginRefresh(source.id);
    const second = many("新");
    await repo.refreshSource(
      source.id,
      token.revision,
      await parseM3U(second),
      {
        generation: token.generation,
        content: second,
      },
    );
    const after = await repo.listChannels();
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
    expect(after[249]).toMatchObject({ name: "新249", sortIndex: 249 });
    expect(after[249]).toMatchObject({
      countries: ["CN", "US"],
      languages: ["zh", "en"],
    });
    const inserts = run.mock.calls.filter(([sql]) =>
      sql.startsWith("INSERT INTO channels"),
    );
    expect(inserts.length).toBeGreaterThan(2);
    expect(inserts.every(([, params]) => (params?.length ?? 0) <= 900)).toBe(
      true,
    );
  });

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
      user_version: 6,
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

  it("pages a list in the same order as the full read and counts the same filter", async () => {
    const many = content(
      Array.from({ length: 25 }, (_, i) => ({
        name: `台${i}`,
        id: `p${i}`,
        url: `https://a.example.com/p${i}`,
        group: i % 2 ? "体育" : "新闻",
      })),
    );
    await repo.importSource({
      name: "分页",
      kind: "file",
      location: "page.m3u",
      content: many,
      preview: await parseM3U(many),
    });
    const full = await repo.listChannels();
    const first = await repo.listChannels({ limit: 10 });
    const rest = await repo.listChannels({ offset: 10 });
    expect([...first, ...rest].map((c) => c.id)).toEqual(full.map((c) => c.id));
    expect(await repo.countChannels()).toBe(25);
    const sports = { groupName: "体育", search: "台1" };
    const sportsRows = await repo.listChannels(sports);
    expect(sportsRows.length).toBeGreaterThan(0);
    expect(await repo.countChannels(sports)).toBe(sportsRows.length);
    expect(await repo.listChannels({ ...sports, limit: 2 })).toEqual(
      sportsRows.slice(0, 2),
    );
    await repo.toggleFavorite(full[3].id);
    expect(await repo.countChannels({ mode: "favorites" })).toBe(1);
    expect(await repo.listChannels({ mode: "favorites", offset: 1 })).toEqual(
      [],
    );
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
    expect(await repo.listFavorites()).toEqual([]);
    expect(
      await repo.listChannels({ mode: "favorites", includeInactive: true }),
    ).toMatchObject([
      { id: sport.id, active: false },
    ]);
    expect(await repo.listRecent()).toEqual([]);
    expect(
      await repo.listChannels({ mode: "recent", includeInactive: true }),
    ).toMatchObject([
      { id: finance.id, active: false },
    ]);
    expect(await repo.listChannels({ includeInactive: true })).toHaveLength(3);
    await repo.toggleFavorite(sport.id);
    await repo.clearRecent();
    expect(await repo.listChannels({ includeInactive: true })).toHaveLength(1);
  });

  it("keeps channel identity and links when an exact playlist duplicate appears and disappears", async () => {
    const source = await importInitial();
    const [channel] = await repo.listChannels();
    await repo.toggleFavorite(channel.id);
    await repo.recordRecent(channel.id);
    const entry = {
      name: channel.name,
      id: "news",
      url: channel.streamUrl,
    };
    let revision = source.revision;
    for (const entries of [[entry, entry], [entry]]) {
      const replacement = content(entries);
      const updated = await repo.refreshSource(
        source.id,
        revision,
        await parseM3U(replacement),
        { content: replacement },
      );
      revision = updated.revision;
      expect(updated).toMatchObject({ channelCount: 1, favoriteCount: 1 });
      expect(await repo.listChannels({ includeInactive: true })).toEqual([
        expect.objectContaining({
          id: channel.id,
          identityKey: "id:news",
          favorite: true,
          active: true,
        }),
      ]);
      expect(await repo.listFavorites()).toMatchObject([
        { id: channel.id, active: true },
      ]);
      expect(await repo.listRecent()).toMatchObject([
        { id: channel.id, active: true },
      ]);
    }
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
      // Channels are inserted in batches; fail the first batch, after earlier
      // writes in the same transaction have already happened.
      sql.startsWith("INSERT INTO channels") && ++writes === 1;
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
      // Channels are inserted in batches; fail the first batch, after earlier
      // writes in the same transaction have already happened.
      sql.startsWith("INSERT INTO channels") && ++writes === 1;
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

  it("removes one recent without changing the remaining order, active channels or favorites", async () => {
    await importInitial();
    const channels = await repo.listChannels();
    for (const channel of channels) await repo.recordRecent(channel.id);
    await repo.toggleFavorite(channels[1].id);

    await repo.removeRecent(channels[1].id);

    expect((await repo.listRecent()).map((channel) => channel.id)).toEqual([
      channels[2].id,
      channels[0].id,
    ]);
    expect(await repo.listChannels()).toHaveLength(3);
    expect(await repo.listFavorites()).toMatchObject([
      { id: channels[1].id, active: true },
    ]);
    await expect(repo.removeRecent(channels[1].id)).resolves.toBeUndefined();
    await expect(repo.removeRecent("missing-channel")).resolves.toBeUndefined();
    expect((await repo.listRecent()).map((channel) => channel.id)).toEqual([
      channels[2].id,
      channels[0].id,
    ]);
  });

  it("cleans an inactive channel after its recent is removed and preserves an inactive favorite", async () => {
    const source = await importInitial();
    const [news, sport, finance] = await repo.listChannels();
    await repo.toggleFavorite(sport.id);
    await repo.recordRecent(sport.id);
    await repo.recordRecent(finance.id);
    const replacement = content([
      { name: news.name, id: "news", url: news.streamUrl },
    ]);
    await repo.refreshSource(
      source.id,
      source.revision,
      await parseM3U(replacement),
    );

    await repo.removeRecent(finance.id);

    expect(
      (await repo.listChannels({ includeInactive: true })).map(
        (channel) => channel.id,
      ),
    ).toEqual(expect.arrayContaining([news.id, sport.id]));
    expect(await repo.listChannels({ includeInactive: true })).toHaveLength(2);
    await repo.removeRecent(sport.id);
    expect(await repo.listRecent()).toEqual([]);
    expect(await repo.listFavorites()).toEqual([]);
    expect(
      await repo.listChannels({ mode: "favorites", includeInactive: true }),
    ).toMatchObject([
      { id: sport.id, active: false },
    ]);
    expect(await repo.listChannels({ includeInactive: true })).toHaveLength(2);
    expect(await db.getAllAsync("PRAGMA foreign_key_check")).toEqual([]);
  });

  it.each(["DELETE FROM recent_groups WHERE", "DELETE FROM channels WHERE"])(
    "rolls back a single recent removal when %s fails",
    async (statement) => {
      const source = await importInitial();
      const [news, sport] = await repo.listChannels();
      await repo.recordRecent(news.id);
      await repo.recordRecent(sport.id);
      const replacement = content([
        { name: news.name, id: "news", url: news.streamUrl },
      ]);
      await repo.refreshSource(
        source.id,
        source.revision,
        await parseM3U(replacement),
      );
      const before = await repo.listRecent();
      db.failWhen = (sql) => sql.startsWith(statement);

      await expect(repo.removeRecent(sport.id)).rejects.toThrow(
        "simulated disk failure",
      );

      expect(await repo.listRecent()).toEqual(before);
      expect(await repo.listChannels({ includeInactive: true })).toHaveLength(
        2,
      );
      db.failWhen = undefined;
      await repo.removeRecent(sport.id);
      expect(await repo.listRecent()).toMatchObject([{ id: news.id }]);
      expect(await repo.listChannels({ includeInactive: true })).toHaveLength(
        1,
      );
    },
  );

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
    await db.execAsync("PRAGMA user_version = 7");
    await expect(createRepository(db)).rejects.toMatchObject({
      code: "newer_schema",
    });
    expect(await db.getFirstAsync("PRAGMA user_version")).toEqual({
      user_version: 7,
    });
  });

  it("migrates a v1 database: translates/splits groups and adds check columns without losing favorites", async () => {
    const legacy = new TestDatabase();
    legacy.native.exec(`
      CREATE TABLE sources (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
        location TEXT NOT NULL, content TEXT, createdAt INTEGER NOT NULL, lastSuccessAt INTEGER NOT NULL,
        lastErrorCategory TEXT, revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL, sourceId TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        identityKey TEXT NOT NULL, name TEXT NOT NULL, groupName TEXT NOT NULL, tvgId TEXT, logoUrl TEXT,
        streamUrl TEXT NOT NULL, sortIndex INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        lastSeenRevision INTEGER NOT NULL, UNIQUE(sourceId, identityKey));
      CREATE TABLE favorites (channelId TEXT PRIMARY KEY NOT NULL REFERENCES channels(id) ON DELETE CASCADE, createdAt INTEGER NOT NULL);
      CREATE TABLE recents (channelId TEXT PRIMARY KEY NOT NULL REFERENCES channels(id) ON DELETE CASCADE, lastPlayedAt INTEGER NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      INSERT INTO sources VALUES ('s','旧来源','url','https://a.example.com/l.m3u',NULL,1,1,NULL,1);
      INSERT INTO channels VALUES ('c1','s','url:1','纪实','Culture;Documentary;Travel',NULL,NULL,'https://a.example.com/1',0,1,1);
      INSERT INTO channels VALUES ('c2','s','url:2','杂项','Undefined',NULL,NULL,'https://a.example.com/2',1,1,1);
      INSERT INTO favorites VALUES ('c1', 5);
      PRAGMA user_version = 1;
    `);
    const migrated = await createRepository(legacy);
    expect(await legacy.getFirstAsync("PRAGMA user_version")).toEqual({
      user_version: 6,
    });
    expect(await migrated.listGroups()).toEqual(
      ["纪录片", "旅游", "文化", UNGROUPED].sort((a, b) =>
        a === UNGROUPED
          ? 1
          : b === UNGROUPED
            ? -1
            : a.localeCompare(b, "zh-Hans-CN"),
      ),
    );
    expect(await migrated.listChannels({ groupName: "纪录片" })).toMatchObject([
      {
        id: "c1",
        groupName: "文化;纪录片;旅游",
        favorite: true,
        checkStatus: null,
      },
    ]);
    legacy.native.close();
  });

  it("migrates v5 group state and preserves the last selected stream", async () => {
    const legacy = new TestDatabase();
    legacy.native.exec(`
      CREATE TABLE sources (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
        location TEXT NOT NULL, content TEXT, createdAt INTEGER NOT NULL, lastSuccessAt INTEGER NOT NULL,
        lastErrorCategory TEXT, revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL, sourceId TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        identityKey TEXT NOT NULL, name TEXT NOT NULL, groupName TEXT NOT NULL, tvgId TEXT, logoUrl TEXT,
        streamUrl TEXT NOT NULL, sortIndex INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        lastSeenRevision INTEGER NOT NULL, checkStatus TEXT, checkedAt INTEGER,
        countries TEXT NOT NULL DEFAULT '', languages TEXT NOT NULL DEFAULT '', lookupLanguages TEXT NOT NULL DEFAULT '',
        groupKey TEXT NOT NULL DEFAULT '', qualityLabel TEXT, qualityRank INTEGER,
        UNIQUE(sourceId, identityKey));
      CREATE TABLE favorites (channelId TEXT PRIMARY KEY NOT NULL REFERENCES channels(id) ON DELETE CASCADE, createdAt INTEGER NOT NULL);
      CREATE TABLE recents (channelId TEXT PRIMARY KEY NOT NULL REFERENCES channels(id) ON DELETE CASCADE, lastPlayedAt INTEGER NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      INSERT INTO sources VALUES ('s','旧来源','url','https://a.example.com/list',NULL,1,1,NULL,1);
      INSERT INTO channels VALUES ('sd','s','id:CCTV1.cn@SD','标清','新闻','CCTV1.cn@SD',NULL,'https://a.example.com/sd',0,1,1,NULL,NULL,'CN','','','iptv:cctv1.cn','标清',576);
      INSERT INTO channels VALUES ('hd','s','id:CCTV1.cn@HD','高清','新闻','CCTV1.cn@HD',NULL,'https://a.example.com/hd',1,1,1,NULL,NULL,'CN','','','iptv:cctv1.cn','高清',720);
      INSERT INTO favorites VALUES ('sd',5);
      INSERT INTO recents VALUES ('hd',6);
      PRAGMA user_version = 5;
    `);
    try {
      const migrated = await createRepository(legacy);
      expect(await migrated.listFavorites()).toMatchObject([
        { id: "sd", favorite: true },
      ]);
      expect(await migrated.listRecent()).toMatchObject([
        { id: "hd", lastPlayedAt: 6 },
      ]);
      expect((await migrated.listChannelSources("iptv:cctv1.cn"))[0].id).toBe(
        "hd",
      );
      expect(await legacy.getFirstAsync("PRAGMA user_version")).toEqual({
        user_version: 6,
      });
    } finally {
      legacy.native.close();
    }
  });

  it("can finish v5 when its columns already exist but user_version still says v4", async () => {
    const legacy = new TestDatabase();
    legacy.native.exec(`
      CREATE TABLE sources (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
        location TEXT NOT NULL, content TEXT, createdAt INTEGER NOT NULL, lastSuccessAt INTEGER NOT NULL,
        lastErrorCategory TEXT, revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL, sourceId TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        identityKey TEXT NOT NULL, name TEXT NOT NULL, groupName TEXT NOT NULL, tvgId TEXT, logoUrl TEXT,
        streamUrl TEXT NOT NULL, sortIndex INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        lastSeenRevision INTEGER NOT NULL, checkStatus TEXT, checkedAt INTEGER,
        countries TEXT NOT NULL DEFAULT '', languages TEXT NOT NULL DEFAULT '', lookupLanguages TEXT NOT NULL DEFAULT '',
        groupKey TEXT NOT NULL DEFAULT '', qualityLabel TEXT, qualityRank INTEGER,
        UNIQUE(sourceId, identityKey));
      CREATE TABLE favorites (channelId TEXT PRIMARY KEY NOT NULL REFERENCES channels(id) ON DELETE CASCADE, createdAt INTEGER NOT NULL);
      CREATE TABLE recents (channelId TEXT PRIMARY KEY NOT NULL REFERENCES channels(id) ON DELETE CASCADE, lastPlayedAt INTEGER NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      PRAGMA user_version = 4;
    `);
    try {
      await expect(createRepository(legacy)).resolves.toBeInstanceOf(Repository);
      expect(await legacy.getFirstAsync("PRAGMA user_version")).toEqual({
        user_version: 6,
      });
    } finally {
      legacy.native.close();
    }
  });

  it("filters by one member of a multi-group channel and treats wildcards literally", async () => {
    const text = content([
      { name: "甲", url: "https://a.example.com/a", group: "News;Kids" },
      { name: "乙", url: "https://a.example.com/b", group: "Kids" },
      { name: "丙", url: "https://a.example.com/c", group: "100%_x" },
    ]);
    await repo.importSource({
      name: "多分组",
      kind: "file",
      location: "g.m3u",
      content: text,
      preview: await parseM3U(text),
    });
    expect(
      (await repo.listChannels({ groupName: "少儿" })).map((c) => c.name),
    ).toEqual(["甲", "乙"]);
    expect(
      (await repo.listChannels({ groupName: "新闻" })).map((c) => c.name),
    ).toEqual(["甲"]);
    expect(
      (await repo.listChannels({ groupName: "100%_x" })).map((c) => c.name),
    ).toEqual(["丙"]);
    expect(await repo.listChannels({ groupName: "100" })).toEqual([]);
  });

  it("combines source/country/language/content/search and preserves whole-token filters", async () => {
    const text = content([
      {
        name: "双语新闻",
        url: "https://a.example.com/1",
        country: "CN;US",
        language: "zh;en",
        group: "News;Kids",
      },
      {
        name: "美国新闻",
        url: "https://a.example.com/2",
        country: "US",
        language: "en-US",
        group: "News",
      },
      { name: "未标注", url: "https://a.example.com/3", group: "" },
    ]);
    const source = await repo.importSource({
      name: "维度",
      kind: "url",
      location: "https://a.example.com/list",
      preview: await parseM3U(text),
    });
    const other = await repo.importSource({
      name: "其他",
      kind: "file",
      location: "other.m3u",
      content: text,
      preview: await parseM3U(text),
    });
    expect(
      await repo.listChannels({
        sourceId: source.id,
        country: "US",
        language: "en",
        groupName: "少儿",
        search: "新闻",
      }),
    ).toMatchObject([{ name: "双语新闻" }]);
    expect(
      await repo.listChannels({
        sourceId: source.id,
        country: "US",
        language: "en",
      }),
    ).toHaveLength(1);
    expect(
      await repo.listChannels({ sourceId: source.id, country: "U" }),
    ).toEqual([]);
    expect(
      await repo.listChannels({ sourceId: source.id, language: "en-US" }),
    ).toMatchObject([{ name: "美国新闻" }]);
    expect(
      await repo.listChannels({
        sourceId: source.id,
        country: "",
        language: "",
        groupName: "",
      }),
    ).toMatchObject([{ name: "未标注", countries: [], languages: [] }]);
    // Paging and counts must retain every facet predicate, including unmarked.
    for (const filters of [
      {
        sourceId: source.id,
        country: "US",
        language: "en",
        groupName: "少儿",
        search: "新闻",
      },
      { sourceId: source.id, country: "", language: "", groupName: "" },
      { country: "CN" },
    ]) {
      const matches = await repo.listChannels(filters);
      expect(await repo.countChannels(filters)).toBe(matches.length);
      expect(await repo.listChannels({ ...filters, limit: 1 })).toEqual(
        matches.slice(0, 1),
      );
      expect(await repo.listChannels({ ...filters, offset: 1 })).toEqual(
        matches.slice(1),
      );
    }
    for (const escaped of ["%", "_", "' OR 1=1 --", "US;CN", "en\\"]) {
      expect(await repo.listChannels({ country: escaped })).toEqual([]);
      expect(await repo.listChannels({ language: escaped })).toEqual([]);
    }
    const facets = await repo.listFacets(source.id);
    expect(facets.countries).toEqual(expect.arrayContaining(["CN", "US", ""]));
    expect(facets.languages).toEqual(
      expect.arrayContaining(["zh", "en", "en-US", ""]),
    );
    expect(facets.contents).toEqual(
      expect.arrayContaining(["新闻", "少儿", ""]),
    );
    expect(await repo.listFacets("missing-source")).toEqual({
      countries: [],
      languages: [],
      contents: [],
    });
    const token = await repo.beginRefresh(source.id);
    await repo.refreshSource(
      source.id,
      token.revision,
      await parseM3U(
        content([
          {
            name: "日本",
            id: "jp",
            url: "https://a.example.com/jp",
            country: "JP",
            language: "ja",
          },
        ]),
      ),
    );
    expect((await repo.listFacets(source.id)).countries).toEqual(["JP"]);
    expect((await repo.listFacets(other.id)).countries).toEqual(
      facets.countries,
    );
    expect((await repo.listFacets()).countries).toEqual(
      expect.arrayContaining(["CN", "US", "JP", ""]),
    );
  });

  it("migrates v2 without guessing metadata or changing IDs, favorites, recents or checks", async () => {
    const legacy = new TestDatabase();
    legacy.native.exec(`
      CREATE TABLE sources (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
        location TEXT NOT NULL, content TEXT, createdAt INTEGER NOT NULL, lastSuccessAt INTEGER NOT NULL,
        lastErrorCategory TEXT, revision INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE channels (id TEXT PRIMARY KEY NOT NULL, sourceId TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        identityKey TEXT NOT NULL, name TEXT NOT NULL, groupName TEXT NOT NULL, tvgId TEXT, logoUrl TEXT,
        streamUrl TEXT NOT NULL, sortIndex INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
        lastSeenRevision INTEGER NOT NULL, checkStatus TEXT, checkedAt INTEGER, UNIQUE(sourceId, identityKey));
      CREATE TABLE favorites (channelId TEXT PRIMARY KEY NOT NULL REFERENCES channels(id) ON DELETE CASCADE, createdAt INTEGER NOT NULL);
      CREATE TABLE recents (channelId TEXT PRIMARY KEY NOT NULL REFERENCES channels(id) ON DELETE CASCADE, lastPlayedAt INTEGER NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      INSERT INTO sources VALUES ('legacy-source','旧来源','url','https://a.example.com/list',NULL,1,1,NULL,1);
      INSERT INTO channels VALUES ('legacy-channel','legacy-source','id:news','美国中文频道','新闻','news',NULL,'https://a.example.com/1',0,1,1,'ok',10);
      INSERT INTO favorites VALUES ('legacy-channel',5);
      INSERT INTO recents VALUES ('legacy-channel',6);
      PRAGMA user_version = 2;
    `);
    try {
      const migrated = await createRepository(legacy);
      const before = await migrated.getChannel("legacy-channel");
      expect(before).toMatchObject({
        countries: [],
        languages: [],
        favorite: true,
        lastPlayedAt: 6,
        checkStatus: "ok",
        checkedAt: 10,
      });
      expect(await migrated.listFacets()).toEqual({
        countries: [""],
        languages: [""],
        contents: ["新闻"],
      });
      await createRepository(legacy);
      const replacement = content([
        {
          name: "新名称",
          id: "news",
          url: "https://a.example.com/1",
          country: "CN;US",
          language: "zh;en",
        },
      ]);
      await migrated.refreshSource(
        "legacy-source",
        1,
        await parseM3U(replacement),
      );
      expect(await migrated.getChannel("legacy-channel")).toMatchObject({
        identityKey: "id:news",
        countries: ["CN", "US"],
        languages: ["zh", "en"],
        favorite: true,
        lastPlayedAt: 6,
        checkStatus: "ok",
        checkedAt: 10,
      });
      expect(await migrated.listChannels()).toHaveLength(1);
      expect(await migrated.listFavorites()).toMatchObject([
        { id: "legacy-channel" },
      ]);
      expect(await migrated.listRecent()).toMatchObject([
        { id: "legacy-channel" },
      ]);
      expect(await legacy.getFirstAsync("PRAGMA user_version")).toEqual({
        user_version: 6,
      });
      expect(await legacy.getAllAsync("PRAGMA foreign_key_check")).toEqual([]);
    } finally {
      legacy.native.close();
    }
  });

  it("normalizes optional legacy preview metadata and clears old labels on an explicit refresh", async () => {
    const text = content([
      {
        name: "新闻",
        id: "news",
        url: "https://a.example.com/1",
        country: "CN",
        language: "zh",
      },
    ]);
    const source = await repo.importSource({
      name: "来源",
      kind: "url",
      location: "https://a.example.com/list",
      preview: await parseM3U(text),
    });
    const [channel] = await repo.listChannels();
    await repo.toggleFavorite(channel.id);
    await repo.recordRecent(channel.id);
    const replacement = await parseM3U(text);
    delete replacement.channels[0].countries;
    delete replacement.channels[0].languages;
    await repo.refreshSource(source.id, source.revision, replacement);
    expect(await repo.getChannel(channel.id)).toMatchObject({
      countries: [],
      languages: [],
      favorite: true,
    });
    expect(await repo.listRecent()).toMatchObject([{ id: channel.id }]);
  });

  it("stores manual check results only for the URL that was checked, and clears them when the URL changes", async () => {
    const source = await importInitial();
    const [first, second] = await repo.listChannels();
    await repo.saveCheckResults([
      { channelId: first.id, streamUrl: first.streamUrl, ok: true },
      {
        channelId: second.id,
        streamUrl: "https://stale.example.com/x",
        ok: false,
      },
    ]);
    const checked = await repo.listChannels();
    expect(checked[0]).toMatchObject({ checkStatus: "ok" });
    expect(checked[0].checkedAt).toEqual(expect.any(Number));
    expect(checked[1]).toMatchObject({ checkStatus: null });
    const token = await repo.beginRefresh(source.id);
    const replacement = content([
      {
        name: "央视 新闻",
        id: "news",
        url: "https://a.example.com/live?token=new",
      },
    ]);
    await repo.refreshSource(
      source.id,
      token.revision,
      await parseM3U(replacement),
      {
        generation: token.generation,
        content: replacement,
      },
    );
    expect((await repo.listChannels())[0]).toMatchObject({
      id: first.id,
      checkStatus: null,
      checkedAt: null,
    });
  });

  it("clears committed data successfully even when the WAL checkpoint fails", async () => {
    const source = await importInitial();
    const [channel] = await repo.listChannels();
    await repo.toggleFavorite(channel.id);
    await repo.recordRecent(channel.id);
    await repo.setSetting("trustedRemoteAllowed", true);
    const exec = jest.spyOn(db, "execAsync").mockImplementation(async (sql) => {
      if (sql === "PRAGMA wal_checkpoint(TRUNCATE);")
        throw new Error("simulated checkpoint failure");
      db.native.exec(sql);
    });

    await expect(repo.clearAll()).resolves.toBeUndefined();

    expect(exec).toHaveBeenCalledWith("PRAGMA wal_checkpoint(TRUNCATE);");
    expect(await repo.listSources()).toEqual([]);
    expect(await repo.listChannels({ includeInactive: true })).toEqual([]);
    expect(await repo.listFavorites()).toEqual([]);
    expect(await repo.listRecent()).toEqual([]);
    expect(await repo.getSourceContent(source.id)).toBeNull();
    expect(await repo.getSetting("trustedRemoteAllowed", false)).toBe(false);
  });

  it("rejects and rolls back when deleting private data fails", async () => {
    const source = await importInitial();
    await repo.setSetting("trustedRemoteAllowed", true);
    db.failWhen = (sql) => sql === "DELETE FROM settings";

    await expect(repo.clearAll()).rejects.toThrow("simulated disk failure");

    expect(await repo.listSources()).toEqual([source]);
    expect(await repo.listChannels()).toHaveLength(3);
    expect(await repo.getSetting("trustedRemoteAllowed", false)).toBe(true);
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

describe("looked-up and derived metadata", () => {
  const listText = (url: string) =>
    "#EXTM3U\n" +
    `#EXTINF:-1 tvg-id="CCTV1.cn@SD",CCTV-1\n${url}\n` +
    `#EXTINF:-1 tvg-id="Own",自有台 \nhttps://a.example.com/own\n`;

  it("fills only empty languages for the looked-up tvg-id and keeps them across refresh", async () => {
    const first = listText("https://a.example.com/1");
    const source = await repo.importSource({
      name: "iptv",
      kind: "file",
      location: "i.m3u",
      content: first,
      preview: await parseM3U(first),
    });
    const [cctv, own] = await repo.listChannels();
    expect(cctv).toMatchObject({ countries: ["CN"], languages: [] });
    const changed = await repo.saveLookedUpLanguages([
      { channelId: cctv.id, tvgId: "CCTV1.cn@SD", languages: ["zho"] },
      // Wrong tvg-id for this channel: must not be applied.
      { channelId: own.id, tvgId: "CCTV1.cn@SD", languages: ["eng"] },
    ]);
    expect(changed).toBe(1);
    const second = listText("https://a.example.com/1-new");
    const token = await repo.beginRefresh(source.id);
    await repo.refreshSource(
      source.id,
      token.revision,
      await parseM3U(second),
      {
        generation: token.generation,
        content: second,
      },
    );
    const [after, ownAfter] = await repo.listChannels();
    expect(after).toMatchObject({
      id: cctv.id,
      countries: ["CN"],
      languages: ["zh"],
      streamUrl: "https://a.example.com/1-new",
    });
    expect(ownAfter.languages).toEqual([]);
    expect(
      await repo
        .listChannels({ language: "zh" })
        .then((l) => l.map((c) => c.id)),
    ).toEqual([cctv.id]);
  });
});

it("v4 migration backfills countries from stored iptv-org tvg-ids only", async () => {
  const legacy = new TestDatabase();
  await createRepository(legacy);
  legacy.native.exec(`
    INSERT INTO sources(id,name,kind,location,content,createdAt,lastSuccessAt,lastErrorCategory,revision)
      VALUES ('s','旧','url','https://a.example.com/l.m3u',NULL,1,1,NULL,1);
    INSERT INTO channels(id,sourceId,identityKey,name,groupName,tvgId,logoUrl,streamUrl,sortIndex,active,lastSeenRevision)
      VALUES ('a','s','id:CCTV1.cn@SD','CCTV-1','综合','CCTV1.cn@SD',NULL,'https://a.example.com/1',0,1,1),
             ('b','s','url:2','自有','综合','own-id',NULL,'https://a.example.com/2',1,1,1);
    ALTER TABLE channels DROP COLUMN lookupLanguages;
    DROP INDEX channels_group;
    ALTER TABLE channels DROP COLUMN groupKey;
    ALTER TABLE channels DROP COLUMN qualityLabel;
    ALTER TABLE channels DROP COLUMN qualityRank;
    PRAGMA user_version = 3;
  `);
  const migrated = await createRepository(legacy);
  const byId = Object.fromEntries(
    (await migrated.listChannels()).map((c) => [c.id, c.countries]),
  );
  expect(byId).toEqual({ a: ["CN"], b: [] });
  legacy.native.close();
});

it("lists unreachable channels last while unchecked and reachable keep their order", async () => {
  const text = content([
    { name: "一", url: "https://a.example.com/1" },
    { name: "二", url: "https://a.example.com/2" },
    { name: "三", url: "https://a.example.com/3" },
    { name: "四", url: "https://a.example.com/4" },
  ]);
  await repo.importSource({
    name: "排序",
    kind: "file",
    location: "o.m3u",
    content: text,
    preview: await parseM3U(text),
  });
  const [one, two, three] = await repo.listChannels();
  await repo.saveCheckResults([
    { channelId: one.id, streamUrl: one.streamUrl, ok: false },
    { channelId: three.id, streamUrl: three.streamUrl, ok: true },
  ]);
  expect((await repo.listChannels()).map((c) => c.name)).toEqual([
    "二",
    "三",
    "四",
    "一",
  ]);
  await repo.toggleFavorite(one.id);
  await repo.toggleFavorite(two.id);
  expect(
    (await repo.listChannels({ mode: "favorites" })).map((c) => c.name),
  ).toEqual(["二", "一"]);
});
