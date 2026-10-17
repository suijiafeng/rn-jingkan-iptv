import React from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { Button, Card, Heading, Notice } from "../../components/ui";
import { colors, styles } from "../../theme";
import { RISK } from "../common/confirm";

interface Props {
  remoteAllowed: boolean;
  revokePending: boolean;
  mobileWarning: boolean;
  onManageSources: () => void;
  onRevoke: () => void;
  onAllowRemote: () => void;
  onMobileWarningChange: (value: boolean) => void;
  onClearAll: () => void;
}

export function SettingsScreen(props: Props) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Heading title="设置" subtitle="简单一点，安静地看" />
      <Button label="管理节目来源" secondary onPress={props.onManageSources} />
      <Card>
        <Text style={styles.heading}>联网与 HTTP 许可</Text>
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
          <Text style={[styles.body, { flex: 1 }]}>移动网络提醒</Text>
          <Switch
            accessibilityLabel="移动网络提醒"
            value={props.mobileWarning}
            trackColor={{ true: colors.accent }}
            onValueChange={props.onMobileWarningChange}
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
