const fs = require("node:fs");
const process = require("node:process");
const path = require("node:path");
const escapeProperty = (value) =>
  value.replace(
    /[\\\s:=#!\u0080-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
function writeProperties() {
  const target = process.env.JINGKAN_KS_PROPS;
  const values = {
    JINGKAN_UPLOAD_STORE_FILE: process.env.JINGKAN_KS_STORE,
    JINGKAN_UPLOAD_STORE_PASSWORD: process.env.JINGKAN_KS_PASS,
    JINGKAN_UPLOAD_KEY_ALIAS: process.env.JINGKAN_KS_ALIAS,
    JINGKAN_UPLOAD_KEY_PASSWORD: process.env.JINGKAN_KS_PASS,
  };
  if (!target || Object.values(values).some((value) => !value))
    throw new Error("缺少签名配置，未写入。");
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (/^JINGKAN_UPLOAD_/m.test(previous))
    throw new Error("已有签名配置，未覆盖。");
  const temporary = path.join(
    path.dirname(target),
    `.jingkan-signing-${process.pid}.tmp`,
  );
  try {
    fs.writeFileSync(
      temporary,
      `${previous}\n# Jingkan release signing\n${Object.entries(values)
        .map(([key, value]) => `${key}=${escapeProperty(value)}`)
        .join("\n")}\n`,
      { mode: 0o600, flag: "wx" },
    );
    fs.renameSync(temporary, target);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
if (require.main === module) writeProperties();
module.exports = { escapeProperty };
