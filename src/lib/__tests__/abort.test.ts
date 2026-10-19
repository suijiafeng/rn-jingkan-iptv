import { abortableDelay, linkedDeadline, untilAborted } from "../abort";

afterEach(() => jest.useRealTimers());

test("a deadline fires on its timer and reports the timeout", () => {
  jest.useFakeTimers();
  const deadline = linkedDeadline(new AbortController().signal, 100);
  jest.advanceTimersByTime(99);
  expect(deadline.signal.aborted).toBe(false);
  jest.advanceTimersByTime(1);
  expect(deadline.signal.aborted).toBe(true);
  expect(deadline.timedOut).toBe(true);
  deadline.close();
});

test("a deadline follows its parent without reporting a timeout, and close detaches", () => {
  jest.useFakeTimers();
  const parent = new AbortController();
  const deadline = linkedDeadline(parent.signal, 100);
  parent.abort();
  expect(deadline.signal.aborted).toBe(true);
  jest.advanceTimersByTime(100);
  expect(deadline.timedOut).toBe(false);

  const alreadyStopped = linkedDeadline(parent.signal, 100);
  expect(alreadyStopped.signal.aborted).toBe(true);
  alreadyStopped.close();

  const other = new AbortController();
  const closed = linkedDeadline(other.signal, 100);
  closed.close();
  expect(closed.signal.aborted).toBe(true);
  jest.advanceTimersByTime(100);
  expect(closed.timedOut).toBe(false);
});

test("an abortable delay ends early on abort and never rejects", async () => {
  jest.useFakeTimers();
  const owner = new AbortController();
  const done = jest.fn();
  void abortableDelay(1000, owner.signal).then(done);
  await jest.advanceTimersByTimeAsync(500);
  expect(done).not.toHaveBeenCalled();
  owner.abort();
  await jest.advanceTimersByTimeAsync(0);
  expect(done).toHaveBeenCalled();
});

test("untilAborted returns the task, or undefined once cancelled", async () => {
  await expect(
    untilAborted(Promise.resolve(1), new AbortController().signal),
  ).resolves.toBe(1);
  const owner = new AbortController();
  const pending = untilAborted(new Promise<number>(() => {}), owner.signal);
  owner.abort();
  await expect(pending).resolves.toBeUndefined();
});
