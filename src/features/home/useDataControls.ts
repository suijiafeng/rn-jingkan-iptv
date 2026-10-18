import type { Repository } from "../../data/repository";
import type { Source } from "../../domain/types";
import { confirm } from "../common/confirm";
import type { Tab } from "../channel/ChannelListParts";
import type { useChannelFilters } from "../channel/useChannelFilters";
import type { useRegionPreference } from "../region/useRegionPreference";
import type { AppSettings } from "./useAppSettings";
import type { ChannelListData } from "./useChannelListData";
import type { Playback } from "./usePlayback";
import type { SourceImport } from "./useSourceImport";
import type { useSourceTasks } from "./useSourceTasks";

/**
 * The destructive controls: deleting a source, withdrawing network
 * permission and clearing all local data. Each stops every running task
 * that could still act on what is being removed.
 */
export function useDataControls({
  repo,
  setError,
  settings,
  list,
  playback,
  importer,
  sourceTasks,
  cancelAutoCheck,
  region,
  filters,
  setTab,
  setRecentEditing,
}: {
  repo: Repository | null;
  setError: (message: string) => void;
  settings: AppSettings;
  list: ChannelListData;
  playback: Playback;
  importer: SourceImport;
  sourceTasks: ReturnType<typeof useSourceTasks>;
  cancelAutoCheck: () => void;
  region: ReturnType<typeof useRegionPreference>;
  filters: ReturnType<typeof useChannelFilters>;
  setTab: (tab: Tab) => void;
  setRecentEditing: (editing: boolean) => void;
}) {
  /** Network permission is gone: stop playback and every remote task. */
  const stopRemoteWork = () => {
    settings.withdrawRemote();
    playback.stopPlayback();
    importer.cancelTask();
    sourceTasks.stopCheck();
    sourceTasks.stopLanguageLookup();
    cancelAutoCheck();
    region.cancel();
  };

  const removeSource = async (source: Source) => {
    if (
      !repo ||
      !(await confirm(
        `删除“${source.name}”？`,
        `会移除 ${source.channelCount} 个频道及 ${source.favoriteCount} 个收藏与相关观看记录。应用内无法撤销。`,
        "删除",
      ))
    )
      return;
    importer.cancelTask();
    sourceTasks.stopForSource(source.id);
    playback.forgetSource(source.id);
    repo.cancelRefresh(source.id);
    setError("");
    try {
      await repo.deleteSource(source.id);
      try {
        await playback.reconcilePlayingSources();
      } catch {
        if (settings.mounted.current) {
          playback.stopPlayback();
          setError("来源已删除；播放器来源列表更新失败，已停止当前播放。");
        }
      }
      filters.forgetSource(source.id);
      list.changed();
    } catch {
      setError("删除未完成，请重试");
    }
  };

  const revoke = async () => {
    if (!repo) return;
    if (
      !settings.revokePending &&
      !(await confirm(
        "撤销联网许可？",
        "将停止播放并取消导入。下次联网前会再次说明风险。",
        "撤销",
      ))
    )
      return;
    setError("");
    stopRemoteWork();
    try {
      await repo.setSetting("remoteAllowed", false);
      settings.setRevokePending(false);
    } catch {
      setError("许可已在本次运行中撤销，但未能保存。请重试撤销。");
    }
  };

  const clearAll = async () => {
    if (
      !repo ||
      !(await confirm(
        "清空全部本地资料？",
        "节目单、收藏、观看记录与设置都会删除，无法在应用内恢复。你原来的文件不受影响。",
        "全部清空",
      ))
    )
      return;
    stopRemoteWork();
    try {
      await repo.clearAll();
      settings.resetToDefaults();
      region.reset();
      playback.forgetHistory();
      sourceTasks.clearCheckSummaries();
      filters.forgetSaved();
      filters.reset();
      filters.setCountryBypass(null);
      list.forgetTabOffsets();
      setTab("all");
      setRecentEditing(false);
      list.changed();
    } catch {
      setError("清理未完成，请重试");
    }
  };

  return { removeSource, revoke, clearAll };
}
