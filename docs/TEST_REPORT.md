# 验证记录 · 2026-10-17 UTC

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
