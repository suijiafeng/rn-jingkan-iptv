import React from "react";
import { ScrollView, Switch } from "react-native";
import { Button, Heading } from "../../components/ui";
import { colors, styles } from "../../theme";
import { Chevron, RowAction, SettingRow, SettingSection } from "./SettingRows";
import type { Repository } from "../../data/repository";
import { BackupControls } from "./BackupControls";
import { About } from "./About";
import { MINI_WINDOW_SPACE } from "../home/useFloatingWindow";

interface Props {
  repo?: Repository | null;
  onRestoreBackup?: (text: string) => Promise<void>;
  /** Shown under 管理节目来源; omitted while sources are unknown. */
  sourceCount?: number;
  remoteAllowed: boolean;
  revokePending: boolean;
  mobileWarning: boolean;
  backgroundPlayback?: boolean;
  backgroundSaving?: boolean;
  onBackgroundPlaybackChange?: (value: boolean) => void;
  artworkAllowed: boolean;
  artworkSaving: boolean;
  artworkRevokePending: boolean;
  onRetryArtworkRevoke: () => void;
  onArtworkChange: (value: boolean) => void;
  regionConsented: boolean;
  regionBusy: boolean;
  onRevokeRegion: () => void;
  onManageSources: () => void;
  onRevoke: () => void;
  onAllowRemote: () => void;
  onMobileWarningChange: (value: boolean) => void;
  swipeReverse: boolean;
  onSwipeReverseChange: (value: boolean) => void;
  miniPlayer: boolean;
  onMiniPlayerChange: (value: boolean) => void;
  onClearAll: () => void;
  onShowGuide?: () => void;
  /** The docked player window floats over the page bottom. */
  reserveMiniBar?: boolean;
}

export function SettingsScreen(props: Props) {
  const artworkDisabled =
    props.artworkSaving ||
    props.artworkRevokePending ||
    props.revokePending ||
    (!props.remoteAllowed && !props.artworkAllowed);
  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        screenStyles.content,
        props.reserveMiniBar && { paddingBottom: MINI_WINDOW_SPACE },
      ]}
    >
      <Heading title="设置" />
      <SettingSection label="节目来源">
        <SettingRow
          title="管理节目来源"
          value={
            props.sourceCount === undefined
              ? undefined
              : `${props.sourceCount} 份`
          }
          trailing={<Chevron />}
          onPress={props.onManageSources}
        />
      </SettingSection>
      <SettingSection label="联网与隐私">
        <SettingRow
          title="节目来源联网"
          status={
            props.revokePending
              ? { label: "撤销未保存", tone: "warn" }
              : props.remoteAllowed
                ? { label: "已允许", tone: "accent" }
                : { label: "未允许", tone: "muted" }
          }
          caption={
            props.revokePending
              ? "撤销尚未保存，保存前许可仍可能有效"
              : undefined
          }
          warn
          trailing={
            props.revokePending ? (
              <Button compact label="重试保存撤销" onPress={props.onRevoke} />
            ) : props.remoteAllowed ? (
              <RowAction
                label="撤销"
                danger
                accessibilityLabel="撤销联网许可"
                onPress={props.onRevoke}
              />
            ) : (
              <Button
                compact
                label="了解说明并允许"
                onPress={props.onAllowRemote}
              />
            )
          }
        />
        <SettingRow
          title="频道台标"
          // Only says why the switch cannot be used right now.
          caption={props.remoteAllowed ? undefined : "需先允许节目来源联网"}
          dimmed={artworkDisabled}
          trailing={
            <Switch
              accessibilityLabel="显示频道台标"
              value={props.artworkAllowed}
              disabled={artworkDisabled}
              trackColor={{ true: colors.accent }}
              onValueChange={props.onArtworkChange}
            />
          }
        />
        {props.artworkRevokePending && (
          <SettingRow
            title="台标关闭尚未保存"
            status={{ label: "待重试", tone: "warn" }}
            trailing={
              <Button
                compact
                label="重试保存"
                accessibilityLabel="重试保存台标关闭"
                onPress={props.onRetryArtworkRevoke}
              />
            }
          />
        )}
        <SettingRow
          title="移动网络提醒"
          trailing={
            <Switch
              accessibilityLabel="移动网络提醒"
              value={props.mobileWarning}
              trackColor={{ true: colors.accent }}
              onValueChange={props.onMobileWarningChange}
            />
          }
        />
        {props.regionConsented && (
          <SettingRow
            title="国家/地区识别"
            status={{ label: "已授权", tone: "muted" }}
            trailing={
              <RowAction
                label={props.regionBusy ? "停止并撤销" : "撤销"}
                danger
                accessibilityLabel={
                  props.regionBusy ? "停止并撤销识别授权" : "撤销识别授权"
                }
                onPress={props.onRevokeRegion}
              />
            }
          />
        )}
      </SettingSection>
      <SettingSection label="播放">
        <SettingRow
          title="后台播放"
          trailing={
            <Switch
              accessibilityLabel="后台播放"
              value={props.backgroundPlayback ?? true}
              disabled={props.backgroundSaving}
              trackColor={{ true: colors.accent }}
              onValueChange={props.onBackgroundPlaybackChange}
            />
          }
        />
        <SettingRow
          title="滑动换台"
          trailing={
            <Switch
              accessibilityLabel="滑动换台"
              value={props.swipeReverse}
              trackColor={{ true: colors.accent }}
              onValueChange={props.onSwipeReverseChange}
            />
          }
        />
        <SettingRow
          title="小浮窗播放器"
          trailing={
            <Switch
              accessibilityLabel="小浮窗播放器"
              value={props.miniPlayer}
              trackColor={{ true: colors.accent }}
              onValueChange={props.onMiniPlayerChange}
            />
          }
        />
      </SettingSection>
      <SettingSection label="本机资料">
        {props.repo && props.onRestoreBackup && (
          <BackupControls repo={props.repo} onRestore={props.onRestoreBackup} />
        )}
        <SettingRow
          title="清空全部本地资料"
          danger
          onPress={props.onClearAll}
        />
      </SettingSection>
      <SettingSection label="应用信息">
        {props.onShowGuide && (
          <SettingRow
            title="使用指引"
            trailing={<Chevron />}
            onPress={props.onShowGuide}
          />
        )}
        <About />
      </SettingSection>
    </ScrollView>
  );
}

const screenStyles = {
  content: { gap: 20 },
} as const;
