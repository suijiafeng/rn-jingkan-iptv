import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { BackBar, Heading } from "../../components/ui";
import { colors, sizes, styles } from "../../theme";
import { RISK } from "../common/confirm";
import { Chevron, SettingRow } from "./SettingRows";

export const versionLabel = () =>
  `静看 TV ${Constants.expoConfig?.version ?? "未知版本"} · 构建 ${Constants.expoConfig?.android?.versionCode ?? "未知"}`;

/**
 * The details the rest of the app leaves out, in folded sections. Each
 * paragraph is its own string so a section stays a list of short reads.
 */
const SECTIONS: { title: string; paragraphs: string[] }[] = [
  {
    title: "这是什么",
    paragraphs: [
      "个人 Android IPTV 客户端。无应用广告、账号或遥测；不内置节目来源。来源中的节目和广告由相应提供方负责，仅观看你有权访问的内容。",
      "支持主动进入画中画；后台播放默认开启，通过媒体前台服务继续播放并提供系统媒体控制，会持续耗电并使用流量，可在设置中关闭，不用于后台定位或其他常驻任务。",
    ],
  },
  {
    title: "隐私与资料",
    paragraphs: [
      "节目单、来源地址、收藏、观看记录和偏好保存在本机数据库；不上传分析服务，不记录完整地址或观看历史日志。",
      "应用不使用系统备份和换机迁移；卸载会删除本机资料。重装或换机前请先导出备份，以便恢复。",
    ],
  },
  { title: "联网说明", paragraphs: [RISK] },
  {
    title: "台标与地区识别",
    paragraphs: [
      "台标默认关闭，需单独允许。只接受 HTTPS 台标地址，但图片服务器可能将请求重定向至其他地址，无法保证全程加密；失败时显示频道首字。",
      "IP 识别与前台单次定位分别征求同意；不保存 IP、经纬度或原始响应，不申请后台定位。手机地区与时区设置可能与实际位置不同。手动选择国家/地区始终优先；识别依据显示在国家/地区筛选菜单顶部。",
      "导入节目单时，若有频道未标语言，导入预览会提供「自动补全语言」开关（默认开）；开启后保存时下载一次 iptv-org 公开数据库（约 8 MB），关闭则不联网。",
    ],
  },
  {
    title: "备份",
    paragraphs: [
      "导出的备份文件未加密，可能包含来源令牌和本地节目单。仅由你选择保存目录；恢复不会继承联网许可，也不会自动刷新来源。",
    ],
  },
  {
    title: "使用",
    paragraphs: [
      "使用“添加节目单”导入可信链接或本地文件；本地文件支持 UTF-8 或 GBK 编码的 M3U、TXT 节目单。",
      "同一频道的不同地址列在“视频来源”里，默认先播排在第一的。播放失败会依次试其他来源；少数原因不明的错误需手动重试。重试按钮上的小圆点表示上次测试未连通。",
      "直播通常不支持拖动，仅对支持回看的流显示时间轴。",
    ],
  },
  {
    title: "更新",
    paragraphs: [
      "更新前建议导出备份。后续版本需保持相同包名与签名才能覆盖安装；更换签名需卸载重装。正式版本从可信渠道手动安装，不在后台下载更新。",
    ],
  },
  {
    title: "开源组件",
    paragraphs: [
      "使用 Expo、React、React Native、Expo Video、SQLite 及 AndroidX Media3 等开源组件。组件许可证随发行资料提供，完整清单见发行包 THIRD_PARTY_NOTICES.txt。",
    ],
  },
];

function Section({
  title,
  paragraphs,
}: {
  title: string;
  paragraphs: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={aboutStyles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [
          aboutStyles.sectionHeader,
          pressed && { opacity: 0.7 },
        ]}
      >
        <Text style={[styles.body, aboutStyles.sectionTitle]}>{title}</Text>
        <Text style={aboutStyles.arrow}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open &&
        paragraphs.map((paragraph) => (
          <Text key={paragraph} style={styles.muted}>
            {paragraph}
          </Text>
        ))}
    </View>
  );
}

export function About() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingRow
        title="关于静看 TV"
        value={Constants.expoConfig?.version}
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
          <BackBar onBack={() => setOpen(false)} />
          <ScrollView contentContainerStyle={styles.content}>
            <Heading title="静看 TV" subtitle={versionLabel()} />
            <Text style={styles.body}>安静地看，资料自己保管。</Text>
            <View>
              {SECTIONS.map((section) => (
                <Section key={section.title} {...section} />
              ))}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const aboutStyles = StyleSheet.create({
  section: {
    gap: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  sectionHeader: {
    minHeight: sizes.touch,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: { flex: 1, fontWeight: "600" },
  arrow: { color: colors.muted },
});
