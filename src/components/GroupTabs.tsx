import React, { useCallback, useEffect, useRef } from "react";
import { ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import { Button } from "./ui";

interface Props {
  groups: string[];
  selected: string | null;
  onChange: (group: string | null) => void;
  buttonStyle?: ViewStyle;
  testID?: string;
}

const ALL_KEY = "scope:all";
const groupKey = (name: string) => `group:${name}`;

/** The first item clears only the playlist group filter. */
export function GroupTabs({
  groups,
  selected,
  onChange,
  buttonStyle,
  testID = "group-tabs",
}: Props) {
  const scroller = useRef<React.ElementRef<typeof ScrollView>>(null);
  const viewport = useRef(0);
  const contentWidth = useRef(0);
  const offset = useRef(0);
  const positions = useRef(new Map<string, { x: number; width: number }>());
  const pendingReveal = useRef(true);
  const selectedIndex = selected === null ? -1 : groups.indexOf(selected);
  const selectedKey =
    selected === null
      ? ALL_KEY
      : selectedIndex >= 0
        ? groupKey(selected)
        : null;
  const revealSelected = useCallback(() => {
    if (!pendingReveal.current || selectedKey === null) return;
    const item = positions.current.get(selectedKey);
    if (!item || viewport.current <= 0 || contentWidth.current <= 0) return;
    pendingReveal.current = false;
    let next = offset.current;
    if (item.width >= viewport.current || item.x < next) next = item.x;
    else if (item.x + item.width > next + viewport.current)
      next = item.x + item.width - viewport.current;
    next = Math.max(0, Math.min(next, contentWidth.current - viewport.current));
    if (Math.abs(next - offset.current) > 1) {
      offset.current = next;
      scroller.current?.scrollTo({ x: next, animated: false });
    }
  }, [selectedKey]);
  useEffect(() => {
    pendingReveal.current = true;
    revealSelected();
  }, [revealSelected, selectedIndex]);

  if (!groups.length) return null;
  const items = [
    {
      key: ALL_KEY,
      label: "全部",
      testID: `${testID}-all`,
      selected: selected === null,
      onPress: () => {
        if (selected !== null) onChange(null);
      },
    },
    ...groups.map((name, index) => ({
      key: groupKey(name),
      label: name === "全部" ? "全部（分组）" : name,
      testID: `${testID}-item-${index}`,
      selected: selected === name,
      onPress: () => {
        if (selected !== name) onChange(name);
      },
    })),
  ];
  return (
    <ScrollView
      ref={scroller}
      testID={testID}
      horizontal
      style={styles.scroller}
      contentContainerStyle={styles.content}
      // The chips themselves show the row scrolls; a bar only adds noise.
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      onLayout={({ nativeEvent }) => {
        if (viewport.current !== nativeEvent.layout.width) {
          viewport.current = nativeEvent.layout.width;
          pendingReveal.current = true;
        }
        revealSelected();
      }}
      onContentSizeChange={(width) => {
        if (contentWidth.current !== width) {
          contentWidth.current = width;
          pendingReveal.current = true;
        }
        revealSelected();
      }}
      onScroll={({ nativeEvent }) => {
        offset.current = nativeEvent.contentOffset.x;
      }}
      scrollEventThrottle={32}
    >
      {items.map((item) => (
        <View
          key={item.key}
          testID={item.testID}
          onLayout={({ nativeEvent }) => {
            const { x, width } = nativeEvent.layout;
            const previous = positions.current.get(item.key);
            positions.current.set(item.key, { x, width });
            if (
              item.key === selectedKey &&
              (previous?.x !== x || previous?.width !== width)
            )
              pendingReveal.current = true;
            revealSelected();
          }}
        >
          <Button
            label={item.label}
            secondary={!item.selected}
            selected={item.selected}
            style={buttonStyle}
            compact
            onPress={item.onPress}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroller: { flexGrow: 0, flexShrink: 0 },
  content: { gap: 8, paddingBottom: 2 },
});
