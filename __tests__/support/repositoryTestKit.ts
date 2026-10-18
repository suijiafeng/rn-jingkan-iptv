import { DatabaseSync } from "node:sqlite";
import {
  createRepository,
  Repository,
  type SqlDatabase,
  type SqlExecutor,
  type SqlValue,
} from "../../src/data/repository";
import { parseM3U } from "../../src/domain/m3u";
import type { Source } from "../../src/domain/types";

/** Shared fakes for the repository suites; not a test file itself. */
export class TestDatabase implements SqlDatabase {
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

export const content = (
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
      (channel) =>
        `#EXTINF:-1 tvg-id="${channel.id ?? ""}" group-title="${channel.group ?? "新闻"}" tvg-country="${channel.country ?? ""}" tvg-language="${channel.language ?? ""}",${channel.name}\n${channel.url}`,
    )
    .join("\n");
export const initialText = content([
  {
    name: "央视 新闻",
    id: "news",
    url: "https://a.example.com/live?token=old",
  },
  { name: "CCTV Sports", url: "http://a.example.com/sport", group: "体育" },
  { name: "财经 100%_频道", url: "https://a.example.com/finance" },
]);

/** Imports the shared three-channel playlist into the given repository. */
export async function importInitialInto(repo: Repository): Promise<Source> {
  return repo.importSource({
    name: "测试来源",
    kind: "file",
    location: "channels.m3u",
    content: initialText,
    preview: await parseM3U(initialText),
  });
}

/** A repository over a fresh in-memory database with a deterministic clock and ids. */
export async function openTestRepository(): Promise<{
  db: TestDatabase;
  repo: Repository;
}> {
  const db = new TestDatabase();
  let tick = 1700000000000;
  let seq = 0;
  const repo = await createRepository(db, {
    now: () => tick++,
    makeId: () => `record-${++seq}`,
  });
  return { db, repo };
}
