#!/usr/bin/env bash
# Creates your own release key for 静看 TV and registers it in
# ~/.gradle/gradle.properties (outside the repository, mode 600).
# Run it yourself; passwords are typed here and never echoed or committed.
# BACK UP the keystore and passwords: losing them means future versions can
# no longer upgrade the installed app in place (uninstall wipes local data).
set -euo pipefail
umask 077

STORE="${1:-$HOME/.jingkan/jingkan-release.jks}"
ALIAS="jingkan"
PROPS="$HOME/.gradle/gradle.properties"

if [ -e "$STORE" ]; then
  echo "已存在：$STORE —— 为避免覆盖正式密钥，脚本已停止。" >&2
  exit 1
fi
if [ -f "$PROPS" ] && grep -q '^JINGKAN_UPLOAD_' "$PROPS"; then
  echo "$PROPS 已配置 JINGKAN_UPLOAD_*，请先确认后手动处理。" >&2
  exit 1
fi
KEYTOOL="$(command -v keytool || true)"
if [ -z "$KEYTOOL" ]; then
  KEYTOOL="$(/usr/libexec/java_home -v 21 2>/dev/null)/bin/keytool"
fi
[ -x "$KEYTOOL" ] || { echo "找不到 keytool，请安装 JDK 21。" >&2; exit 1; }

read -r -s -p "设置密钥密码（至少 8 位）: " PASS; echo
read -r -s -p "再输入一次: " PASS2; echo
[ "$PASS" = "$PASS2" ] || { echo "两次输入不一致。" >&2; exit 1; }
[ "${#PASS}" -ge 8 ] || { echo "密码至少 8 位。" >&2; exit 1; }

mkdir -p "$(dirname "$STORE")"
chmod 700 "$(dirname "$STORE")"
export JINGKAN_KS_PASS="$PASS"
"$KEYTOOL" -genkeypair -v -storetype PKCS12 -keystore "$STORE" \
  -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 36500 \
  -dname "CN=Jingkan Personal" \
  -storepass:env JINGKAN_KS_PASS -keypass:env JINGKAN_KS_PASS
unset JINGKAN_KS_PASS
chmod 600 "$STORE"

mkdir -p "$(dirname "$PROPS")"
touch "$PROPS"
chmod 600 "$PROPS"
# Java properties need escaping for backslashes, whitespace and Unicode.
# The password travels through the child environment, never command arguments.
export JINGKAN_KS_PASS="$PASS" JINGKAN_KS_STORE="$STORE" JINGKAN_KS_ALIAS="$ALIAS" JINGKAN_KS_PROPS="$PROPS"
node "$(dirname "$0")/write-signing-properties.cjs"
unset JINGKAN_KS_PASS JINGKAN_KS_STORE JINGKAN_KS_ALIAS JINGKAN_KS_PROPS PASS PASS2

echo "完成：$STORE"
echo "已写入 $PROPS（仅本机可读）。请把 keystore 文件和密码备份到安全的地方。"
echo "之后用 ./gradlew assembleRelease -PjingkanRequireReleaseKey=true 构建正式包。"
