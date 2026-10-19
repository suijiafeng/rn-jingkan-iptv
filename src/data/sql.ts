/** The SQLite surface the repository needs, so tests can run on Node. */
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
        stale_refresh: "本次刷新已被新的刷新取代，请重新刷新。",
        empty_import: "没有有效频道，原数据保持不变。",
        invalid_input: "导入内容不完整，请重新导入。",
        newer_schema: "本地数据由更新版本创建，请更新应用。",
        channel_missing: "频道已不可用。",
      }[code],
    );
    this.name = "RepositoryError";
  }
}
