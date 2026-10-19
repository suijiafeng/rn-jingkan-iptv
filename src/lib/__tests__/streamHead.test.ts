import { readStreamHead } from "../streamHead";

function body(chunks: number[][]) {
  const queue = chunks.map((chunk) => new Uint8Array(chunk));
  const cancel = jest.fn(() => Promise.resolve());
  return {
    cancel,
    stream: {
      getReader: () => ({
        read: async () =>
          queue.length
            ? { done: false, value: queue.shift()! }
            : { done: true, value: undefined },
        cancel,
      }),
    } as unknown as ReadableStream<Uint8Array>,
  };
}

test("stops at the limit across chunks and cancels the rest", async () => {
  const source = body([[1, 2], [3, 4, 5], [6]]);
  const head = await readStreamHead(source.stream, 4);
  expect([...head.bytes]).toEqual([1, 2, 3, 4]);
  expect(head.ended).toBe(false);
  expect(source.cancel).toHaveBeenCalled();
});

test("a short body is read whole and marked ended", async () => {
  const head = await readStreamHead(body([[1], [2]]).stream, 10);
  expect([...head.bytes]).toEqual([1, 2]);
  expect(head.ended).toBe(true);
});
