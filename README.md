# 静看 · 个人 Android IPTV

给三星 Galaxy S25 Ultra 做的安静播放器：无应用广告、无账号、无后端，节目源、收藏和观看记录留在本机。

## 当前交付状态

完整可构建的 Expo / React Native 源码。已经完成 TypeScript、ESLint、114 项自动测试、Android Hermes JS bundle 与 Android 原生工程生成检查。需求规格见 docs/DEV_SPEC.md（v0.2，含与 v0.1 的变更汇总）。

**尚未生成 APK，也没有完成 Android 模拟器或 S25 Ultra 真机播放验收。** 当前云环境没有 Android SDK，安装前需接受 Google Android SDK 条款；不会代替你自动接受。JS bundle 成功不能替代 APK 编译或实际播放验证。

真实来源另行做过云端清单/分片读取与 ffmpeg 解码：Apple 官方控制样本、CGTN Global Biz、DAAI TV 解码约 20 秒成功；CCTV-4 America 在云网络返回 502。两路真实频道有时间戳警告，需要真机看音画同步。详见 docs/stream-tests/REPORT.md。这不是本应用实际播放通过的证明。

## 已实现

- M3U HTTP(S) 链接或系统文件导入；2 MiB 实际字节限制、UTF-8 严格解析、统计预览后确认保存
- 来源/分组/中文名称筛选（分组按“;”拆分并中文化，[Geo-blocked] 等标记显示为标签），独立收藏按钮，最近 100 个成功播放频道
- 来源管理中手动“检测可用性”（每频道 1 KiB 请求、8 秒、4 并发，可停止；结果只代表服务器有响应）
- SQLite 事务刷新，稳定频道 ID；消失的收藏保留为失效条目，旧任务不能覆盖新数据或复活已删除来源
- expo-video 原生播放器、暂停/重新连接直播、上一台/下一台、底部选台、横屏全屏与返回优先级
- 沉浸式全屏（隐藏状态栏与导航栏），轻触画面显隐控件，播放中 4 秒自动隐藏，TalkBack 下不自动隐藏
- 明确联网许可、移动数据提醒（VPN/未知网络按可能计费，确认一次至连回 Wi-Fi）、后台停止/释放、30 秒初始等待预算、未知错误手动重试
- 备份与换机迁移排除：allowBackup=false + dataExtractionRules（含 device-transfer）+ fullBackupContent
- 来源改名/刷新/命名删除确认；清理观看记录/全部资料；深色薄荷绿界面，48 dp 触控目标

不内置频道，不自动下载列表或台标；不提供版权破解、付费节目授权、录制、后台播放、EPG、投屏和电视端。

## 开发与验证

版本来自 Expo 58.0.14 的 bundledNativeModules.json，精确依赖见 package.json，完整锁定见 package-lock.json。

- Node 24.19.0 / npm 11.9.0
- Expo 58.0.14 / React Native 0.88.0 / React 19.3.0 / expo-navigation-bar 58.0.4
- expo-video 58.0.11 / expo-sqlite 58.0.13
- TypeScript 6.0.3 / Jest 30.5.2 / jest-expo 58.0.11 / RNTL 14.1.0
- 原生生成配置：Gradle 9.4.1、compileSdk 37、targetSdk 36、minSdk 24、NDK 27.1.12297006。手机实际 Android/One UI 版本仍待记录。

```sh
npm ci
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build:bundle
npx expo install --check
```

仓库提供 GitHub Actions 检查文件，但没有创建远程仓库或声称 CI 已实际运行。

## 生成本地测试 APK

在已安装且已接受条款的 Android SDK 环境中运行；需要 JDK 21、上面的 SDK/NDK 配套版本。Android Studio 的 SDK Manager 可准备环境。设置 ANDROID_HOME 与 PATH 后：

```sh
npm ci
npm run prebuild
cd android
./gradlew assembleRelease
```

默认 Expo 模板的 release variant 使用测试/debug 签名配置，生成的 APK 含 JS bundle，可脱离 Metro 试用，**不是正式分发签名包**。路径为 android/app/build/outputs/apk/release/app-release.apk。

开发调试可用 npm run android（需要连接设备或模拟器，通常依赖 Metro）。不把 assembleDebug 的结果当作独立正式安装包。原生目录可重新生成，不纳入源码包；配置通过 app.json / plugins 管理。

正式长期安装版需你自己保管 release keystore。密钥和密码不应发到聊天或提交 Git。更换签名不能保证原位升级，卸载会清空本地资料。

```sh
./scripts/create-release-keystore.sh      # 你自己运行，交互输入密码；写入 ~/.jingkan 与 ~/.gradle/gradle.properties
cd android && ./gradlew assembleRelease -PjingkanRequireReleaseKey=true
```

未配置密钥时 release 包会用 debug 密钥签名并在构建日志警告；加 `-PjingkanRequireReleaseKey=true` 时缺少密钥直接失败。请备份 keystore 和密码。

## 第一次使用

1. 打开“添加节目单”，粘贴你信任且有权访问的 M3U 目录，或选择本地文件。
2. 首次联网前阅读并明确同意风险说明。拒绝时不会联网读取或播放。
3. 查看有效/重复/忽略记录，确认保存后再选择频道播放。
4. 可以收藏常看频道；设置中管理来源和撤销联网许可。

fixtures/example.m3u 是自有结构测试夹具，example.com 地址是占位符，不能播放。测试报告中的真实 URL 不会预置进应用。

## 必须知道的网络边界

平台允许 HTTP；用户知情许可是整个应用的联网许可，**不是 HTTPS-only 开关**。HTTPS 主链接仍可能引用明文子清单、分片、密钥或重定向。expo-video 的原生 HLS 请求不经过 JS 下载函数，因此本版本不声称能够阻断所有 DNS/重定向/内网请求。只使用可信来源。TLS 证书验证没有关闭。

撤销联网许可会取消本应用导入并释放播放实例，但仍需真机确认原生请求实际停止时序。应用不打印来源令牌或观看记录，无遥测，Android allowBackup=false，并通过 dataExtractionRules 排除云备份与设备间迁移（Android 12+ 的 Smart Switch 走这条路径）；仍需真机确认。

## 仍需真机验收

实际首帧与声音、连续播放、弱网与切台、明文 HLS 子资源、证书失败、来电/耳机/蓝牙音频焦点、旋转与方向锁、字体放大/TalkBack、三星省电、60 分钟内存耗电，以及数据库升级/杀进程恢复。完整清单见 docs/TEST_REPORT.md。

设计：[Figma 静看](https://www.figma.com/design/5oX9LZla0jzHQevtEEFpLc)。架构及映射见 docs/ARCHITECTURE.md。
