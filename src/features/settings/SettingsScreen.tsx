import React from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { Button, Card, Heading, Notice } from "../../components/ui";
import { colors, styles } from "../../theme";
import { RISK } from "../common/confirm";

interface Props {
  remoteAllowed: boolean;
  revokePending: boolean;
  mobileWarning: boolean;
  artworkAllowed: boolean;
  artworkSaving: boolean;
  artworkRevokePending: boolean;
  onRetryArtworkRevoke: () => void;
  onArtworkChange: (value: boolean) => void;
  regionMessage: string;
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
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Heading title="设置" subtitle="简单一点，安静地看" />
      <Button label="管理节目来源" secondary onPress={props.onManageSources} />
      <Card>
        <Text style={styles.heading}>节目来源联网与 HTTP 许可</Text>
        <Text style={styles.body}>
          {props.revokePending
            ? "联网已停止，撤销尚未保存。请重试保存，避免重启后恢复旧许可。"
            : props.remoteAllowed
              ? "已允许可信来源联网，可能包含明文内容"
              : "未允许联网，频道资料仍可离线查看"}
        </Text>
        <Button
          secondary
          label={
            props.revokePending
              ? "重试保存撤销"
              : props.remoteAllowed
                ? "撤销联网许可"
                : "阅读风险并允许"
          }
          onPress={
            props.remoteAllowed || props.revokePending
              ? props.onRevoke
              : props.onAllowRemote
          }
        />
      </Card>
      <Card>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heading}>频道台标</Text>
            <Text style={styles.muted}>
              {props.remoteAllowed
                ? "开启前会单独说明图片访问。仅加载有效的 HTTPS 台标，缺图时显示首字。"
                : props.artworkAllowed
                  ? "台标许可已保留，节目来源联网关闭期间不加载；可关闭台标许可。"
                  : "先允许节目来源联网，再单独开启台标。"}
            </Text>
          </View>
          <Switch
            accessibilityLabel="显示频道台标"
            value={props.artworkAllowed}
            disabled={
              props.artworkSaving ||
              props.artworkRevokePending ||
              props.revokePending ||
              (!props.remoteAllowed && !props.artworkAllowed)
            }
            trackColor={{ true: colors.accent }}
            onValueChange={props.onArtworkChange}
          />
        </View>
        {props.artworkRevokePending && (
          <Button
            secondary
            label="重试保存台标关闭"
            onPress={props.onRetryArtworkRevoke}
          />
        )}
      </Card>
      <Card>
        <Text style={styles.heading}>国别识别</Text>
        <Text style={styles.body}>{props.regionMessage}</Text>
        <Text style={styles.muted}>
          在频道页“国别”菜单中识别或手动选择。IP
          查询与系统定位分别授权；只保存地区与选择方式，不保存 IP 或经纬度。
        </Text>
        {props.regionConsented && (
          <Button
            secondary
            label={props.regionBusy ? "停止并撤销识别授权" : "撤销识别授权"}
            onPress={props.onRevokeRegion}
          />
        )}
      </Card>
      <Card>
        <View style={styles.row}>
          <Text style={[styles.body, { flex: 1 }]}>移动网络提醒</Text>
          <Switch
            accessibilityLabel="移动网络提醒"
            value={props.mobileWarning}
            trackColor={{ true: colors.accent }}
            onValueChange={props.onMobileWarningChange}
          />
        </View>
      </Card>
      <Card>
        <Text style={styles.heading}>换台</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.body}>换台反转</Text>
            <Text style={styles.muted}>
              {props.swipeReverse
                ? "全屏时上滑换上一台，下滑换下一台"
                : "全屏时上滑换下一台，下滑换上一台"}
            </Text>
          </View>
          <Switch
            accessibilityLabel="换台反转"
            value={props.swipeReverse}
            trackColor={{ true: colors.accent }}
            onValueChange={props.onSwipeReverseChange}
          />
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.body}>跳过不可达频道</Text>
            <Text style={styles.muted}>
              上一台、下一台和滑动换台时，跳过可用性检测为不可达的频道
            </Text>
          </View>
          <Switch
            accessibilityLabel="跳过不可达频道"
            value={props.skipUnreachable}
            trackColor={{ true: colors.accent }}
            onValueChange={props.onSkipUnreachableChange}
          />
        </View>
      </Card>
      <Button
        secondary
        danger
        label="清空全部本地资料"
        onPress={props.onClearAll}
      />
      <Notice
        title="静看 0.1.0 · 个人测试版"
        body="无广告、无账号、无统计。资料只保存在本机。直播源本身可能含广告。只观看你有权访问的内容。"
      />
      <Text style={styles.muted}>{RISK}</Text>
    </ScrollView>
  );
}
