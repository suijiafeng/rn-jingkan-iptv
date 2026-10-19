import { useRef, useState, type MutableRefObject } from "react";
import type { Repository } from "../../data/repository";
import type { Channel } from "../../domain/types";
import { confirm } from "../common/confirm";
import type { ChannelListData } from "./useChannelListData";
import type { Playback } from "./usePlayback";

/**
 * Favorites and watch history. Changes patch the rows already on screen and
 * re-read only when a list's membership changes.
 */
export function useChannelActions({
  repo,
  setError,
  mounted,
  list,
  playback,
}: {
  repo: Repository | null;
  setError: (message: string) => void;
  mounted: MutableRefObject<boolean>;
  list: ChannelListData;
  playback: Playback;
}) {
  const [recentBusy, setRecentBusy] = useState(false),
    [recentEditing, setRecentEditing] = useState(false);
  const recentMutation = useRef(false);

  const favorite = async (target: Channel) => {
    if (!repo) return;
    try {
      const favorited = await repo.toggleFavorite(target.id);
      const targetKey = target.groupKey ?? target.id;
      const patch = (channel: Channel) =>
        (channel.groupKey ?? channel.id) === targetKey
          ? { ...channel, favorite: favorited }
          : channel;
      playback.patchChannels(patch);
      list.setRecent((items) => items.map(patch));
      list.setChannels((items) => items.map(patch));
      // The patch is enough for lists that keep the row. Re-read only the
      // favorites view (membership changed) or a list whose read may predate
      // this write; never filter using the initiating tab.
      if (list.tabRef.current === "favorites" || !list.listSettled.current)
        list.changed();
      else
        void repo
          .listSources()
          .then((sources) => {
            if (mounted.current) list.setSources(sources);
          })
          .catch(() => {
            if (mounted.current) setError("收藏已保存，统计未刷新");
          });
    } catch {
      setError("收藏未能保存，请重试");
    }
  };

  /** Drops one channel (or, without an id, all) from the shown history. */
  const forgetRecent = (channelId?: string) => {
    const patch = (channel: Channel) =>
      !channelId || channel.id === channelId
        ? { ...channel, lastPlayedAt: null }
        : channel;
    list.setRecent((items) =>
      channelId ? items.filter((item) => item.id !== channelId) : [],
    );
    list.setChannels((items) => items.map(patch));
    playback.patchChannels(patch, { includeSources: false });
    list.changed();
  };

  /** Serializes history edits so a delete and a clear never interleave. */
  const mutateRecent = async (mutation: () => Promise<void>) => {
    if (!repo || recentMutation.current) return;
    recentMutation.current = true;
    setRecentBusy(true);
    try {
      await mutation();
    } finally {
      recentMutation.current = false;
      if (mounted.current) setRecentBusy(false);
    }
  };

  const removeRecent = (channel: Channel) =>
    mutateRecent(async () => {
      await repo!.removeRecent(channel.id);
      if (mounted.current) forgetRecent(channel.id);
    });

  const clearRecent = () =>
    mutateRecent(async () => {
      if (
        !(await confirm(
          "清空最近观看？",
          "只删除观看记录，收藏与频道保留。",
          "清空",
        ))
      )
        return;
      await repo!.clearRecent();
      if (mounted.current) {
        forgetRecent();
        setRecentEditing(false);
      }
    });

  /** Playback is stronger evidence than a separate HTTP availability probe. */
  const recordAvailability = async (target: Channel, ok: boolean) => {
    if (!repo) return;
    try {
      await repo.saveCheckResults([
        { channelId: target.id, streamUrl: target.streamUrl, ok },
      ]);
      const [saved] = await repo.getCheckResults([target.streamUrl]);
      if (!mounted.current || !saved) return;
      const patch = (channel: Channel): Channel =>
        channel.streamUrl === target.streamUrl
          ? {
              ...channel,
              checkStatus: saved.checkStatus,
              checkedAt: saved.checkedAt,
            }
          : channel;
      playback.patchChannels(patch);
      list.setChannels((items) => items.map(patch));
      list.setRecent((items) => items.map(patch));
    } catch {
      if (mounted.current) setError("检测结果未保存，频道不受影响");
    }
  };

  /** The player reports a start; only the recent list needs re-reading. */
  const recordStarted = (channel: Channel) => {
    if (!repo) return;
    // Re-reading a 10k-row channel tab here would compete with stream
    // start-up, so other tabs only refresh their recent rows.
    void repo
      .recordRecent(channel.id)
      .then(async () => {
        if (list.tabRef.current === "recent") list.changed();
        else list.setRecent(await repo.listChannels({ mode: "recent" }));
      })
      .catch(() => setError("观看记录未能保存"));
  };

  return {
    favorite,
    removeRecent,
    clearRecent,
    recordStarted,
    recordAvailability,
    recentBusy,
    recentEditing,
    setRecentEditing,
  };
}

export type ChannelActions = ReturnType<typeof useChannelActions>;
