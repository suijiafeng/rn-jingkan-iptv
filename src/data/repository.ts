// Public entry for local data: the repository class, its SQL surface and
// the native SQLite connection. Split across modules under src/data.
import { Repository, type RepositoryOptions } from "./channelRepository";
import type { SqlDatabase, SqlValue } from "./sql";

export {
  Repository,
  type RefreshOptions,
  type RepositoryOptions,
} from "./channelRepository";
export {
  RepositoryError,
  type SqlDatabase,
  type SqlExecutor,
  type SqlValue,
} from "./sql";
export { SCHEMA_VERSION } from "./schema";

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
