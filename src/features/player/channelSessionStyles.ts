import { StyleSheet } from "react-native";
import { colors } from "../../theme";

/** ChannelSession's styles: portrait, fullscreen and docked-bar layouts. */
export const sessionStyles = StyleSheet.create({
  flex: { flex: 1 },
  audioStage: {
    backgroundColor: colors.surface,
    alignItems: "center",
    // Above the centre key, which sits over the picture's middle.
    paddingTop: 12,
    gap: 4,
  },
  audioSymbol: { color: colors.accent, fontSize: 32 },
  // The docked window has no centre key: the note sits in the middle.
  miniAudioStage: { justifyContent: "center", paddingTop: 0 },
  audioCaption: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  fullscreenSources: {
    position: "absolute",
    top: 82,
    right: 24,
    width: 300,
    maxHeight: "65%",
    borderRadius: 16,
    padding: 8,
    backgroundColor: "#0A1214D9",
  },
  fullscreenVideo: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: undefined,
  },
  // Docked: the picture fills the owner's floating window, which draws
  // the frame, close key and resize edges.
  miniWindow: { flex: 1 },
  osd: {
    position: "absolute",
    top: 24,
    alignSelf: "center",
    maxWidth: "70%",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "#0A1214D9",
  },
  osdText: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 27,
    fontWeight: "600",
  },
  portraitInfo: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  infoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  infoTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
  },
  infoSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  portraitBottom: {
    position: "absolute",
    left: 6,
    right: 6,
    bottom: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  portraitTopLeft: { position: "absolute", top: 6, left: 6 },
  portraitTopRight: {
    position: "absolute",
    top: 6,
    right: 6,
    flexDirection: "row",
    gap: 6,
  },
  videoNotice: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#060A0CD6",
    alignItems: "center",
    justifyContent: "center",
  },
  centerLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  videoNoticeSoft: { backgroundColor: "#060A0C8C" },
  videoStage: {
    width: "100%",
    backgroundColor: "#000000",
    overflow: "hidden",
  },
  warning: { color: colors.warn, fontSize: 12, lineHeight: 18 },
});
