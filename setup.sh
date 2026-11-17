#!/usr/bin/env bash
# Deploy dtsync to Cloudflare from a terminal (the README's "Deploy to Cloudflare" button does
# the same without a terminal). It signs in to Cloudflare, deploys the Worker, sets the admin
# password, and prints the address of the setup page. Logins and calendars are entered there.
#   ./setup.sh
# 从终端把 dtsync 部署到 Cloudflare：登录、部署 Worker、设置管理密码，并显示设置页面地址。
set -euo pipefail
cd "$(dirname "$0")"

WRANGLER="npx --yes wrangler@4"
export WRANGLER_SEND_METRICS=false

case "${DTSYNC_LANG:-${LC_ALL:-${LANG:-}}}" in zh*|ZH*) ZH=1 ;; *) ZH=0 ;; esac
msg() { if [ "$ZH" = 1 ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
say() { printf '\n\033[1m%s\033[0m\n' "$(msg "$1" "$2")"; }
die() { printf '\n%s\n' "$(msg "$1" "$2")" >&2; exit 1; }

command -v node >/dev/null || die "Node.js 20 or newer is required: https://nodejs.org" "需要 Node.js 20 或更高版本：https://nodejs.org"
[ "$(node -p 'Number(process.versions.node.split(".")[0]) >= 20')" = "true" ] || die "Node.js 20 or newer is required, found $(node -v)." "需要 Node.js 20 或更高版本，当前为 $(node -v)。"

$WRANGLER whoami >/dev/null 2>&1 || {
  say "Signing in to Cloudflare (a browser window opens)" "登录 Cloudflare（将打开浏览器窗口）"
  $WRANGLER login
}

say "Admin password for the setup page (at least 8 characters). Leave empty to keep the current one or to have one generated." \
    "设置页面的管理密码（至少 8 个字符）。留空则保留现有密码；若尚未设置，将自动生成。"
read -r -s -p "> " ADMIN_PASSWORD; echo
if [ -n "$ADMIN_PASSWORD" ] && [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
  die "The password needs at least 8 characters." "密码至少需要 8 个字符。"
fi

say "Deploying" "正在部署"
OUT="$(mktemp)"; trap 'rm -f "$OUT"' EXIT
$WRANGLER deploy 2>&1 | tee "$OUT"
URL="$(grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' "$OUT" | head -1 || true)"

GENERATED=""
if [ -z "$ADMIN_PASSWORD" ] && ! $WRANGLER secret list 2>/dev/null | grep -q '"ADMIN_PASSWORD"'; then
  ADMIN_PASSWORD="$(node -e 'console.log(require("crypto").randomBytes(18).toString("base64url"))')"
  GENERATED=1
fi
if [ -n "$ADMIN_PASSWORD" ]; then
  printf '%s' "$ADMIN_PASSWORD" | $WRANGLER secret put ADMIN_PASSWORD >/dev/null
fi

say "Done. Open the setup page and follow the three steps:" "完成。打开设置页面，按三个步骤操作："
echo "  ${URL:-$(msg "(see the address printed by the deployment above)" "（见上方部署输出中的地址）")}"
if [ -n "$GENERATED" ]; then
  echo "  $(msg "Admin password (keep it somewhere safe):" "管理密码（请妥善保存）：") $ADMIN_PASSWORD"
fi
echo "  $(msg "A new Cloudflare timer can take up to 15 minutes to start; the page has a \"Sync now\" button." "Cloudflare 新建的定时任务最多可能需要 15 分钟才开始运行；页面上有“立即同步”按钮。")"
