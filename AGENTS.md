# 静看工程约定

- 本仓库是个人自用 Android IPTV 客户端。不要加入广告、遥测、账号、后台服务或默认远程节目源。
- 使用 Expo SDK 58 配套 React Native 0.88。依赖精确固定并提交 package-lock.json，不独立升级原生模块。
- 每次修改后运行 npm run typecheck、npm run lint、npm test -- --runInBand。交付前额外运行 npm run build:bundle 与 Android 构建；无环境条件必须记录未运行项。
- 原生目录由 expo prebuild 生成；原生策略只能修改 app.json / plugins，不手改生成目录。
- 所有远程导入和播放必须先获应用内的知情许可，包括 HTTPS 主链接。HTTP 为打包时能力，不伪称 JS 能隔离原生 HLS 子请求。
- 不记录完整 URL、令牌、原始节目单、观看历史。不要请求远程台标。
- SQLite 是持久数据唯一来源。导入/刷新是事务；可靠 tvg-id 或完整 URL 维持稳定身份，不用名字猜匹配。
- 播放尝试独占一个原生实例；销毁旧实例，忽略旧异步回调。未知原生错误只允许手动重试。
- Git 与发布包排除 node_modules、原生构建目录、APK、密钥、凭证与真实节目源令牌。
- 构建成功、HTTP 200、ffmpeg 解码和三星真机播放是不同证据，必须分开说明。
