# 静看 · 个人 Android IPTV

给三星 Galaxy S25 Ultra 做的安静播放器：无应用广告、无账号、无后端，节目源、收藏和观看记录留在本机。

## 当前交付状态

正式候选版本为 1.0.0（构建 2），面向个人 Android 手机使用。TypeScript、ESLint、43 组 383 项自动测试通过；构建及设备证据见 docs/TEST_REPORT.md。签名、安装迁移和真机放行步骤见 [发布说明](docs/RELEASE.md)。

本机已生成可独立安装的 APK，使用 Android Debug 测试签名；它不是正式分发签名包。三星 S25 Ultra 真机、长时间播放和真实定位/IP 服务验收仍需分别验证，构建成功不能替代这些证据。

真实来源另行做过云端清单/分片读取与 ffmpeg 解码：Apple 官方控制样本、CGTN Global Biz、DAAI TV 解码约 20 秒成功；CCTV-4 America 在云网络返回 502。两路真实频道有时间戳警告，需要真机看音画同步。详见 docs/stream-tests/REPORT.md。这不是本应用实际播放通过的证明。

## 已实现

- M3U/TXT HTTP(S) 链接或系统文件导入；8 MiB 实际字节限制、UTF-8/GBK 解析、统计预览后确认保存
- 来源选择、国家/地区／语言／内容下拉筛选和中文名称搜索（分组按“;”拆分并中文化，[Geo-blocked] 等标记显示为标签），独立收藏按钮，最近 100 个成功播放频道
- 来源管理中手动“检测可用性”（每频道 1 KiB 请求、8 秒、4 并发，可停止；结果只代表服务器有响应）
- SQLite 事务刷新，稳定频道 ID；消失的收藏保留为失效条目，旧任务不能覆盖新数据或复活已删除来源
- expo-video 原生播放器、暂停/重新连接直播、上一台/下一台、底部选台、横屏全屏与返回优先级
- 沉浸式全屏（隐藏状态栏与导航栏），轻触画面显隐控件，播放中 4 秒自动隐藏，TalkBack 下不自动隐藏
- 换台：全屏上下滑动换台（可反转）、台名浮层、等待计时与慢源提示、可跳过检测不可达的频道；超时或可分类错误尝试同频道备用源，未知原生错误保留手动重试
- 频道页筛选栏吸顶；导入上限 8 MiB，已用 iptv-org 完整列表（11,344 个频道）实测
- 明确联网许可、移动数据提醒（VPN/未知网络按可能计费，确认一次至连回 Wi-Fi）、可选后台播放与系统媒体控制、手动画中画、30 秒初始等待预算、未知错误手动重试
- 备份与换机迁移排除：allowBackup=false + dataExtractionRules（含 device-transfer）+ fullBackupContent
- 来源改名/刷新/命名删除确认；清理观看记录/全部资料；深色薄荷绿界面，48 dp 触控目标
- 设置中手动导出/恢复节目源、收藏和播放偏好；32 MiB 上限、格式校验、事务回滚。未加密文件含地址与令牌；不备份观看记录或联网、台标和地区识别许可
- 关于页面、动态版本与构建号、隐私与权限说明；专属图标和深色启动画面；直播长暂停安全重连

不内置频道，不自动下载列表；台标默认关闭，单独授权后可显示有效 HTTPS 台标，缺图回退首字；不提供版权破解、付费节目授权、录制、EPG、投屏和电视端。

播放器可主动进入系统画中画（需系统允许）；设置中的后台播放默认关闭。开启后切换应用或锁屏继续播放，系统媒体控件可暂停/恢复；关闭时切到后台停止播放，正在使用画中画除外。后台播放会持续消耗流量和电量，不保证系统强制结束进程后继续。备份不携带后台播放开关，恢复后需手动开启。

播放器的音量图标用于静音/取消静音，竖屏、全屏和小窗栏共用同一状态。切换频道、来源或重试不会解除静音；关闭播放器后重置。该按钮不改变系统音量。

可用性检测由全局队列统一调度，按完整播放地址去重，SQLite 中的结果在来源管理、分类列表与播放器来源列表中共用。6 小时内复用成功和失败结果；来源管理中的“重新检测”才会强制刷新。新导入的相同地址继承已有状态，不按频道名称或同组不同地址猜测可用性。仅命中缓存时不进行网络预检查或流量确认；真正检测前仍须联网许可和相应流量确认。可访问只说明主地址返回成功，不是原生解码或直播持续播放的证明。

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
npm run release:test
```

测试入口生成独立发行目录 `release/`，包含 APK、校验和、证书、构建记录及开源许可。未配置正式密钥时使用 Debug 签名；APK 内含 JS bundle，可脱离 Metro 试用。正式打包入口会强制检查密钥、干净工作区、最终 APK 签名和权限。

开发调试可用 npm run android（需要连接设备或模拟器，通常依赖 Metro）。不把 assembleDebug 的结果当作独立正式安装包。原生目录可重新生成，不纳入源码包；配置通过 app.json / plugins 管理。

正式长期安装版需你自己保管 release keystore。密钥和密码不应发到聊天或提交 Git。更换签名不能保证原位升级，卸载会清空本地资料。

```sh
./scripts/create-release-keystore.sh      # 你自己运行，交互输入密码；写入 ~/.jingkan 与 ~/.gradle/gradle.properties
npm run release:check
npm run release:build
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

国家/地区默认推荐交叉核对手机地区、语言和时区；IP 查询（ipapi.co）与前台单次定位分别在应用内授权后使用。手动选择（含全部）优先；证据冲突或当前节目单没有相应国家/地区标注时回退全部。国家/地区、语言仅使用节目单明确提供的属性，旧资料需要手动刷新才能补充，不能从频道名或地址猜测。
