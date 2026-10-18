import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const args = new Set(process.argv.slice(2));
const test = args.has("--test"),
  check = args.has("--check");
const run = (command, parameters = [], options = {}) =>
  execFileSync(command, parameters, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
const json = (file) =>
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
try {
  assert(
    [...args].every((arg) => ["--test", "--check"].includes(arg)),
    "支持 --check 或 --test。",
  );
  const config = json("app.json").expo,
    pkg = json("package.json"),
    lock = json("package-lock.json");
  assert(
    pkg.version === config.version &&
      lock.version === pkg.version &&
      lock.packages[""].version === pkg.version,
    "版本号不一致。",
  );
  assert(
    config.android.package === "com.jingkan.personal" &&
      Number.isSafeInteger(config.android.versionCode) &&
      config.android.versionCode > 1,
    "包名或构建号不符合发布配置。",
  );
  for (const asset of [
    config.icon,
    config.android.adaptiveIcon.foregroundImage,
    config.android.adaptiveIcon.monochromeImage,
  ])
    assert(asset && fs.existsSync(path.resolve(root, asset)), "缺少发布图标。");
  assert(
    config.updates.enabled === false && config.android.allowBackup === false,
    "更新或备份配置不符合发布约定。",
  );
  const [major, minor] = process.versions.node.split(".").map(Number);
  assert(
    major > 24 || (major === 24 && minor >= 13),
    "请使用 Node >=24.13.0 后打包（与 package.json 一致）。",
  );
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(os.homedir(), "Library/Android/sdk");
  assert(
    fs.existsSync(path.join(sdk, "build-tools")),
    "未找到 Android SDK build-tools，请设置 ANDROID_HOME。",
  );
  const versions = fs
    .readdirSync(path.join(sdk, "build-tools"))
    .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const buildTools = path.join(sdk, "build-tools", versions.at(-1) ?? "");
  for (const tool of ["apksigner", "aapt2", "zipalign"])
    assert(fs.existsSync(path.join(buildTools, tool)), `缺少 ${tool}。`);
  // Check only the presence of property names, never print their values.
  const propertiesPath = path.join(
    process.env.GRADLE_USER_HOME || path.join(os.homedir(), ".gradle"),
    "gradle.properties",
  );
  const properties = fs.existsSync(propertiesPath)
    ? fs.readFileSync(propertiesPath, "utf8")
    : "";
  const signed = [
    "STORE_FILE",
    "STORE_PASSWORD",
    "KEY_ALIAS",
    "KEY_PASSWORD",
  ].every((suffix) => {
    const key = `JINGKAN_UPLOAD_${suffix}`;
    return (
      !!process.env[key] ||
      new RegExp(`^${key}\\s*[=:]\\s*.+$`, "m").test(properties)
    );
  });
  assert(
    test || signed,
    "正式签名未配置。请亲自运行 ./scripts/create-release-keystore.sh 并安全备份密钥；release:test 仅生成测试包。",
  );
  const dirty = !!run("git", ["status", "--porcelain"]).trim();
  assert(
    test || !dirty,
    "正式发布必须来自已提交且干净的工作区；请先审阅并提交代码。",
  );
  const revision = run("git", ["rev-parse", "HEAD"]).trim();
  if (check) {
    console.log(
      `发布预检通过：${config.version} (${config.android.versionCode})，${revision.slice(0, 8)}。`,
    );
  } else {
    const output = path.join(
      root,
      "release",
      `${config.version}-${config.android.versionCode}-${test ? "test" : "release"}-${revision.slice(0, 8)}-${Date.now()}`,
    );
    const lockDirectory = path.join(root, ".expo", "jingkan-release.lock");
    fs.mkdirSync(path.dirname(lockDirectory), { recursive: true });
    assert(
      !fs.existsSync(lockDirectory),
      "另一个发布构建正在运行；确认没有进程后再移除 .expo/jingkan-release.lock。",
    );
    fs.mkdirSync(lockDirectory);
    try {
      for (const script of ["check", "build:bundle", "prebuild"])
        run("npm", ["run", script], { stdio: "inherit" });
      run(
        "./gradlew",
        [
          "assembleRelease",
          "jingkanReleaseInventory",
          "--console=plain",
          "-PreactNativeArchitectures=arm64-v8a",
          ...(test ? [] : ["-PjingkanRequireReleaseKey=true"]),
        ],
        { cwd: path.join(root, "android"), stdio: "inherit" },
      );
      assert(
        run("git", ["rev-parse", "HEAD"]).trim() === revision,
        "构建过程中代码提交发生变化，请重新构建。",
      );
      // Copy before inspecting: a parallel manual Gradle command must not replace
      // the APK after verification and silently change the delivered artifact.
      fs.mkdirSync(output, { recursive: true });
      const apk = path.join(
        output,
        `jingkan-${config.version}-${config.android.versionCode}-${test ? "test" : "release"}-arm64.apk`,
      );
      fs.copyFileSync(
        path.join(
          root,
          "android/app/build/outputs/apk/release/app-release.apk",
        ),
        apk,
        fs.constants.COPYFILE_EXCL,
      );
      const signature = run(path.join(buildTools, "apksigner"), [
        "verify",
        "--verbose",
        "--print-certs",
        apk,
      ]);
      assert(
        test || !/CN=Android Debug/i.test(signature),
        "正式构建意外使用 Debug 证书，拒绝交付。",
      );
      const badging = run(path.join(buildTools, "aapt2"), [
        "dump",
        "badging",
        apk,
      ]);
      assert(
        badging.includes(`versionCode='${config.android.versionCode}'`) &&
          badging.includes(`versionName='${config.version}'`) &&
          badging.includes(`name='${config.android.package}'`) &&
          badging.includes("native-code: 'arm64-v8a'"),
        "APK 元数据不匹配。",
      );
      const manifest = run(path.join(buildTools, "aapt2"), [
        "dump",
        "xmltree",
        apk,
        "--file",
        "AndroidManifest.xml",
      ]);
      assert(
        !/android:debuggable[^\n]*=true/.test(manifest),
        "APK 启用了调试。",
      );
      assert(
        /android:allowBackup[^\n]*=false/.test(manifest) &&
          manifest.includes("android:dataExtractionRules"),
        "APK 备份策略缺失。",
      );
      const permissions = run(path.join(buildTools, "aapt2"), [
        "dump",
        "permissions",
        apk,
      ]);
      const allowed = new Set(
        [
          "INTERNET",
          "ACCESS_NETWORK_STATE",
          "ACCESS_WIFI_STATE",
          "WAKE_LOCK",
          "FOREGROUND_SERVICE",
          "FOREGROUND_SERVICE_MEDIA_PLAYBACK",
          "ACCESS_COARSE_LOCATION",
          "ACCESS_FINE_LOCATION",
        ].map((name) => `android.permission.${name}`),
      );
      allowed.add(
        `${config.android.package}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`,
      );
      for (const match of permissions.matchAll(
        /uses-permission: name='([^']+)'/g,
      ))
        assert(allowed.has(match[1]), `APK 出现未审阅权限：${match[1]}`);
      run(path.join(buildTools, "zipalign"), ["-c", "-P", "16", "4", apk]);
      const digest = createHash("sha256")
        .update(fs.readFileSync(apk))
        .digest("hex");
      fs.writeFileSync(
        path.join(output, "SHA256SUMS"),
        `${digest}  ${path.basename(apk)}\n`,
      );
      fs.writeFileSync(path.join(output, "SIGNATURE.txt"), signature);
      fs.writeFileSync(
        path.join(output, "BUILD.json"),
        JSON.stringify(
          {
            version: config.version,
            versionCode: config.android.versionCode,
            package: config.android.package,
            revision,
            dirty,
            test,
            architecture: "arm64-v8a",
            sha256: digest,
            builtAt: new Date().toISOString(),
            node: process.version,
          },
          null,
          2,
        ),
      );
      // Include installed package licenses for all locked packages (including
      // build tools) to avoid silently omitting a transitive component.
      const notices = [
        "静看开源组件发行说明\n",
        "AndroidX / AndroidX Media3 / Kotlin / OkHttp / SQLite: see official project licenses; AndroidX and Media3 use Apache-2.0; SQLite is public domain.\n",
      ];
      const inventory = JSON.parse(
        fs.readFileSync(
          path.join(root, "android/app/build/reports/jingkan-runtime.json"),
          "utf8",
        ),
      );
      const nativeCoordinates = [];
      for (const artifact of inventory) {
        nativeCoordinates.push(artifact.coordinate);
        const [group, module, version] = artifact.coordinate.split(":");
        const cache = path.join(
          process.env.GRADLE_USER_HOME || path.join(os.homedir(), ".gradle"),
          "caches/modules-2/files-2.1",
          group,
          module,
          version,
        );
        if (fs.existsSync(cache))
          for (const hash of fs.readdirSync(cache)) {
            const cacheDirectory = path.join(cache, hash);
            if (!fs.statSync(cacheDirectory).isDirectory()) continue;
            for (const filename of fs
              .readdirSync(cacheDirectory)
              .filter(
                (name) =>
                  /\.(aar|jar)$/.test(name) && !/(sources|javadoc)/.test(name),
              )) {
              const archive = path.join(cacheDirectory, filename);
              const contents = run("unzip", ["-Z1", archive]);
              for (const name of contents
                .split("\n")
                .filter((name) =>
                  /(^|\/)(licen[cs]e|notice|copying)([._-].*)?$/i.test(name),
                )) {
                notices.push(
                  `\n--- ${artifact.coordinate}: ${name} ---\n`,
                  run("unzip", ["-p", archive, name]),
                );
              }
            }
            const pom = path.join(cache, hash, `${module}-${version}.pom`);
            if (fs.existsSync(pom)) {
              const metadata = fs.readFileSync(pom, "utf8");
              const licenses = metadata.match(
                /<licenses>[\s\S]*?<\/licenses>/,
              )?.[0];
              if (licenses)
                notices.push(
                  `\n--- ${artifact.coordinate}: Maven licenses ---\n`,
                  licenses,
                );
            }
          }
      }
      fs.writeFileSync(
        path.join(output, "NATIVE_DEPENDENCIES.txt"),
        nativeCoordinates.join("\n") + "\n",
      );
      for (const [location, entry] of Object.entries(lock.packages).sort(
        ([left], [right]) => left.localeCompare(right),
      )) {
        if (!location.startsWith("node_modules/")) continue;
        const directory = path.join(root, location);
        if (!fs.existsSync(directory)) continue;
        const metadata = JSON.parse(
          fs.readFileSync(path.join(directory, "package.json"), "utf8"),
        );
        notices.push(
          `\n--- ${metadata.name}@${metadata.version} (${entry.license || metadata.license || "see component license"}) ---\n`,
        );
        for (const name of fs
          .readdirSync(directory)
          .filter((name) =>
            /^(licen[cs]e|copying|notice)([.-].*)?$/i.test(name),
          )) {
          const file = path.join(directory, name);
          if (fs.statSync(file).isFile())
            notices.push(fs.readFileSync(file, "utf8"));
        }
      }
      // xcode's installed LICENSE contains the full Apache-2.0 text, also
      // used by the AndroidX libraries. No network fetch during packaging.
      notices.push(
        "\nApache License 2.0 (AndroidX / Media3)\n",
        fs.readFileSync(require.resolve("xcode/LICENSE"), "utf8"),
      );
      fs.writeFileSync(
        path.join(output, "THIRD_PARTY_NOTICES.txt"),
        notices.join("\n"),
      );
      fs.copyFileSync(
        path.join(root, "docs/RELEASE.md"),
        path.join(output, "INSTALL_AND_ACCEPTANCE.md"),
      );
      console.log(
        `已生成${test ? "测试" : "正式签名"}候选发行目录：${output}\nSHA-256: ${digest}\n真机播放验收结果需另行记录。`,
      );
    } finally {
      fs.rmdirSync(lockDirectory);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "发布准备失败");
  process.exitCode = 1;
}
