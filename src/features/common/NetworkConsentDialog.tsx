import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button } from "../../components/ui";
import { colors, sizes, styles, type } from "../../theme";
import { RISK } from "./confirm";

/**
 * Informed consent for going online, in two layers: three short lines that
 * cover what matters (the server sees your IP, HTTP can be read or altered,
 * it can be revoked), and the full text one tap away. Nothing is left out;
 * it is only folded. On mobile data a fourth line makes the same tap also
 * the mobile-data confirmation, so a first play asks once, not twice.
 */
export function NetworkConsentDialog({
  visible,
  cellular,
  onAnswer,
}: {
  visible: boolean;
  /** The device may be on mobile data and the user asked to be warned. */
  cellular: boolean;
  onAnswer: (allowed: boolean) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The next showing starts folded again.
  const answer = (allowed: boolean) => {
    setDetailsOpen(false);
    onAnswer(allowed);
  };
  const points = [
    "来源服务器会看到你的 IP",
    "HTTP 内容可能被窃听或篡改",
    ...(cellular ? ["当前可能在用移动数据，会消耗流量"] : []),
    "随时可在设置里撤销",
  ];
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="fade"
      onRequestClose={() => answer(false)}
    >
      <View style={dialogStyles.scrim}>
        <View
          accessibilityViewIsModal
          accessibilityLabel="允许联网读取节目来源？"
          style={dialogStyles.panel}
        >
          <Text accessibilityRole="header" style={dialogStyles.title}>
            允许联网读取节目来源？
          </Text>
          <ScrollView contentContainerStyle={dialogStyles.body}>
            {points.map((point) => (
              <View key={point} style={dialogStyles.point}>
                <View style={dialogStyles.bullet} />
                <Text style={[styles.body, dialogStyles.pointText]}>
                  {point}
                </Text>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: detailsOpen }}
              onPress={() => setDetailsOpen((open) => !open)}
              style={dialogStyles.detailsToggle}
            >
              <Text style={dialogStyles.detailsToggleText}>
                {detailsOpen ? "收起说明" : "完整说明 ›"}
              </Text>
            </Pressable>
            {detailsOpen && (
              <Text style={[styles.muted, dialogStyles.details]}>{RISK}</Text>
            )}
          </ScrollView>
          <View style={dialogStyles.actions}>
            <Button
              compact
              secondary
              label="不用了"
              onPress={() => answer(false)}
            />
            <Button compact label="允许" onPress={() => answer(true)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const dialogStyles = StyleSheet.create({
  scrim: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  panel: {
    maxHeight: "86%",
    borderRadius: 24,
    padding: 24,
    gap: 16,
    backgroundColor: colors.raised,
  },
  title: { ...type.title, fontSize: 20, color: colors.text },
  body: { gap: 10 },
  point: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bullet: {
    width: 6,
    height: 6,
    marginTop: 7,
    borderRadius: 3,
    backgroundColor: colors.muted,
  },
  pointText: { flex: 1 },
  detailsToggle: { minHeight: sizes.touch, justifyContent: "center" },
  detailsToggleText: { ...type.body, color: colors.accent },
  details: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
});
