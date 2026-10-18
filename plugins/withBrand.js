const { withAndroidStyles, withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");
// Android's platform splash uses the launcher mark on 12+. Older devices get
// the same mark centered on a dark window. All generated resources live here.
module.exports = (config) =>
  withDangerousMod(
    withAndroidStyles(config, (mod) => {
      const style = mod.modResults.resources.style.find(
        (entry) => entry.$.name === "Theme.App.SplashScreen",
      );
      if (!style) throw new Error("withBrand: missing splash theme");
      const values = {
        "android:windowBackground": "@drawable/jingkan_splash",
        "android:windowSplashScreenBackground": "#0b1115",
        "android:windowSplashScreenAnimatedIcon": "@drawable/jingkan_mark",
        "android:windowLightStatusBar": "false",
        "android:statusBarColor": "#0b1115",
      };
      style.item = [
        ...(style.item ?? []).filter((entry) => !(entry.$.name in values)),
        ...Object.entries(values).map(([name, value]) => ({
          $: { name },
          _: value,
        })),
      ];
      return mod;
    }),
    [
      "android",
      (mod) => {
        const directory = path.join(
          mod.modRequest.platformProjectRoot,
          "app/src/main/res/drawable",
        );
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(
          path.join(directory, "jingkan_mark.xml"),
          `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="160dp" android:height="160dp" android:viewportWidth="1024" android:viewportHeight="1024">
<path android:strokeColor="#8de5d2" android:strokeWidth="28" android:fillColor="#00000000" android:pathData="M288,284H736Q792,284 792,340V628Q792,684 736,684H288Q232,684 232,628V340Q232,284 288,284Z"/>
<path android:fillColor="#8de5d2" android:pathData="M432,396L616,496L432,596Z"/>
<path android:strokeColor="#8de5d2" android:strokeWidth="28" android:strokeLineCap="round" android:pathData="M436,744H588"/>
</vector>`,
        );
        fs.writeFileSync(
          path.join(directory, "jingkan_splash.xml"),
          `<?xml version="1.0" encoding="utf-8"?><layer-list xmlns:android="http://schemas.android.com/apk/res/android"><item><shape><solid android:color="#0b1115"/></shape></item><item android:drawable="@drawable/jingkan_mark" android:gravity="center"/></layer-list>`,
        );
        return mod;
      },
    ],
  );
