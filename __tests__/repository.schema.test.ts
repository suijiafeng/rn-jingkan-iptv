/** @jest-environment node */
import { createRepository, Repository } from "../src/data/repository";
import { parseM3U } from "../src/domain/m3u";
import type { Source } from "../src/domain/types";
import { UNGROUPED } from "../src/domain/channelLabels";
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
  it("migrates once, stores file source privately and reopens without data loss", async () => {
    const source = await importInitial();
    expect(source).toMatchObject({
      name: "测试来源",
      kind: "file",
      location: "channels.m3u",
      revision: 1,
      channelCount: 3,
      enabled: true,
    });
    expect(await repo.getSourceContent(source.id)).toBe(initialText);
    const [channel] = await repo.listChannels();
    await repo.toggleFavorite(channel.id);
    repo = await createRepository(db);
    expect(await repo.listFavorites()).toMatchObject([
      { id: channel.id, favorite: true },
    ]);
    expect(await db.getFirstAsync("PRAGMA user_version")).toEqual({
      user_version: 9,
    });
  });

  it("does not rewrite a database newer than this app", async () => {
    await db.execAsync("PRAGMA user_version = 10");
    await expect(createRepository(db)).rejects.toMatchObject({
      code: "newer_schema",
    });
    expect(await db.getFirstAsync("PRAGMA user_version")).toEqual({
      user_version: 10,
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
      user_version: 9,
    });
    expect(await migrated.listGroups()).toEqual(
      ["纪录片", "旅游", "文化", UNGROUPED].sort((left, right) =>
        left === UNGROUPED
          ? 1
          : right === UNGROUPED
            ? -1
            : left.localeCompare(right, "zh-Hans-CN"),
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
        user_version: 9,
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
      await expect(createRepository(legacy)).resolves.toBeInstanceOf(
        Repository,
      );
      expect(await legacy.getFirstAsync("PRAGMA user_version")).toEqual({
        user_version: 9,
      });
    } finally {
      legacy.native.close();
    }
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
        user_version: 9,
      });
      expect(await legacy.getAllAsync("PRAGMA foreign_key_check")).toEqual([]);
    } finally {
      legacy.native.close();
    }
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
    (await migrated.listChannels()).map((channel) => [
      channel.id,
      channel.countries,
    ]),
  );
  expect(byId).toEqual({ a: ["CN"], b: [] });
  legacy.native.close();
});
