import { Alert } from "react-native";

export const RISK =
  "本应用直接连接你选择的服务器，服务器会收到 IP 地址与访问请求。HTTP 内容可能被旁观或篡改；即使主链接为 HTTPS，直播子清单、分片、密钥或重定向也可能使用 HTTP。本版本没有完整的 DNS、重定向与内网隔离保护。仅使用你信任且有权观看的来源。允许后适用于所有联网导入和播放；可随时在设置撤销。";

export const confirm = (
  title: string,
  message: string,
  action = "确认",
): Promise<boolean> =>
  new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: "取消", style: "cancel", onPress: () => resolve(false) },
        { text: action, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
