const fs = require("fs");
const path = require("path");
const {
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");

// allowBackup=false only stops cloud backup on Android 12+ (targetSdk >= 31);
// device-to-device migration (e.g. Samsung Smart Switch) follows
// dataExtractionRules. Exclude every domain from both, so source URLs with
// tokens, file sources and viewing history never leave this device.
const DOMAINS = [
  "root",
  "file",
  "database",
  "sharedpref",
  "external",
  "device_root",
  "device_file",
  "device_database",
  "device_sharedpref",
];
const excludeAll = (indent) =>
  DOMAINS.map((d) => `${indent}<exclude domain="${d}" path="." />`).join("\n");
const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
${excludeAll("    ")}
  </cloud-backup>
  <device-transfer>
${excludeAll("    ")}
  </device-transfer>
</data-extraction-rules>
`;
// Android 11 and lower read fullBackupContent; device_* domains do not exist there.
const FULL_BACKUP_CONTENT = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
${DOMAINS.filter((d) => !d.startsWith("device_"))
  .map((d) => `  <exclude domain="${d}" path="." />`)
  .join("\n")}
</full-backup-content>
`;

const withBackupRuleFiles = (config) =>
  withDangerousMod(config, [
    "android",
    (config) => {
      const dir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "jingkan_data_extraction_rules.xml"),
        DATA_EXTRACTION_RULES,
      );
      fs.writeFileSync(
        path.join(dir, "jingkan_backup_rules.xml"),
        FULL_BACKUP_CONTENT,
      );
      return config;
    },
  ]);

module.exports = (config) =>
  withBackupRuleFiles(
    withAndroidManifest(config, (config) => {
      const app = config.modResults.manifest.application[0].$;
      app["android:allowBackup"] = "false";
      app["android:dataExtractionRules"] = "@xml/jingkan_data_extraction_rules";
      app["android:fullBackupContent"] = "@xml/jingkan_backup_rules";
      // HTTP is a deliberate v0.2 capability behind in-app informed consent.
      app["android:usesCleartextTraffic"] = "true";
      return config;
    }),
  );
module.exports.DATA_EXTRACTION_RULES = DATA_EXTRACTION_RULES;
module.exports.FULL_BACKUP_CONTENT = FULL_BACKUP_CONTENT;
