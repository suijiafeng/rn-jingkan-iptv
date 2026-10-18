/** @jest-environment node */
import { Repository } from "../src/data/repository";
import { parseM3U } from "../src/domain/m3u";
import type { ImportPreview, Source } from "../src/domain/types";
import {
  content,
  importInitialInto,
  initialText,
  openTestRepository,
  TestDatabase,
} from "./support/repositoryTestKit";

let db: TestDatabase;
let repo: Repository;
async function importInitial(): Promise<Source> {
  return importInitialInto(repo);
}

beforeEach(async () => {
  ({ db, repo } = await openTestRepository());
});
afterEach(() => {
  db.native.close();
});

describe("SQLite repository with real SQLite", () => {
  it("batches large imports across statement boundaries and keeps order and IDs on refresh", async () => {
    const run = jest.spyOn(db, "runAsync");
    const many = (prefix: string) =>
      content(
        Array.from({ length: 250 }, (_unused, index) => ({
          name: `${prefix}${index}`,
          id: `ch${index}`,
          url: `https://a.example.com/${prefix}${index}`,
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
    expect(before.map((channel) => channel.sortIndex)).toEqual(
      Array.from({ length: 250 }, (_unused, index) => index),
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
    expect(after.map((channel) => channel.id)).toEqual(
      before.map((channel) => channel.id),
    );
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
    ).toMatchObject([{ id: sport.id, active: false }]);
    expect(await repo.listRecent()).toEqual([]);
    expect(
      await repo.listChannels({ mode: "recent", includeInactive: true }),
    ).toMatchObject([{ id: finance.id, active: false }]);
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
        .then((listed) => listed.map((channel) => channel.id)),
    ).toEqual([cctv.id]);
  });
});
