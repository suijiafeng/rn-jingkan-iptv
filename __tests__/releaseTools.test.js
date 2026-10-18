/** @jest-environment node */
const { test, expect } = require("@jest/globals");
const { escapeProperty } = require("../scripts/write-signing-properties.cjs");
test("signing properties escape backslashes, Unicode and password delimiters", () => {
  const secret = " pa:ss=字\\key#!\n";
  const escaped = escapeProperty(secret);
  expect(escaped).not.toMatch(/[\s:=#!字]/);
  expect(
    escaped.replace(/\\u([\da-f]{4})/g, (_match, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    ),
  ).toBe(secret);
});
