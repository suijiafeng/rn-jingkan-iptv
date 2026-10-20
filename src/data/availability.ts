import { normalizeLanguages } from "../domain/channelFacets";
import type { SqlExecutor } from "./sql";

export interface StoredCheck {
  streamUrl: string;
  checkStatus: "ok" | "unreachable";
  checkedAt: number;
}

/** Full addresses, not channel names or logical groups, identify a probe. */
export async function readChecks(
  db: SqlExecutor,
  urls: readonly string[],
): Promise<StoredCheck[]> {
  const unique = [...new Set(urls)];
  const results: StoredCheck[] = [];
  for (let start = 0; start < unique.length; start += 400) {
    const batch = unique.slice(start, start + 400);
    results.push(
      ...(await db.getAllAsync<StoredCheck>(
        `SELECT streamUrl, checkStatus, checkedAt FROM (
        SELECT streamUrl, checkStatus, checkedAt,
          ROW_NUMBER() OVER (PARTITION BY streamUrl ORDER BY checkedAt DESC, checkStatus DESC, id) AS rank
        FROM channels WHERE streamUrl IN (${batch.map(() => "?").join(",")})
          AND checkStatus IS NOT NULL AND checkedAt IS NOT NULL
      ) WHERE rank = 1`,
        batch,
      )),
    );
  }
  return results;
}

/** Migration and new imports inherit the latest known result for their URL. */
export async function synchronizeChecks(
  db: SqlExecutor,
  sourceId?: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE channels AS c SET (checkStatus, checkedAt) = (
      SELECT known.checkStatus, known.checkedAt FROM channels known
      WHERE known.streamUrl = c.streamUrl AND known.checkStatus IS NOT NULL AND known.checkedAt IS NOT NULL
      ORDER BY known.checkedAt DESC, known.checkStatus DESC, known.id LIMIT 1
    ) WHERE ${sourceId === undefined ? "" : "c.sourceId = ? AND "}EXISTS (
      SELECT 1 FROM channels known WHERE known.streamUrl = c.streamUrl
        AND known.checkStatus IS NOT NULL AND known.checkedAt IS NOT NULL
    )`,
    sourceId === undefined ? [] : [sourceId],
  );
}

/**
 * New imports also inherit the audio languages another row with the same
 * address already learned. Separate from synchronizeChecks, which runs in
 * migrations from before the column existed.
 */
export async function synchronizeStreamLanguages(
  db: SqlExecutor,
  sourceId: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE channels AS c SET streamLanguages = (
      SELECT known.streamLanguages FROM channels known
      WHERE known.streamUrl = c.streamUrl AND known.streamLanguages <> ''
      ORDER BY known.checkedAt DESC, known.id LIMIT 1
    ) WHERE c.sourceId = ? AND c.streamLanguages = '' AND EXISTS (
      SELECT 1 FROM channels known
      WHERE known.streamUrl = c.streamUrl AND known.streamLanguages <> ''
    )`,
    [sourceId],
  );
}

/**
 * Records reachability per address. Declared audio languages replace the
 * stored ones only when the check read a master playlist; otherwise the
 * last known languages stay.
 */
export async function writeChecks(
  db: SqlExecutor,
  results: { streamUrl: string; ok: boolean; languages?: string[] }[],
  now: number,
): Promise<void> {
  for (const result of new Map(
    results.map((item) => [item.streamUrl, item]),
  ).values())
    await db.runAsync(
      result.languages
        ? "UPDATE channels SET checkStatus = ?, checkedAt = ?, streamLanguages = ? WHERE streamUrl = ?"
        : "UPDATE channels SET checkStatus = ?, checkedAt = ? WHERE streamUrl = ?",
      [
        result.ok ? "ok" : "unreachable",
        now,
        ...(result.languages
          ? [normalizeLanguages(result.languages.join(";")).join(";")]
          : []),
        result.streamUrl,
      ],
    );
}
