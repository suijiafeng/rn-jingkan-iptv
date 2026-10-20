import { isIptvOrgId, normalizeLanguages } from "../domain/channelFacets";
import { splitGroups, UNGROUPED } from "../domain/channelLabels";
import { groupOrder } from "./channelSql";
import { RepositoryError, type SqlExecutor } from "./sql";

/**
 * Languages the user assigns by hand to one source: a default for the whole
 * source and one per group. Each is a single normalized code ("" = none) and
 * only applies to channels the playlist and the iptv-org lookup leave
 * unlabelled (see EFFECTIVE_LANGUAGES).
 */
export interface SourceLanguages {
  defaultLanguage: string;
  /** Group name → language; groups without a choice are absent. */
  groups: Record<string, string>;
}

/** One code or nothing; anything that does not normalize is refused. */
function languageCode(raw: string): string {
  if (!raw) return "";
  const [code, ...rest] = normalizeLanguages(raw);
  if (!code || rest.length) throw new RepositoryError("invalid_input");
  return code;
}

export async function readSourceLanguages(
  db: SqlExecutor,
  sourceId: string,
): Promise<SourceLanguages> {
  const source = await db.getFirstAsync<{ defaultLanguage: string }>(
    "SELECT defaultLanguage FROM sources WHERE id = ?",
    [sourceId],
  );
  if (!source) throw new RepositoryError("source_missing");
  const rows = await db.getAllAsync<{ groupName: string; language: string }>(
    "SELECT groupName, language FROM source_group_languages WHERE sourceId = ?",
    [sourceId],
  );
  return {
    defaultLanguage: source.defaultLanguage,
    groups: Object.fromEntries(
      rows.map((row) => [row.groupName, row.language]),
    ),
  };
}

/** Replaces the source's choices; caller owns the transaction. */
export async function writeSourceLanguages(
  tx: SqlExecutor,
  sourceId: string,
  languages: SourceLanguages,
): Promise<void> {
  const result = await tx.runAsync(
    "UPDATE sources SET defaultLanguage = ? WHERE id = ?",
    [languageCode(languages.defaultLanguage), sourceId],
  );
  if (!result.changes) throw new RepositoryError("source_missing");
  await tx.runAsync("DELETE FROM source_group_languages WHERE sourceId = ?", [
    sourceId,
  ]);
  for (const [groupName, raw] of Object.entries(languages.groups)) {
    const language = languageCode(raw);
    if (!groupName.trim() || groupName.includes(";") || !language) continue;
    await tx.runAsync(
      "INSERT INTO source_group_languages(sourceId, groupName, language) VALUES(?,?,?)",
      [sourceId, groupName, language],
    );
  }
}

/**
 * The groups of one source, whether or not it is switched on, sorted like
 * the group tabs. Ungrouped channels have no group to set; the source's
 * default covers them.
 */
export async function querySourceGroups(
  db: SqlExecutor,
  sourceId: string,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ groupName: string }>(
    "SELECT DISTINCT groupName FROM channels WHERE sourceId = ? AND active = 1",
    [sourceId],
  );
  const groups = new Set(rows.flatMap((row) => splitGroups(row.groupName)));
  groups.delete(UNGROUPED);
  return [...groups].sort((left, right) => groupOrder.compare(left, right));
}

/**
 * Channels the iptv-org lookup may fill: an iptv-org formatted tvg-id and
 * no language from the playlist or an earlier lookup. The user's own source
 * and group languages rank below the lookup, so they do not exclude a row.
 */
export async function queryLanguageLookupTargets(
  db: SqlExecutor,
  sourceId: string,
): Promise<{ id: string; tvgId: string }[]> {
  const rows = await db.getAllAsync<{ id: string; tvgId: string }>(
    `SELECT id, tvgId FROM channels WHERE sourceId = ? AND active = 1
       AND tvgId IS NOT NULL AND languages = '' AND lookupLanguages = ''`,
    [sourceId],
  );
  return rows.filter((row) => isIptvOrgId(row.tvgId));
}
