# 验证记录

## 2026-10-18 · 首次 APK 与模拟器实测

- 本机 Android SDK + Corretto JDK 21：expo prebuild 后 ./gradlew assembleRelease（仅 arm64-v8a，模板 debug 签名）成功，首次 19 分钟；APK 约 31 MB。
- 模拟器 Medium_Phone（Android 16，arm64，Google APIs）：安装启动正常；导入 iptv-org 中文列表预览 214 可导入 / 2 忽略 / 126 HTTP，与电脑端解析一致；保存后 214 个频道。
- 实测发现并修复两个仅在原生环境出现的问题：
  1. 系统联网验证（Google connectivitycheck）在当前网络不可达，Android 标记 PARTIAL_CONNECTIVITY，expo-network 报 isInternetReachable=false，应用判定“没有可用网络”拒绝导入和播放。改为只有 isConnected=false 或类型 NONE 才算离线。
  2. 空构造的 ExoPlayer 立即进入 ENDED 并发出 playToEnd，控制器显示“节目流已结束”并释放播放器（随后 VideoView 挂载报 “shared object already released”）。改为只有本次尝试已开始播放后才接受结束事件。
- 修复后：CCTV-1 (720p)（HTTP、82 端口）约 3 秒内出画面并显示“正在播放”；横屏全屏进入后状态栏与导航栏隐藏，4 秒后控件自动隐藏。
- 仍未验证：三星 S25 Ultra 真机、声音输出、长时间播放、换台耗时、无后缀 HLS 实际起播、Smart Switch 迁移排除。

## 2026-10-18 · iptv-org 中文列表复验与端口/格式探测修订

- 数据：https://iptv-org.github.io/iptv/languages/zho.m3u（216 条，2026-10-18 下载）。仅为公开列表的可用性观察，不是授权或受控验收基准。
- 本机网络（与手机同 Wi-Fi 的 Mac）逐条请求清单：97 条返回有效清单；53 条 HTTP 错误（403×23、502×19 等）；60 条连接失败。对 97 条用 ffmpeg 解码 8 秒：67 条成功（HTTP 33、HTTPS 34），17 条失败，13 条超时。这不是 App 原生播放结果。
- 修订前应用端口规则会拒绝其中 31 条地址，包括 24 条实测可解码的 CCTV 频道；修订后 216 条中 214 条可导入（剩余为 1 条 rtmp 与 1 条 10080 端口），67 条可解码频道全部可导入。
- 两条无后缀地址（cdn.qd.je/163189/ch8、chu）以 Range 0-1023 请求实测返回 200、Content-Type application/vnd.apple.mpegurl、内容以 #EXTM3U 开头，探测会判定为 hls。
- 新增测试：端口放行/拒绝用例；streamFormat 单元测试（后缀、内容头、Content-Type、错误回落、超时、取消）；NativeAttempt 无后缀地址探测后按探测类型加载、拆除时探测被中止且不加载来源。
- 未运行：真机上上述频道的实际起播、无后缀 HLS 在 ExoPlayer 中的起播。

## 2026-10-18 · 审查后修订（分支 fix/review-followups）

- 本机实际运行：npm ci、typecheck 通过、lint 通过、Jest 9 个套件 114 项通过、build:bundle 通过。
- expo prebuild 后核对 AndroidManifest：allowBackup=false、dataExtractionRules=@xml/jingkan_data_extraction_rules、fullBackupContent=@xml/jingkan_backup_rules、usesCleartextTraffic=true；规则文件已生成。
- 新增测试：250 个频道跨批次导入与刷新保持 ID 和顺序；非结构性 #EXT-X-* 行被忽略。失败注入测试改为在第一批频道写入时失败。
- 未运行：APK 构建、模拟器、S25 Ultra 真机（沉浸式全屏、控件自动隐藏、Smart Switch 迁移排除、VPN 下计费提醒、换台耗时均待测）。全屏控件显隐与计费确认记忆暂无自动化测试。

## 2026-10-17 UTC · 初版

## 已运行

- TypeScript：通过（tsc --noEmit）。
- ESLint：通过，无错误与警告。
- Jest：9 个测试套件、112 项测试通过。
- Android Metro/Hermes bundle：通过，1215 个模块，生成约 2.8 MB HBC。
- Expo Android prebuild：通过，生成原生工程。
- Expo SDK 依赖兼容检查：通过（Dependencies are up to date）；Jest按SDK建议固定为30.5.2。
- 原生清单静态核对：allowBackup=false，usesCleartextTraffic=true，后台播放/PiP 关闭；存储、麦克风、摄像头等权限显式移除。

## 自动测试覆盖

- UTF-8/BOM/CRLF/中文、引号与逗号属性、HLS误输入、坏行、重复身份、字节/行/条目上限、取消。
- 显式内网/loopback/危险 scheme/用户名密码/特殊端口输入拒绝；HTTP 与 HTTPS 都可解析。
- 真实 Node SQLite SQL 执行验证：事务回滚、刷新稳定ID、收藏保留、失效引用、删除竞态、版本冲突、最近100、外键级联。
- 原生数据库适配器使用独立磁盘 SQLite 连接验证 PRAGMA 设置；这是同等 SQL 接口测试，不是 Android expo-sqlite 实机测试。
- RNTL：初始空态、拒绝许可不下载、错误保留输入、预览前不写库、取消导入与晚到响应、文件↔URL切换不污染本地内容。
- 按钮禁用、收藏与播放独立点击、失效频道不可播放。
- 播放纯状态机与 mock expo-video：会话隔离、旧回调、暂停/释放、超时、网络门禁、后台暂停、换台、全屏、返回优先级。
- PlayerScreen integration mock：无许可无源加载、撤销释放、Wi-Fi→移动数据暂停确认、拒绝后不继续、全屏不重建解码器、选台关闭面板且保持全屏。

## 真实视频源测试

独立云环境对 Apple 官方控制流、CGTN Global Biz、DAAI TV、CCTV-4 America 进行有限样本检查。三路获得约20秒 ffmpeg解码证据，一路清单返回502。详情与时间戳见 stream-tests/REPORT.md 和 final-results.json。

这不验证本应用原生播放器或三星手机。Apple视频分支的单独音轨未测；两个真实直播有DTS警告。未提供网络播放保证。

## 尚未运行 / 阻塞

- APK assembleDebug/assembleRelease：尚未成功。环境无 Android SDK；Google SDK条款待用户同意后才能安装。首次 wrapper Java直连下载失败，改用官方Gradle下载和环境代理后已经进入原生Gradle配置；最后一次原生构建明确报错 `SDK location not found`。尚无可安装APK。
- 模拟器：没有 Android SDK/系统镜像，当前未验证 KVM，不宣称已运行。
- S25 Ultra：未连接手机，不知道手机当前 Android/One UI 版本。
- 实际首帧、音频、连续播放、流切换、弱网、TLS错误、混合HTTP HLS、30秒超时后的底层请求停止、后台/锁屏、来电、耳机/蓝牙断连：待测。
- 横屏方向锁恢复、手势/三键导航、开孔、分屏、130%字体与TalkBack：待测。
- 连续60分钟/30次换台的内存温度耗电、冷启动/搜索P95：待测。
- 真机数据迁移、文件提供器权限/缓存删除、厂商备份迁移、进程重建：待测。

## 验收建议

先安装独立测试APK并导入官方控制样本，确认首帧、声音、20秒播放；再测试真实自有来源。每项记录版本、设备系统、时间、网络和结果。遇到源错误先保留目录和收藏，重试或换台；不要把某个来源失效直接归咎于播放器，也不要将HTTP200标成可播放。
