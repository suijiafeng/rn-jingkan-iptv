import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, sizes, styles, type } from "../../theme";

export interface SheetAction {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  accessibilityLabel?: string;
}

/**
 * The folded actions of one source, as a bottom sheet: the source's name
 * on top, one row per action, 取消 underneath. Tapping the dim backdrop
 * closes it too.
 */
export function SourceActionSheet({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  actions: SheetAction[];
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="关闭更多操作"
        style={sheetStyles.backdrop}
        onPress={onClose}
      />
      <View style={sheetStyles.sheet}>
        <Text style={[styles.caption, sheetStyles.title]} numberOfLines={1}>
          {title}
        </Text>
        <View style={sheetStyles.group}>
          {actions.map((action, index) => (
            <React.Fragment key={action.label}>
              {index > 0 && <View style={sheetStyles.divider} />}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={action.accessibilityLabel ?? action.label}
                accessibilityState={{ disabled: !!action.disabled }}
                disabled={action.disabled}
                onPress={() => {
                  onClose();
                  action.onPress();
                }}
                style={({ pressed }) => [
                  sheetStyles.row,
                  action.disabled && sheetStyles.disabled,
                  pressed && sheetStyles.pressed,
                ]}
              >
                <Text
                  style={[
                    sheetStyles.rowText,
                    action.danger && sheetStyles.danger,
                  ]}
                >
                  {action.label}
                </Text>
              </Pressable>
            </React.Fragment>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="取消"
          onPress={onClose}
          style={({ pressed }) => [
            sheetStyles.group,
            sheetStyles.row,
            pressed && sheetStyles.pressed,
          ]}
        >
          <Text style={[sheetStyles.rowText, sheetStyles.cancel]}>取消</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#00000099" },
  sheet: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 28,
    gap: 10,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  title: { paddingHorizontal: 8, paddingTop: 6 },
  group: {
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
    backgroundColor: colors.line,
  },
  row: {
    minHeight: sizes.touch,
    paddingHorizontal: 16,
    justifyContent: "center",
  },
  rowText: { ...type.body, color: colors.text, fontWeight: "500" },
  danger: { color: colors.bad },
  cancel: { color: colors.muted, textAlign: "center" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
