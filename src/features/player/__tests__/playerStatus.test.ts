import { playerNotice } from "../playerStatus";

const quiet = {
  connectingTitle: null,
  failedBody: "",
  pausedBody: "",
  unreachable: false,
  slow: false,
};

test("failures name the reason, then the round and the last check", () => {
  expect(playerNotice({ ...quiet, phase: "timeout" })).toBe("连接超时");
  expect(
    playerNotice({
      ...quiet,
      phase: "error",
      failedBody: "3 个来源都试过了",
      unreachable: true,
    }),
  ).toBe("暂时无法播放，3 个来源都试过了，上次检测也打不开");
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
