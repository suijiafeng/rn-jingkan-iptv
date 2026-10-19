import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../../components/ui";
import type { SourceKind } from "../../domain/types";
import { colors, sizes, styles, type } from "../../theme";

/** How the guide ended: with a way to add the first playlist, or later. */
export type GuideExit = SourceKind | null;

/**
 * The first-run guide: one page saying what the app is for, then the two
 * ways to add a playlist. Networking, mobile data and local storage are
 * explained where they happen (the consent dialogs, 关于), not foretold here.
 */
export function FirstRunGuide({
  visible,
  onFinish,
}: {
  visible: boolean;
  onFinish: (exit: GuideExit) => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={() => onFinish(null)}
    >
      <SafeAreaView
        style={styles.screen}
        edges={["top", "bottom", "left", "right"]}
      >
        <View style={guideStyles.topBar}>
          <Pressable
            accessibilityRole="button"
            onPress={() => onFinish(null)}
            hitSlop={8}
            style={({ pressed }) => [
              guideStyles.textAction,
              pressed && guideStyles.pressed,
            ]}
          >
            <Text style={guideStyles.textActionLabel}>稍后再说</Text>
          </Pressable>
        </View>
        <View style={guideStyles.page}>
          <Text accessibilityRole="header" style={guideStyles.title}>
            静看 TV
          </Text>
          <Text style={guideStyles.body}>播放你自己添加的节目单。</Text>
        </View>
        <View style={guideStyles.footer}>
          <Button label="添加节目单链接" onPress={() => onFinish("url")} />
          <Button
            label="从文件导入"
            secondary
            onPress={() => onFinish("file")}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const guideStyles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    minHeight: sizes.touch,
    paddingHorizontal: 8,
  },
  textAction: {
    minHeight: sizes.touch,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  textActionLabel: { ...type.body, color: colors.muted },
  pressed: { opacity: 0.6 },
  page: { flex: 1, paddingHorizontal: 28, paddingTop: 96, gap: 12 },
  title: { ...styles.title, fontSize: 28, lineHeight: 36 },
  body: { color: colors.muted, fontSize: 16, lineHeight: 24 },
  footer: { paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
});
