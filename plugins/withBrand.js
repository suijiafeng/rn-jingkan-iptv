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
<group android:scaleX="0.9" android:scaleY="0.9" android:pivotX="512" android:pivotY="512">
<path android:fillColor="#8de5d2" android:strokeColor="#8de5d2" android:strokeWidth="40" android:strokeLineJoin="round" android:pathData="M432,260L672,400L432,540Z"/>
<path android:strokeColor="#8de5d2" android:strokeWidth="26" android:strokeLineCap="round" android:pathData="M312,650H712"/>
<path android:strokeColor="#8de5d2" android:strokeAlpha="0.6" android:strokeWidth="26" android:strokeLineCap="round" android:pathData="M372,710H652"/>
<path android:strokeColor="#8de5d2" android:strokeAlpha="0.3" android:strokeWidth="26" android:strokeLineCap="round" android:pathData="M432,770H592"/>
</group>
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
