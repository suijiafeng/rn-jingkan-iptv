import React, { useState } from "react";
import { Modal, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { Button, Heading } from "../../components/ui";
import { styles } from "../../theme";
import { RISK } from "../common/confirm";
import { Chevron, SettingRow } from "./SettingRows";

export const versionLabel = () =>
  `静看 TV ${Constants.expoConfig?.version ?? "未知版本"} · 构建 ${Constants.expoConfig?.android?.versionCode ?? "未知"}`;

export function About() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingRow
        title="关于静看 TV"
        caption={versionLabel()}
        trailing={<Chevron />}
        onPress={() => setOpen(true)}
      />
      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView
          style={styles.screen}
          edges={["top", "bottom", "left", "right"]}
        >
          <ScrollView contentContainerStyle={styles.content}>
            <Heading title="静看 TV" subtitle={versionLabel()} />
            <Text style={styles.body}>安静地看，资料自己保管。</Text>
            <Text style={styles.muted}>
              个人 Android IPTV
              客户端。无应用广告、账号或遥测；不内置节目来源。支持主动进入画中画；后台播放默认关闭，开启后通过媒体前台服务继续播放并提供系统媒体控制，不用于后台定位或其他常驻任务。来源中的节目和广告由相应提供方负责，仅观看你有权访问的内容。
            </Text>
            <Heading title="隐私与权限" />
            <Text style={styles.body}>
              节目单、来源地址、收藏、观看记录和偏好保存在本机数据库；不上传分析服务，不记录完整地址或观看历史日志。应用禁用系统备份和换机迁移；卸载会删除本机资料，请先手动导出备份。
            </Text>
            <Text style={styles.muted}>{RISK}</Text>
            <Text style={styles.body}>
              台标默认关闭，需单独允许。IP
              识别与前台单次定位分别征求同意；不保存
              IP、经纬度或原始响应，不申请后台定位。手动选择国家/地区始终优先。语言补全仅在来源管理中手动触发时连接
              iptv-org 公开数据库。
            </Text>
            <Text style={styles.muted}>
              导出的备份文件未加密，可能包含来源令牌和本地节目单。仅由你选择保存目录；恢复不会继承联网许可，也不会自动刷新来源。
            </Text>
            <Heading title="使用与更新" />
            <Text style={styles.body}>
              使用“添加节目单”导入可信链接或本地文件。播放失败可重试或切换同频道来源；未知原生错误需手动重试。直播通常不支持拖动，仅对支持回看的流显示时间轴。
            </Text>
            <Text style={styles.muted}>
              更新前建议导出备份。后续版本需保持相同包名与签名才能覆盖安装；更换签名需卸载重装。正式版本从可信渠道手动安装，不在后台下载更新。
            </Text>
            <Heading title="开源组件" />
            <Text style={styles.muted}>
              使用 Expo、React、React Native、Expo Video、SQLite 及 AndroidX
              Media3 等开源组件。组件许可证随发行资料提供，完整清单见发行包
              THIRD_PARTY_NOTICES.txt。
            </Text>
            <View>
              <Button label="返回设置" onPress={() => setOpen(false)} />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
