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
import { Button } from "../../components/ui";
import type { SourceKind } from "../../domain/types";
import { colors, sizes, styles, type } from "../../theme";

const GUIDE_STEPS = [
  {
    title: "欢迎使用静看 TV",
    body: "只播放你自己添加的节目单。应用不内置节目来源，没有广告、账号和统计。",
  },
  {
    title: "添加你的节目单",
    body: "支持 M3U、TXT 链接或本地文件，UTF-8 与 GBK 编码均可。来源只在你刷新时更新，不会自动联网。",
  },
  {
    title: "联网前先问你",
    body: "第一次下载节目单或播放前，会说明风险并请你允许；使用移动数据时也会提醒。台标和国家/地区识别默认关闭，需要时再单独开启。",
  },
  {
    title: "资料只在这台手机",
    body: "频道、收藏和最近观看都保存在本机。可以在设置中导出备份，或随时全部清空。",
  },
] as const;

/** How the guide ended: with a way to add the first playlist, or later. */
export type GuideExit = SourceKind | null;

/**
 * The first-run guide: a few short pages on what the app does and does not
 * do, ending with the two ways to add a playlist. The primary action keeps
 * one place at the bottom on every page, so tapping through never lands on
 * "上一步"; going back, the page dots and leaving share a quiet top bar. Back
 * steps to the previous page; on the first page it closes the guide.
 */
export function FirstRunGuide({
  visible,
  onFinish,
}: {
  visible: boolean;
  onFinish: (exit: GuideExit) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const step = GUIDE_STEPS[stepIndex];
  const lastStep = stepIndex === GUIDE_STEPS.length - 1;
  const finish = (exit: GuideExit) => {
    setStepIndex(0);
    onFinish(exit);
  };
  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={() =>
        stepIndex > 0 ? setStepIndex(stepIndex - 1) : finish(null)
      }
    >
      <SafeAreaView
        style={styles.screen}
        edges={["top", "bottom", "left", "right"]}
      >
        <View style={guideStyles.topBar}>
          <View style={guideStyles.side}>
            {stepIndex > 0 && (
              <TextAction
                label="上一步"
                onPress={() => setStepIndex(stepIndex - 1)}
              />
            )}
          </View>
          <View
            accessible
            accessibilityLabel={`第 ${stepIndex + 1} 页，共 ${GUIDE_STEPS.length} 页`}
            style={guideStyles.dots}
          >
            {GUIDE_STEPS.map((guideStep, dotIndex) => (
              <View
                key={guideStep.title}
                style={[
                  guideStyles.dot,
                  dotIndex === stepIndex && guideStyles.dotCurrent,
                ]}
              />
            ))}
          </View>
          <View style={[guideStyles.side, guideStyles.sideEnd]}>
            {lastStep ? (
              <TextAction label="稍后再说" onPress={() => finish(null)} />
            ) : (
              <TextAction
                label="跳过"
                accessibilityLabel="跳过使用指引"
                onPress={() => finish(null)}
              />
            )}
          </View>
        </View>
        <ScrollView contentContainerStyle={guideStyles.page}>
          <View accessibilityLiveRegion="polite" style={guideStyles.copy}>
            <Text accessibilityRole="header" style={styles.title}>
              {step.title}
            </Text>
            <Text style={[styles.body, guideStyles.body]}>{step.body}</Text>
          </View>
        </ScrollView>
        <View style={guideStyles.footer}>
          {lastStep && (
            <Button
              label="从文件导入"
              secondary
              onPress={() => finish("file")}
            />
          )}
          {lastStep ? (
            <Button label="添加节目单链接" onPress={() => finish("url")} />
          ) : (
            <Button
              label="下一步"
              onPress={() => setStepIndex(stepIndex + 1)}
            />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

/** A low-emphasis action: muted text, full touch height, no background. */
function TextAction({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        guideStyles.textAction,
        pressed && guideStyles.pressed,
      ]}
    >
      <Text style={guideStyles.textActionLabel}>{label}</Text>
    </Pressable>
  );
}

const guideStyles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: sizes.touch,
    paddingHorizontal: 8,
  },
  // Equal sides keep the page dots centred whatever the labels are.
  side: { flex: 1, alignItems: "flex-start" },
  sideEnd: { alignItems: "flex-end" },
  textAction: {
    minHeight: sizes.touch,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  textActionLabel: { ...type.body, color: colors.muted },
  pressed: { opacity: 0.6 },
  // Copy starts at the same height on every page, so titles do not jump.
  page: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 96 },
  copy: { gap: 12 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  footer: { paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
  dots: { flexDirection: "row", gap: 6 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.line,
  },
  dotCurrent: { width: 18, backgroundColor: colors.accent },
});
