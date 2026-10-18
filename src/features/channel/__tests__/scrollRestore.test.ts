import { MAX_RESTORE_ATTEMPTS, createScrollRestore } from "../scrollRestore";

test("a deep offset is re-sent until the list reports it", () => {
  const restore = createScrollRestore();
  expect(restore.request(90_000)).toBe(90_000);
  // Android clamped the early scroll to the short list; keep the saved offset.
  expect(restore.scrolled(0)).toBe(false);
  expect(restore.retry()).toBe(90_000);
  expect(restore.scrolled(700)).toBe(false);
  expect(restore.retry()).toBe(90_000);
  expect(restore.scrolled(90_000.4)).toBe(true);
  expect(restore.pending()).toBe(false);
  expect(restore.retry()).toBeNull();
  expect(restore.scrolled(4_000)).toBe(true);
});

test("a drag or new load cancels the request", () => {
  const restore = createScrollRestore();
  restore.request(5_000);
  restore.cancel();
  expect(restore.retry()).toBeNull();
  expect(restore.scrolled(100)).toBe(true);
});

test("retrying is bounded when the list never gets tall enough", () => {
  const restore = createScrollRestore();
  restore.request(5_000);
  let sent = 0;
  while (restore.retry() !== null) sent++;
  expect(sent).toBe(MAX_RESTORE_ATTEMPTS);
  expect(restore.scrolled(300)).toBe(true);
});

test("a reset scrolls to the top without waiting", () => {
  const restore = createScrollRestore();
  expect(restore.request(0)).toBe(0);
  expect(restore.pending()).toBe(false);
});
