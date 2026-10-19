import React from "react";
import { ConsentDialog } from "./ConsentDialog";
import { RISK } from "./confirm";

/**
 * Informed consent for going online, in two layers: three short lines that
 * cover what matters (the server sees your IP, HTTP can be read or altered,
 * it can be revoked), and the full text one tap away. Nothing is left out;
 * it is only folded. On mobile data a fourth line makes the same tap also
 * the mobile-data confirmation, so a first play asks once, not twice.
 */
export function NetworkConsentDialog({
  visible,
  cellular,
  onAnswer,
}: {
  visible: boolean;
  /** The device may be on mobile data and the user asked to be warned. */
  cellular: boolean;
  onAnswer: (allowed: boolean) => void;
}) {
  return (
    <ConsentDialog
      visible={visible}
      request={{
        title: "允许联网读取节目来源？",
        points: [
          "来源服务器会看到你的 IP",
          "HTTP 内容可能被窃听或篡改",
          ...(cellular ? ["当前可能在用移动数据，会消耗流量"] : []),
          "随时可在设置里撤销",
        ],
        details: RISK,
        actions: [
          { label: "不用了", value: "deny" },
          { label: "允许", value: "allow" },
        ],
        dismissValue: "deny",
      }}
      onAnswer={(value) => onAnswer(value === "allow")}
    />
  );
}
