import React from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { Button, Heading } from "../../components/ui";
import { colors, styles } from "../../theme";
import { RISK } from "../common/confirm";
import { Chevron, RowAction, SettingRow, SettingSection } from "./SettingRows";
import type { Repository } from "../../data/repository";
import { BackupControls } from "./BackupControls";
import { About, versionLabel } from "./About";

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
  skipUnreachable: boolean;
  onSkipUnreachableChange: (value: boolean) => void;
  onClearAll: () => void;
}

export function SettingsScreen(props: Props) {
  const artworkDisabled =
    props.artworkSaving ||
    props.artworkRevokePending ||
    props.revokePending ||
    (!props.remoteAllowed && !props.artworkAllowed);
  return (
    <ScrollView contentContainerStyle={[styles.content, screenStyles.content]}>
      <Heading title="设置" subtitle="简单一点，安静地看" />
      <SettingSection label="节目来源">
        <SettingRow
          title="管理节目来源"
          caption={
            props.sourceCount === undefined
              ? "手动刷新，不自动联网"
              : `${props.sourceCount} 份节目单 · 手动刷新，不自动联网`
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
              ? "联网已停止，撤销尚未保存。请重试保存，避免重启后恢复旧许可。"
              : props.remoteAllowed
                ? "含 HTTP 明文来源，服务器会收到 IP 与请求"
                : "频道资料仍可离线查看"
          }
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
                label="阅读风险并允许"
                onPress={props.onAllowRemote}
              />
            )
          }
        />
        <SettingRow
          title="频道台标"
          caption={
            props.remoteAllowed
              ? "仅加载有效的 HTTPS 台标，缺图时显示首字"
              : props.artworkAllowed
                ? "台标许可已保留，联网关闭期间不加载"
                : "先允许节目来源联网，再单独开启台标"
          }
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
            caption="重启后可能恢复加载台标"
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
          caption="使用流量播放或刷新前先确认"
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
            caption="IP 服务与单次定位，不保存位置"
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
          caption={
            props.backgroundSaving
              ? "正在保存设置…"
              : props.backgroundPlayback
                ? "锁屏或切走时继续播放，会持续耗流量和电量"
                : "切到后台时暂停，画中画除外"
          }
          trailing={
            <Switch
              accessibilityLabel="后台播放"
              value={props.backgroundPlayback ?? false}
              disabled={props.backgroundSaving}
              trackColor={{ true: colors.accent }}
              onValueChange={props.onBackgroundPlaybackChange}
            />
          }
        />
        <SettingRow
          title="换台反转"
          caption={
            props.swipeReverse
              ? "全屏时上滑换上一台，下滑换下一台"
              : "全屏时上滑换下一台，下滑换上一台"
          }
          trailing={
            <Switch
              accessibilityLabel="换台反转"
              value={props.swipeReverse}
              trackColor={{ true: colors.accent }}
              onValueChange={props.onSwipeReverseChange}
            />
          }
        />
        <SettingRow
          title="跳过不可达频道"
          caption="换台时跳过检测为不可达的频道"
          trailing={
            <Switch
              accessibilityLabel="跳过不可达频道"
              value={props.skipUnreachable}
              trackColor={{ true: colors.accent }}
              onValueChange={props.onSkipUnreachableChange}
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
          caption="节目单、收藏、最近观看和许可都会删除"
          danger
          onPress={props.onClearAll}
        />
      </SettingSection>
      <SettingSection label="应用信息">
        <About />
      </SettingSection>
      <View style={screenStyles.footer}>
        <Text style={styles.muted}>{versionLabel()}</Text>
        <Text style={styles.caption}>
          无广告、无账号、无统计。资料只保存在本机。直播源本身可能含广告。只观看你有权访问的内容。
        </Text>
        <Text style={styles.caption}>{RISK}</Text>
      </View>
    </ScrollView>
  );
}

const screenStyles = {
  content: { gap: 20 },
  footer: { gap: 4, paddingHorizontal: 4 },
} as const;
