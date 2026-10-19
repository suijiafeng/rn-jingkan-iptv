import { playerNotice } from "../playerStatus";

const quiet = {
  connectingTitle: null,
  pausedBody: "",
  slow: false,
};

test("failures say only what happened", () => {
  expect(playerNotice({ ...quiet, phase: "timeout" })).toBe("连接超时");
  expect(playerNotice({ ...quiet, phase: "error" })).toBe("无法播放");
  expect(playerNotice({ ...quiet, phase: "offline" })).toBe("没有网络");
  expect(playerNotice({ ...quiet, phase: "ended" })).toBe("直播已结束");
});

test("waiting is silent until a switch or a slow start", () => {
  expect(playerNotice({ ...quiet, phase: "connecting" })).toBeNull();
  expect(
    playerNotice({
      ...quiet,
      phase: "connecting",
      connectingTitle: "来源 2/3 连接中",
    }),
  ).toBe("来源 2/3 连接中");
  expect(playerNotice({ ...quiet, phase: "buffering", slow: true })).toBe(
    "加载较慢",
  );
  expect(playerNotice({ ...quiet, phase: "playing" })).toBeNull();
});

test("a pause speaks only when something else caused it", () => {
  expect(playerNotice({ ...quiet, phase: "paused" })).toBeNull();
  expect(
    playerNotice({ ...quiet, phase: "paused", pausedBody: "切到后台时暂停" }),
  ).toBe("切到后台时暂停");
  // The mobile-data question stays on the picture until answered.
  expect(playerNotice({ ...quiet, phase: "cellular" })).toBeNull();
});
