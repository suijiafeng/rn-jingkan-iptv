import type { Channel } from "../../domain/types";
import { compareChannelSources } from "../../domain/channelSources";

/**
 * Why an attempt ended without a picture. "unknown" is anything the native
 * player reported that cannot be pinned on the stream itself (decoder,
 * runtime, an unreadable vendor message); those stay manual-retry only.
 */
export type AttemptFailure = "timeout" | "network" | "media" | "unknown";

/** Failures that another address of the same channel may well not share. */
export const isSwitchableFailure = (failure: AttemptFailure) =>
  failure !== "unknown";

/**
 * Conservative reading of expo-video's single `PlayerError.message` string
 * (Android wraps ExoPlayer's message and cause). Only unmistakable transport
 * and container failures are classified; nothing from the message is kept.
 */
export function classifyPlayerError(
  message: string | null | undefined,
): Exclude<AttemptFailure, "timeout"> {
  const text = message ?? "";
  if (
    /Response code: \d{3}|InvalidResponseCode|Unable to connect|HttpDataSource|UnknownHost|SocketTimeout|ConnectException|SSLHandshake|SSLException|Cleartext HTTP traffic|ERROR_CODE_IO_/i.test(
      text,
    )
  )
    return "network";
  if (
    /UnrecognizedInputFormat|ParserException|BehindLiveWindow|ERROR_CODE_PARSING_|Input does not start with the #EXTM3U header|None of the available extractors|Source error/i.test(
      text,
    )
  )
    return "media";
  return "unknown";
}

/** Sources in the order the list shows and the failover walks them. */
export function orderedSources(sources: readonly Channel[]): Channel[] {
  return [...sources].sort(compareChannelSources);
}

/** 1-based position of the current address among its channel's sources. */
export function sourcePosition(
  sources: readonly Channel[],
  current: Pick<Channel, "id">,
): { index: number; total: number } | null {
  const ordered = orderedSources(sources);
  const index = ordered.findIndex((source) => source.id === current.id);
  return index < 0 ? null : { index: index + 1, total: ordered.length };
}

/**
 * The next untried address after `current`, walking the ordered list and
 * wrapping around so a manually chosen start is followed by the rest. Null
 * once every source has been tried in this round.
 */
export function nextUntriedSource(
  sources: readonly Channel[],
  current: Pick<Channel, "id">,
  tried: readonly string[],
): Channel | null {
  const ordered = orderedSources(sources);
  const start = ordered.findIndex((source) => source.id === current.id);
  if (start < 0 || ordered.length < 2) return null;
  for (let step = 1; step < ordered.length; step += 1) {
    const candidate = ordered[(start + step) % ordered.length];
    if (!tried.includes(candidate.id) && candidate.id !== current.id)
      return candidate;
  }
  return null;
}

/** One pass over a channel's addresses; every source is tried once per round. */
export interface FailoverRound {
  groupKey: string;
  /** Channel ids whose attempt already failed in this round. */
  tried: string[];
  /** The address this round switched to by itself, if the current one is. */
  autoSelected: string | null;
}

export const sourceGroupKey = (channel: Pick<Channel, "id" | "groupKey">) =>
  channel.groupKey ?? channel.id;

export const freshRound = (channel: Channel): FailoverRound => ({
  groupKey: sourceGroupKey(channel),
  tried: [],
  autoSelected: null,
});

/**
 * Applies one failure of `current` to the round. Returns the round to keep
 * and the source to switch to (null: stay, and let the user retry).
 */
export function advanceRound(
  round: FailoverRound | null,
  current: Channel,
  sources: readonly Channel[],
  failure: AttemptFailure,
): { round: FailoverRound; next: Channel | null } {
  const base =
    round && round.groupKey === sourceGroupKey(current)
      ? round
      : freshRound(current);
  // The same failure is reported once per attempt; a repeat changes nothing.
  if (base.tried.includes(current.id)) return { round: base, next: null };
  const tried = [...base.tried, current.id];
  const next = isSwitchableFailure(failure)
    ? nextUntriedSource(sources, current, tried)
    : null;
  return {
    round: { ...base, tried, autoSelected: next ? next.id : null },
    next,
  };
}

/** Status line while an automatic switch connects; never names the address. */
export const switchingTitle = (position: { index: number; total: number }) =>
  `来源 ${position.index}/${position.total} 连接中`;

/** Extra body line once a round has tried every address without a picture. */
export const exhaustedBody = (total: number) =>
  total > 1 ? `${total} 个来源都试过了` : "";
