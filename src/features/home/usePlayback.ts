import { useRef, useState, type MutableRefObject } from "react";
import type { Repository } from "../../data/repository";
import type { Channel } from "../../domain/types";

/**
 * What is playing, the queue the player zaps through, and the channel
 * before it. Every async step re-checks that it is still the newest request
 * and that network permission was not withdrawn meanwhile.
 */
export function usePlayback({
  repo,
  setError,
  mounted,
  permissionEpoch,
  guardRemote,
  channels,
  listSettled,
  fullList,
}: {
  repo: Repository | null;
  setError: (message: string) => void;
  mounted: MutableRefObject<boolean>;
  permissionEpoch: MutableRefObject<number>;
  guardRemote: () => Promise<boolean>;
  channels: Channel[];
  listSettled: MutableRefObject<boolean>;
  fullList: MutableRefObject<Promise<Channel[]>>;
}) {
  const [playing, setPlaying] = useState<Channel | null>(null),
    // Docked bar over the channel page; the stream keeps playing (foreground
    // only, leaving the app still pauses).
    [playerMini, setPlayerMini] = useState(false),
    [playingSources, setPlayingSources] = useState<Channel[]>([]),
    // For "回到上一个频道": the channel watched before the current one.
    [previousChannel, setPreviousChannel] = useState<Channel | null>(null),
    [playQueue, setPlayQueue] = useState<Channel[]>([]);
  const playGeneration = useRef(0),
    lastWatched = useRef<Channel | null>(null);

  /** After a refresh or delete, re-reads the playing channel's sources. */
  const reconcilePlayingSources = async (current = playing) => {
    if (!repo || !current) return;
    const task = playGeneration.current;
    const epoch = permissionEpoch.current;
    const fresh = await repo.getChannel(current.id);
    const groupKey =
      fresh?.active && fresh.groupKey
        ? fresh.groupKey
        : (current.groupKey ?? current.id);
    const alternatives = await repo.listChannelSources(groupKey);
    if (
      !mounted.current ||
      task !== playGeneration.current ||
      epoch !== permissionEpoch.current
    )
      return;
    setPlayingSources(alternatives);
    if (!alternatives.length) {
      setPlaying(null);
      return;
    }
    setPlaying(
      alternatives.find((source) => source.id === current.id) ??
        alternatives[0],
    );
  };

  const play = async (channel: Channel, queueFrom?: Channel[]) => {
    if (!repo || !channel.active) return;
    const task = ++playGeneration.current;
    const epoch = permissionEpoch.current;
    const stillWanted = () =>
      mounted.current &&
      task === playGeneration.current &&
      epoch === permissionEpoch.current;
    // A tap during progressive loading still queues the whole list.
    const wholeList = listSettled.current ? null : fullList.current;
    try {
      if (!(await guardRemote()) || epoch !== permissionEpoch.current) return;
      const queue = queueFrom ?? (wholeList ? await wholeList : channels);
      // Read only this channel so the player opens at once; loading 10k+
      // catalog rows first took ~5 s on the emulator.
      const fresh = await repo.getChannel(channel.id);
      if (!stillWanted()) return;
      const representative = fresh?.active ? fresh : null;
      if (!representative) {
        setError("频道已不可用，请重新读取频道后重试");
        return;
      }
      const alternatives = await repo.listChannelSources(
        representative.groupKey ?? representative.id,
      );
      if (!stillWanted()) return;
      setPlayQueue(queue.filter((queued) => queued.active));
      const playable = alternatives[0] ?? representative;
      setPlayingSources(alternatives.length ? alternatives : [representative]);
      const watchedBefore = playing ?? lastWatched.current;
      if (watchedBefore && watchedBefore.id !== playable.id)
        setPreviousChannel(watchedBefore);
      setPlaying(playable);
      // A pick from the page (or the bar's own list) opens the full player.
      setPlayerMini(false);
    } catch {
      if (stillWanted()) setError("无法读取播放频道，请重试");
    }
  };

  const stopPlayback = () => {
    ++playGeneration.current;
    setPlaying(null);
    setPlayingSources([]);
  };

  const closePlayer = () => {
    lastWatched.current = playing;
    stopPlayback();
    setPlayerMini(false);
  };

  /** Switches to another source of the same logical channel only. */
  const selectSource = (source: Channel) => {
    if (
      !playing ||
      !source.active ||
      !playingSources.some(
        (available) =>
          available.id === source.id &&
          available.streamUrl === source.streamUrl,
      ) ||
      (source.groupKey ?? source.id) !== (playing.groupKey ?? playing.id)
    )
      return;
    ++playGeneration.current;
    setPlaying(source);
  };

  /** A deleted source must not come back through "回到上一个频道". */
  const forgetSource = (sourceId: string) => {
    if (previousChannel?.sourceId === sourceId) setPreviousChannel(null);
    if (lastWatched.current?.sourceId === sourceId) lastWatched.current = null;
  };

  const forgetHistory = () => {
    setPreviousChannel(null);
    lastWatched.current = null;
  };

  /**
   * Applies a local row change to the copies of a channel the player holds;
   * the source list is left alone for changes that only concern the queue.
   */
  const patchChannels = (
    patch: (channel: Channel) => Channel,
    { includeSources = true } = {},
  ) => {
    setPlaying((current) => (current ? patch(current) : current));
    if (includeSources) setPlayingSources((items) => items.map(patch));
    setPlayQueue((items) => items.map(patch));
  };

  return {
    playing,
    playerMini,
    setPlayerMini,
    playingSources,
    previousChannel,
    playQueue,
    play,
    reconcilePlayingSources,
    stopPlayback,
    closePlayer,
    selectSource,
    forgetSource,
    forgetHistory,
    patchChannels,
  };
}

export type Playback = ReturnType<typeof usePlayback>;
