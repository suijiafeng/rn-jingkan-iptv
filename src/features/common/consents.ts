import type { ConsentRequest } from "./ConsentDialog";

/*
 * The separate informed consents besides going online. Each `details` is the
 * complete text and is never shortened; `points` only lead into it.
 */

export const ARTWORK_CONSENT: ConsentRequest<"deny" | "allow"> = {
  title: "显示频道台标？",
  points: [
    "台标图片服务器会看到你的 IP",
    "可能消耗移动数据",
    "随时可在设置里关闭",
  ],
  details:
    "将加载节目单提供的 HTTPS 台标，图片服务器会看到你的访问 IP，可能消耗移动数据。仅用于显示台标，不提供节目封面；缺图或失败时显示频道首字。原生图片请求可能跟随服务端重定向，无法保证后续连接仍是 HTTPS。可随时在设置中关闭。",
  actions: [
    { label: "不用了", value: "deny" },
    { label: "允许显示", value: "allow" },
  ],
  dismissValue: "deny",
};

export const BACKGROUND_CONSENT: ConsentRequest<"deny" | "allow"> = {
  title: "允许后台播放？",
  points: [
    "切走或锁屏后继续联网播放",
    "持续耗电并使用流量",
    "随时可在设置里关闭",
  ],
  details:
    "切换应用或锁屏后仍会继续联网播放，并显示系统媒体控制；这会持续耗电和使用流量。仅在你明确需要时开启。",
  actions: [
    { label: "不用了", value: "deny" },
    { label: "允许后台播放", value: "allow" },
  ],
  dismissValue: "deny",
};

type RegionChoice = "cancel" | "skip" | "allow";
const REGION_ACTIONS: ConsentRequest<RegionChoice>["actions"] = [
  { label: "取消", value: "cancel" },
  { label: "跳过", value: "skip" },
  { label: "允许", value: "allow" },
];

export const IP_CONSENT: ConsentRequest<RegionChoice> = {
  title: "使用访问 IP 辅助识别？",
  points: ["ipapi.co 会看到你的 IP", "应用不保存 IP", "与节目来源联网许可分开"],
  details:
    "应用将访问 ipapi.co 的 HTTPS 国家/地区查询接口。该服务商会看到本次访问 IP，并用它返回国家/地区；应用不保存 IP。此许可只用于国家/地区识别，与节目来源联网许可独立。可跳过并使用手机设置或可选定位。",
  actions: REGION_ACTIONS,
  dismissValue: "cancel",
};

export const LOCATION_CONSENT: ConsentRequest<RegionChoice> = {
  title: "使用手机位置辅助识别？",
  points: [
    "仅在前台取一次大致位置",
    "系统地理编码服务可能联网处理",
    "不保存坐标，没有后台定位",
  ],
  details:
    "仅在前台获取一次大致位置，并使用手机系统的反向地理编码服务查询国家/地区；系统服务可能联网处理位置。坐标不会发给 IP 查询服务，也不会保存。接下来可在系统提示中选择大致位置或拒绝。不启用后台定位，可跳过。",
  actions: REGION_ACTIONS,
  dismissValue: "cancel",
};
