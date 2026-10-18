/** UTC timestamps are Unix milliseconds. URLs and file contents are private data. */
export type SourceKind = "url" | "file";

export interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  /** A remote URL or just the original file name (never a public file copy). */
  location: string;
  createdAt: number;
  lastSuccessAt: number;
  lastErrorCategory: string | null;
  revision: number;
  channelCount: number;
  favoriteCount: number;
}

export interface ParsedChannel {
  identityKey: string;
  name: string;
  groupName: string;
  tvgId: string | null;
  logoUrl: string | null;
  streamUrl: string;
  sortIndex: number;
}

export interface Channel extends ParsedChannel {
  id: string;
  sourceId: string;
  sourceName: string;
  active: boolean;
  lastSeenRevision: number;
  favorite: boolean;
  lastPlayedAt: number | null;
  /** Manual availability check: the address answered (not proof it plays). */
  checkStatus: "ok" | "unreachable" | null;
  checkedAt: number | null;
}

export type ImportIssueReason =
  | "dangling_extinf"
  | "missing_extinf"
  | "invalid_extinf"
  | "invalid_url"
  | "unsafe_url"
  | "unsupported_protocol"
  | "relative_without_base"
  | "duplicate";

export const IMPORT_ISSUE_LABELS: Record<ImportIssueReason, string> = {
  dangling_extinf: "频道信息后缺少播放地址",
  missing_extinf: "地址前缺少频道信息",
  invalid_extinf: "频道信息格式错误",
  invalid_url: "地址格式错误",
  unsafe_url: "不支持的本机、私网或特殊地址",
  unsupported_protocol: "不支持的地址协议",
  relative_without_base: "本地文件中无法解析的相对地址",
  duplicate: "重复频道",
};

export interface ImportIssue {
  line: number;
  reason: ImportIssueReason;
}

export interface ImportPreview {
  channels: ParsedChannel[];
  stats: {
    valid: number;
    duplicates: number;
    ignored: number;
    total: number;
    http: number;
    bytes: number;
    lines: number;
  };
  /** Bounded, redacted diagnostics. Full URLs and M3U text never appear here. */
  issues: ImportIssue[];
  issueCounts: Partial<Record<ImportIssueReason, number>>;
}

export interface ImportSourceInput {
  name: string;
  kind: SourceKind;
  location: string;
  preview: ImportPreview;
  /** Required for file sources. Stored only inside private SQLite. */
  content?: string;
}

export interface ChannelQuery {
  sourceId?: string;
  groupName?: string;
  search?: string;
  mode?: "all" | "favorites" | "recent";
  includeInactive?: boolean;
  /** Paging for progressive display; rows keep the query's stable order. */
  limit?: number;
  offset?: number;
}

export interface RefreshToken {
  sourceId: string;
  revision: number;
  generation: number;
}
