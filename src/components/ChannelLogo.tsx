import React, { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { channelArtworkUrl } from "../domain/channelArtwork";
import { channelMonogram } from "../domain/channelLabels";
import { colors, sizes, styles } from "../theme";

export interface ChannelLogoProps {
  uri: string | null | undefined;
  title: string;
  enabled: boolean;
  size?: number;
}

export function ChannelLogo({
  uri,
  title,
  enabled,
  size = sizes.logo,
}: ChannelLogoProps) {
  const safeUri = enabled ? channelArtworkUrl(uri) : null;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[logoStyles.badge, { width: size, height: size }]}
    >
      {safeUri ? (
        <RemoteLogo key={safeUri} uri={safeUri} title={title} size={size} />
      ) : (
        <Monogram title={title} />
      )}
    </View>
  );
}

function Monogram({ title }: { title: string }) {
  const mark = channelMonogram(title);
  return (
    <Text
      style={[
        styles.heading,
        logoStyles.monogram,
        mark.length > 1 && logoStyles.monogramWide,
      ]}
    >
      {mark}
    </Text>
  );
}

// Keyed by URI so a late native callback belongs only to the old image.
function RemoteLogo({
  uri,
  title,
  size,
}: {
  uri: string;
  title: string;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <Monogram title={title} />
  ) : (
    <Image
      testID="channel-logo-image"
      source={{ uri }}
      resizeMode="contain"
      style={{ width: size, height: size }}
      accessible={false}
      onError={() => setFailed(true)}
    />
  );
}

const logoStyles = StyleSheet.create({
  monogram: { color: colors.accent },
  // "15", "5+", "CG": two or three glyphs must fit the 40dp badge.
  monogramWide: { fontSize: 14, letterSpacing: -0.3 },
  badge: {
    borderRadius: 10,
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
