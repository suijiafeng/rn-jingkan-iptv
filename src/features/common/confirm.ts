import { Alert } from "react-native";

export const RISK =
  "本应用直接连接你选择的服务器，服务器会收到你的 IP 地址与访问请求。未加密（HTTP）内容可能被查看或篡改；即使主链接为 HTTPS，直播的后续请求或重定向也可能未加密。本版本尚不能完全防止域名解析或重定向将请求引向其他地址或局域网设备。请仅使用你信任且有权观看的来源。允许后适用于所有联网导入和播放，可随时在设置中撤销。";

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
