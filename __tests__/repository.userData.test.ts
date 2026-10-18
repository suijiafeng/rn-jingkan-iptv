/** @jest-environment node */
import { Repository } from "../src/data/repository";
import { parseM3U } from "../src/domain/m3u";
import type { Source } from "../src/domain/types";
import {
  content,
  importInitialInto,
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
  it("keeps only the 100 most recently played channels and updates in place", async () => {
    const text = content(
      Array.from({ length: 105 }, (_unused, index) => ({
        name: `频道 ${index}`,
        url: `https://a.example.com/${index}`,
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
    expect(recent.some((channel) => channel.id === channels[0].id)).toBe(false);
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
    ).toMatchObject([{ id: sport.id, active: false }]);
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
});
