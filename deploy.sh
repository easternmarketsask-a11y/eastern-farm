#!/usr/bin/env bash
# ============================================================
# Eastern Farm — 一键部署到 farm.easternmarket.ca
# ------------------------------------------------------------
# 用法:
#   bash deploy.sh                ← 自动提交未保存改动并部署
#   bash deploy.sh "改了世界杯顶栏"  ← 用你的说明作为提交信息
#
# 它做的事(一条命令全包):
#   1. 把当前分支所有未提交改动提交
#   2. 推送当前分支(备份)
#   3. 快进推送到 main → GitHub Pages 自动上线
# 不会切换你的分支、不会把你留在 main 上。
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-deploy: $(date '+%Y-%m-%d %H:%M')}"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "▶ 当前分支: $BRANCH"

# 1. 提交未保存的改动(如果有)
if [ -n "$(git status --porcelain)" ]; then
  echo "▶ 提交未保存改动: $MSG"
  git add -A
  git commit -m "$MSG"
else
  echo "▶ 工作区干净,无需提交"
fi

# 2. 推送当前分支(备份/留痕)
echo "▶ 推送分支 $BRANCH …"
git push origin "$BRANCH"

# 3. 部署:快进推送到 main(Pages 从 main 上线)
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
echo "✅ 部署完成!GitHub Pages 正在构建(约 1–2 分钟生效)。"
echo "   农场:   https://farm.easternmarket.ca"
echo "   观赛台: https://farm.easternmarket.ca/worldcup.html"
echo "   部署记录: https://github.com/easternmarketsask-a11y/eastern-farm/deployments"
echo ""
echo "提示: iPhone 上若看到旧版,删除主屏 App 重新添加,清一次 PWA 缓存。"
