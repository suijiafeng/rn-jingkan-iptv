const { withAndroidManifest } = require("expo/config-plugins");
module.exports = (config) =>
  withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application[0].$;
    app["android:allowBackup"] = "false";
    app["android:usesCleartextTraffic"] = "true";
    return config;
  });
