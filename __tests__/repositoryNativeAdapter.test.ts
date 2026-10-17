/** @jest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type DatabaseSync as Database } from "node:sqlite";
import {
  createNativeRepository,
  type NativeSqliteProvider,
} from "../src/data/repository";
import { parseM3U } from "../src/domain/m3u";

const mockFolder = mkdtempSync(join(tmpdir(), "jingkan-sqlite-"));
const mockConnections: {
  db: Database;
  newConnection: boolean;
  closed: boolean;
  foreignKeysAtBegin?: number;
}[] = [];

const mockSQLite: NativeSqliteProvider = {
  openDatabaseAsync: async (
    filename: string,
    options?: { useNewConnection?: boolean },
  ) => {
    // Native connection defaults are intentionally restrictive, so this checks
    // that the production adapter itself sets PRAGMAs on EVERY connection.
    const db = new DatabaseSync(join(mockFolder, filename), {
      enableForeignKeyConstraints: false,
    });
    const connection = {
      db,
      newConnection: options?.useNewConnection === true,
      closed: false,
      foreignKeysAtBegin: undefined as number | undefined,
    };
    mockConnections.push(connection);
    return {
      execAsync: async (sql: string) => {
        db.exec(sql);
        if (sql.includes("BEGIN"))
          connection.foreignKeysAtBegin = Number(
            db.prepare("PRAGMA foreign_keys").get()!.foreign_keys,
          );
      },
      runAsync: async (
        sql: string,
        params: (string | number | null)[] = [],
      ) => {
        const result = db.prepare(sql).run(...params);
        return {
          changes: Number(result.changes),
          lastInsertRowId: Number(result.lastInsertRowid),
        };
      },
      getFirstAsync: async <T>(
        sql: string,
        params: (string | number | null)[] = [],
      ) => (db.prepare(sql).get(...params) as T | undefined) ?? null,
      getAllAsync: async <T>(
        sql: string,
        params: (string | number | null)[] = [],
      ) => db.prepare(sql).all(...params) as T[],
      closeAsync: async () => {
        db.close();
        connection.closed = true;
      },
    };
  },
};

afterAll(() => {
  for (const connection of mockConnections)
    if (!connection.closed) connection.db.close();
  rmSync(mockFolder, { recursive: true, force: true });
});

it("opens private SQLite through the native adapter, configures each transaction connection and cascades deletes", async () => {
  const repo = await createNativeRepository(mockSQLite);
  const preview = await parseM3U(
    "#EXTM3U\n#EXTINF:-1,频道\nhttps://a.example.com/live",
  );
  const source = await repo.importSource({
    name: "测试",
    kind: "url",
    location: "https://a.example.com/list",
    preview,
  });
  const [channel] = await repo.listChannels();
  await repo.toggleFavorite(channel.id);
  await repo.recordRecent(channel.id);
  await repo.deleteSource(source.id);
  expect(await repo.listSources()).toEqual([]);
  expect(await repo.listFavorites()).toEqual([]);
  expect(await repo.listRecent()).toEqual([]);
  const primary = mockConnections.find((item) => !item.newConnection)!;
  expect(
    primary.db.prepare("SELECT COUNT(*) AS n FROM channels").get()!.n,
  ).toBe(0);
  expect(
    primary.db.prepare("SELECT COUNT(*) AS n FROM favorites").get()!.n,
  ).toBe(0);
  expect(primary.db.prepare("SELECT COUNT(*) AS n FROM recents").get()!.n).toBe(
    0,
  );
  expect(
    mockConnections.filter((item) => item.newConnection).length,
  ).toBeGreaterThanOrEqual(5);
  for (const connection of mockConnections.filter(
    (item) => item.newConnection,
  )) {
    expect(connection.foreignKeysAtBegin).toBe(1);
    expect(connection.closed).toBe(true);
  }
});
