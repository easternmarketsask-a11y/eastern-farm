#!/usr/bin/env bash
# ============================================================
# Eastern Farm — 一键部署到 farm.easternmarket.ca
# ------------------------------------------------------------
# 用法:
#   bash deploy.sh                ← 自动提交未保存改动并部署
#   bash deploy.sh "改了世界杯顶栏"  ← 用你的说明作为提交信息
#   SKIP_SMOKE=1 bash deploy.sh   ← 跳过无头浏览器冒烟(应急用)
#
# 它做的事(一条命令全包):
#   1. 自动把 service-worker.js 的 CACHE_VERSION 注入部署时间戳
#      (不再手动 +1;忘 bump = 全体 PWA 用户静默停在旧版)
#   2. 发布闸门: 全部 JS 语法检查 + 无头 Chrome 冒烟启动
#      (有未捕获异常 → 中止部署,防止 AI 改坏没人发现直接上线)
#   3. 把当前分支所有未提交改动提交
#   4. 推送当前分支(备份)
#   5. 快进推送到 main → GitHub Pages 自动上线
# 不会切换你的分支、不会把你留在 main 上。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-deploy: $(date '+%Y-%m-%d %H:%M')}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "▶ 当前分支: $BRANCH"

# 0. 自动注入 Service Worker 缓存版本号(时间戳,永远递增)
STAMP="ef-$(date '+%y%m%d%H%M')"
sed -i "s/^const CACHE_VERSION = '[^']*';/const CACHE_VERSION = '${STAMP}';/" service-worker.js
if ! grep -q "CACHE_VERSION = '${STAMP}'" service-worker.js; then
  echo "✗ SW 版本号注入失败(service-worker.js 里找不到 CACHE_VERSION 行?) —— 部署中止"
  exit 1
fi
echo "▶ SW 缓存版本: ${STAMP}"

# 0b. 把同一构建号烙进两个页面的 <meta ef-build>（PWA 新鲜度守卫据此判断本页是否过期）
for hf in src/index.html src/worldcup.html; do
  sed -i "s/\(<meta name=\"ef-build\" content=\"\)[^\"]*\(\">\)/\1${STAMP}\2/" "$hf"
  if ! grep -q "name=\"ef-build\" content=\"${STAMP}\"" "$hf"; then
    echo "✗ 构建号注入失败($hf 里找不到 ef-build meta?) —— 部署中止"
    exit 1
  fi
done
echo "▶ 页面构建号: ${STAMP}"

# 1. 发布闸门 A: 全部 JS 语法检查(快、零依赖,AI 改坏最常见的一类错误)
echo "▶ 闸门 A: JS 语法检查…"
for f in src/js/*.js service-worker.js; do
  if ! node --check "$f" 2>/tmp/deploy_synerr; then
    echo "✗ 语法错误: $f"
    cat /tmp/deploy_synerr
    echo "—— 部署中止(SW 版本号已改动,修好后直接重跑本脚本即可)"
    exit 1
  fi
done
echo "  ✓ $(ls src/js/*.js | wc -l | tr -d ' ') 个模块全部通过"

# 2. 发布闸门 B: 无头 Chrome 冒烟启动(游戏能开、无未捕获异常)
#    依赖: node + Chrome + python(起本地静态服务)。缺任一 → 跳过并大声警告。
CHROME_EXE="/c/Program Files/Google/Chrome/Application/chrome.exe"
PYCMD=""
if command -v py >/dev/null 2>&1; then PYCMD="py -3";
elif command -v python >/dev/null 2>&1; then PYCMD="python";
elif command -v python3 >/dev/null 2>&1; then PYCMD="python3"; fi

if [ "${SKIP_SMOKE:-}" = "1" ]; then
  echo "⚠ 闸门 B: 已按 SKIP_SMOKE=1 跳过冒烟测试"
elif [ ! -f "$CHROME_EXE" ] || [ -z "$PYCMD" ]; then
  echo "⚠ 闸门 B: 缺 Chrome 或 python,跳过冒烟测试(仅语法检查兜底)"
else
  echo "▶ 闸门 B: 无头 Chrome 冒烟测试(约 10 秒)…"
  $PYCMD -m http.server 8137 --bind 127.0.0.1 >/dev/null 2>&1 &
  SRV_PID=$!
  trap 'kill $SRV_PID 2>/dev/null || true' EXIT
  sleep 1
  SMOKE_OUT="$(mktemp)"
  node scripts/verify/cdp.mjs "http://127.0.0.1:8137/src/" "" 6000 >"$SMOKE_OUT" 2>/dev/null || true
  kill $SRV_PID 2>/dev/null || true
  trap - EXIT
  if ! node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (o.exceptions.length) {
      console.error("✗ 未捕获异常 " + o.exceptions.length + " 条:");
      o.exceptions.slice(0, 6).forEach(e => console.error("  - " + String(e).split("\n")[0]));
      process.exit(1);
    }
    if (o.consoleErrors.length) {
      console.log("⚠ console 报错/警告 " + o.consoleErrors.length + " 条(不阻断,供参考):");
      o.consoleErrors.slice(0, 4).forEach(e => console.log("  - " + e.text));
    }
    console.log("  ✓ 冒烟通过:游戏正常启动,无未捕获异常");
  ' "$SMOKE_OUT"; then
    echo "—— 部署中止。修好后重跑;确认是误报可 SKIP_SMOKE=1 bash deploy.sh 跳过"
    exit 1
  fi
fi

# 3. 提交未保存的改动(如果有;SW 版本注入保证至少有它)
if [ -n "$(git status --porcelain)" ]; then
  echo "▶ 提交未保存改动: $MSG"
  git add -A
  git commit -m "$MSG"
else
  echo "▶ 工作区干净,无需提交"
fi

# 4. 推送当前分支(备份/留痕)
echo "▶ 推送分支 $BRANCH …"
git push origin "$BRANCH"

# 5. 部署:快进推送到 main(Pages 从 main 上线)
if [ "$BRANCH" != "main" ]; then
  echo "▶ 部署到 main(快进推送)…"
  if ! git push origin "HEAD:main"; then
    echo ""
    echo "✗ main 无法快进 —— 说明 main 上有本分支没有的改动。"
    echo "  修复: git fetch origin && git merge origin/main   (解决冲突后重跑本脚本)"
    exit 1
  fi
fi

echo ""
echo "✅ 部署完成!GitHub Pages 正在构建(约 1–2 分钟生效)。SW 版本 ${STAMP} 会让"
echo "   已装 PWA 在下次打开时自动刷新,无需手动清缓存。"
echo "   农场:   https://farm.easternmarket.ca"
echo "   观赛台: https://farm.easternmarket.ca/worldcup.html"
echo "   部署记录: https://github.com/easternmarketsask-a11y/eastern-farm/deployments"
