import { useCallback, useMemo, useState } from "react";
import type { Channel } from "../../domain/types";
import {
  advanceRound,
  type AttemptFailure,
  exhaustedBody,
  type FailoverRound,
  freshRound,
  sourceGroupKey,
  sourcePosition,
  switchingTitle,
} from "./sourceFailover";

/** What the channel session needs from the failover, besides reporting. */
export interface FailoverView {
  /** Title to show while connecting after an automatic switch; else null. */
  connectingTitle: string | null;
  /** Body line for a failure once every address of the round was tried. */
  failedBody: string;
  /** An attempt ended without a picture; may switch to another address. */
  onFailure: (failure: AttemptFailure) => void;
  /** The user started playback (play, retry, continue): a new round begins. */
  onUserPlay: () => void;
}

/**
 * Lives above the per-stream session so the round survives the remount an
 * address change causes. Only timeouts and classified network/media failures
 * move on; offline, cellular, blocked, pauses and unknown native errors
 * leave the user with the manual retry.
 */
export function useSourceFailover(
  channel: Channel,
  sources: readonly Channel[],
  onSelectSource: (source: Channel) => void,
): FailoverView & { onManualSelect: (source: Channel) => void } {
  const [round, setRound] = useState<FailoverRound | null>(null);
  const current =
    round && round.groupKey === sourceGroupKey(channel) ? round : null;
  const onFailure = useCallback(
    (failure: AttemptFailure) => {
      const result = advanceRound(round, channel, sources, failure);
      setRound(result.round);
      if (result.next) onSelectSource(result.next);
    },
    [round, channel, sources, onSelectSource],
  );
  const onUserPlay = useCallback(() => {
    setRound(freshRound(channel));
  }, [channel]);
  const onManualSelect = useCallback(
    (source: Channel) => {
      setRound(freshRound(source));
      onSelectSource(source);
    },
    [onSelectSource],
  );
  const position = useMemo(
    () => sourcePosition(sources, channel),
    [sources, channel],
  );
  const connectingTitle =
    current?.autoSelected === channel.id && position
      ? switchingTitle(position)
      : null;
  const failedBody =
    current && position && current.tried.length >= position.total
      ? exhaustedBody(position.total)
      : "";
  return { connectingTitle, failedBody, onFailure, onUserPlay, onManualSelect };
}
