const { defineConfig } = require("eslint/config");
const expo = require("eslint-config-expo/flat");
module.exports = defineConfig([
  expo,
  {
    ignores: ["android/**", "dist/**", "coverage/**", ".claude/**"],
  },
  {
    // Names say what they hold: no single-letter identifiers, including
    // loop counters, callback parameters and style sheets.
    rules: {
      "id-length": ["error", { min: 2, properties: "never" }],
    },
  },
]);
