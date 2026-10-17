# 架构与边界

Expo Router 仅提供薄入口，src/App.tsx 维护四个底部页面和来源表单。使用 React 状态，不引入额外全局状态框架。底层状态只存 SQLite，UI 的结果快照由 revision 触发重查。

- domain/m3u：异步解析、资源上限、重复/坏行统计；不自动探测频道。
- domain/url：HTTP(S) 输入检查，只拒绝显式危险目标；不是 DNS/重定向/原生请求防火墙。
- data/importIO：expo/fetch 流式计数，2 MiB 解码输入上限；10 秒连接、15 秒停滞、60 秒总预算；AbortController 清理。UTF-8 严格解码。文件通过系统选择器缓存副本逐块读取，再删除该副本。
- data/repository：SQLite 迁移，独占事务连接，显式启用 foreign_keys；保存文件源的文本到私有数据库；频道按每批 90 行多行 INSERT 写入。刷新 generation + revision 双重检查，删除不会被旧请求复活。保留被收藏/最近引用的失效条目。
- features/player/playbackController：纯 TS 播放意图与会话控制；网络检查、移动数据确认、初始超时、后台暂停、手动重试。
- features/player/NativeAttempt：每次尝试新建空 expo-video 实例，订阅事件后才附加来源。退出或换台释放，旧事件受 attempt guard 限制。
- features/player/PlayerScreen：原生视频画面、自定义竖屏/全屏控件、频道面板、方向策略恢复、安全区；全屏沉浸式隐藏系统栏，轻触显隐控件，播放中 4 秒自动隐藏（TalkBack 时不隐藏）。
- App：计费网络规则与播放共用 mightUseMobileData；一次确认保持到连回 Wi-Fi。收藏切换只局部更新列表；三个列表标签各自恢复滚动位置。

## 网络许可

平台支持明文 HTTP，应用首次联网前弹出完整风险说明。用户拒绝时 URL 下载和播放器实例源加载均不进行。设置可撤销许可，取消当前导入并卸载播放页。

此设计不是 HTTPS-only 开关。HTTPS 主地址仍可能引入 HTTP 子清单、分片、密钥或重定向。原生 HLS 不经过 JS fetch，无法宣称所有层级被拦截。不得用于自动接受陌生目录的公开分发场景。TLS 证书校验保持平台默认，从未设置信任全部证书。

## 隐私

plugins/withPrivacy.js 写入 allowBackup=false、dataExtractionRules（cloud-backup 与 device-transfer 排除全部数据域）和 fullBackupContent（Android 11 及以下）。Android 12+ 的设备间迁移不受 allowBackup 控制，必须靠 dataExtractionRules。


无统计/广告/错误上报，不加载远程台标，不默认订阅任何节目源。Android allowBackup=false；应继续在三星真机验证厂商备份和迁移路径。源地址含令牌时仅出现在用户编辑链接字段和私有 SQLite，不写日志、列表或错误详情。

## 原型对应

Figma：https://www.figma.com/design/5oX9LZla0jzHQevtEEFpLc

- 2:1046 → 添加链接表单；2:1081 → 系统文件导入
- 2:1110 → 统计预览/确认事务；2:1155 → 保留输入的内联错误
- 2:1186 → 收藏；2:1242 → 频道；2:1388 → 最近
- 2:1469 → 竖屏播放；2:1668 → 横屏控件；2:1621 → 底部选台
- 2:1696 → 设置；2:1735 → 来源管理；2:1784 → 命名删除确认
- HTTP 示例原型被扩展为真实的应用级知情联网许可，避免虚假的原生子请求安全承诺。

Figma 中的固定模拟视频不作为真实播放内容。收藏插画是节点 2:1207 导出的自有设计资产；UI 文本、颜色与 48dp 触控来自设计变量，使用平台中文字体适应字体缩放。
