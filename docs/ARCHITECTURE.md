# 架构与边界

Expo Router 仅提供薄入口，src/App.tsx 只组合首页；状态与流程按职责放在 features/home 的 hook 里：useAppSettings（打开数据库、设置、联网许可与移动网络确认）、useChannelListData（分页读取与各标签滚动位置）、usePlayback（播放、换台队列、上一个频道）、useSourceImport（导入与刷新表单）、useSourceTasks（可用性检测、语言补全）、useChannelActions（收藏、最近观看）、useDataControls（删除来源、撤销许可、清空），界面由 ChannelListPage、SourceDialogs、HomePlayer 承担。其余界面拆在 features/source（表单、来源管理及其 SourceCard、RenameSourceModal；可用性检测分为 streamProbe 单地址探测、playlistProbe 节目单解析、availability 并发扫描与 availabilityCoordinator 缓存与队列）、features/settings、features/channel（列表头、空状态、底部导航）与 features/common（确认框、风险说明）。domain/channelLabels 负责分组拆分翻译与频道名标记，domain/channelSources 负责可靠频道归组和显式清晰度排序。数据层 src/data/repository.ts 是对外入口，实现分在 sql（接口与错误）、schema（版本迁移）、channelSql（查询片段、行映射、批量写入）、channelReads（只读查询）、channelLibrary（收藏与最近观看写入）与 channelRepository（仓库类，写操作统一经 transaction 串行进入独占事务）。src/lib 放与业务无关的可复用工具：abort（父信号联动的超时 linkedDeadline、可中断等待、untilAborted）与 streamHead（只读响应体前 N 字节）；网络请求统一用它们处理超时与取消。通用界面组件在 components/ui，其中 ErrorNotice 统一“错误提示 + 关闭提示”。数据库 schema v6（检测结果、分组规范化、国家/地区／语言元数据、逻辑频道组与清晰度，以及逻辑频道级收藏／最近迁移）。使用 React 状态，不引入额外全局状态框架。底层状态只存 SQLite，UI 的结果快照由 revision 触发重查。

- domain/m3u：异步解析、资源上限、重复/坏行统计；只读取显式清晰度属性或严格 iptv-org 清晰度后缀，不从名称猜测，也不自动探测频道。
- domain/url：HTTP(S) 输入检查，只拒绝显式危险目标（私网/本机地址、Fetch bad port 与常见局域网服务端口；81/82/85/98 等流媒体端口放行）；不是 DNS/重定向/原生请求防火墙。
- data/importIO：expo/fetch 流式计数，2 MiB 解码输入上限；10 秒连接、15 秒停滞、60 秒总预算；AbortController 清理。UTF-8 严格解码。文件通过系统选择器缓存副本逐块读取，再删除该副本。
- data/repository：SQLite 迁移，独占事务连接，显式启用 foreign_keys；保存文件源的文本到私有数据库；频道批量写入。可靠同频道在列表查询中折叠为一个有效的低清代表项，真实地址仍逐条保存并可供检测和播放切换。收藏与最近按 groupKey 存储，最近另记最后实际播放的 channelId；列表查询用 JOIN 读取组状态，不再为每行执行收藏／最近关联子查询。刷新 generation + revision 双重检查，删除不会被旧请求复活。
- features/player/playbackController：纯 TS 播放意图与会话控制；网络检查、移动数据确认、初始超时、后台暂停、手动重试。
- features/player/streamFormat：按后缀判定 hls/dash；后缀不明时在尝试内做一次 Range 0-1023、最多 1 KiB、8 秒的格式探测，失败回落 auto。
- features/player/NativeAttempt：每次尝试新建空 expo-video 实例，订阅事件后才附加来源（先经 streamFormat 判定 contentType）。关闭 expo-video 原生控制（nativeControls=false），播放、暂停和时间轴由应用叠加控件驱动；手动暂停保留当前实例，退出、换台、错误重试或后台暂停才释放，旧事件受 attempt guard 限制。
- features/player/PlayerScreen：视频画面全宽无圆角；ChannelSession / FullscreenBars 绘制唯一一层叠加控件（中央固定三键、竖屏角落按钮、全屏顶栏与底栏、来源弹出列表），布局见 DEV_SPEC“全屏与旋转”。频道面板、方向策略恢复和安全区仍由页面负责。
- App：计费网络规则与播放共用 mightUseMobileData；一次确认保持到连回 Wi-Fi。收藏切换只局部更新列表；三个列表标签各自恢复滚动位置。

## 网络许可

平台支持明文 HTTP，应用首次联网前弹出完整风险说明。用户拒绝时 URL 下载和播放器实例源加载均不进行。设置可撤销许可，取消当前导入并卸载播放页。

此设计不是 HTTPS-only 开关。HTTPS 主地址仍可能引入 HTTP 子清单、分片、密钥或重定向。原生 HLS 不经过 JS fetch，无法宣称所有层级被拦截。不得用于自动接受陌生目录的公开分发场景。TLS 证书校验保持平台默认，从未设置信任全部证书。

## 隐私

plugins/withPrivacy.js 写入 allowBackup=false、dataExtractionRules（cloud-backup 与 device-transfer 排除全部数据域）和 fullBackupContent（Android 11 及以下）。Android 12+ 的设备间迁移不受 allowBackup 控制，必须靠 dataExtractionRules。


无统计/广告/错误上报，台标默认关闭，单独许可和节目来源联网许可齐备时加载有效 HTTPS 主地址，原生重定向受平台能力限制，不默认订阅任何节目源。Android allowBackup=false；应继续在三星真机验证厂商备份和迁移路径。源地址含令牌时仅出现在用户编辑链接字段和私有 SQLite，不写日志、列表或错误详情。

## 原型对应

Figma：https://www.figma.com/design/5oX9LZla0jzHQevtEEFpLc

- 2:1046 → 添加链接表单；2:1081 → 系统文件导入
- 2:1110 → 统计预览/确认事务；2:1155 → 保留输入的内联错误
- 2:1186 → 收藏；2:1242 → 频道；2:1388 → 最近
- 2:1469 → 竖屏播放；2:1668 → 横屏控件；2:1621 → 底部选台
- 2:1696 → 设置；2:1735 → 来源管理；2:1784 → 命名删除确认
- HTTP 示例原型被扩展为真实的应用级知情联网许可，避免虚假的原生子请求安全承诺。

Figma 中的固定模拟视频不作为真实播放内容。收藏插画是节点 2:1207 导出的自有设计资产；UI 文本、颜色与 48dp 触控来自设计变量，使用平台中文字体适应字体缩放。

## 维度筛选与地区推荐

channelFacets 规范化明确的 tvg-country/country、tvg-language/language 元数据。group-title 仍为内容分类；每个维度内任一标签命中，维度间取交集。缺失值显示“未标注”，每个菜单的“全部”只清除该维度。Repository.listFacets 按完整活动来源生成选项，不随搜索或其他维度收缩。v3 迁移不猜测旧频道，保留身份、收藏和最近，手动刷新时才补元数据。

features/region 将纯证据决策、原生适配、SQLite 偏好分开。设备地区和时区须一致才作为本机推荐，语言不是国籍证据；获准后才用 ipapi.co/country/ 和前台单次位置交叉核对，冲突回退全部。手选全部也记为 manual。异步识别在手选、后台、撤销、清空或卸载时失效，不保存 IP/坐标/原始响应，不开启后台服务。

官方接口参考：[Expo Localization](https://docs.expo.dev/versions/latest/sdk/localization/)、[Expo Location](https://docs.expo.dev/versions/latest/sdk/location/)、[ipapi 字段接口](https://ipapi.co/api/)、[IANA 多地区时区表](https://data.iana.org/time-zones/tzdb/zone1970.tab)。
