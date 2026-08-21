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
# 1b. 预缓存清单必须覆盖 index.html 加载的全部模块（漏一个 = 那个模块永远走网络）
if ! node scripts/verify/precache-check.mjs; then
  echo "—— 部署中止(把缺的模块补进 service-worker.js 的 PRECACHE)"
  exit 1
fi
if ! node scripts/verify/iso-heading-test.mjs; then
  echo "—— 部署中止(人/车等距朝向契约)"
  exit 1
fi
if ! node scripts/verify/farmer-look-test.mjs; then
  echo "—— 部署中止(农户形象契约)"
  exit 1
fi
if ! node scripts/verify/farmer-work-test.mjs; then
  echo "—— 部署中止(收割/种植落点与动作契约)"
  exit 1
fi
if ! node scripts/verify/audio-test.mjs; then
  echo "—— 部署中止(音效契约)"
  exit 1
fi
if command -v py >/dev/null 2>&1; then
  if ! py -3 scripts/verify/car-platform-test.py; then
    echo "—— 部署中止(车辆平台贴合草地契约)"
    exit 1
  fi
elif command -v python >/dev/null 2>&1; then
  if ! python scripts/verify/car-platform-test.py; then
    echo "—— 部署中止(车辆平台贴合草地契约)"
    exit 1
  fi
elif command -v python3 >/dev/null 2>&1; then
  if ! python3 scripts/verify/car-platform-test.py; then
    echo "—— 部署中止(车辆平台贴合草地契约)"
    exit 1
  fi
else
  echo "—— 部署中止(车辆平台契约需要 python)"
  exit 1
fi

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
  # 2026-08-15 起注入 smoke-flows.js：不只看开屏，把商店/任务/建造模式/切语言等
  # 二十来个入口各走一遍，任何一步抛异常都算未通过（一次取景改动曾让建造模式
  # 进去就 ReferenceError，旧闸门照样放行上线）
  node scripts/verify/cdp.mjs "http://127.0.0.1:8137/src/" "scripts/verify/smoke-flows.js" 9000 >"$SMOKE_OUT" 2>/dev/null || true
  kill $SRV_PID 2>/dev/null || true
  trap - EXIT
  if ! node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (o.exceptions.length) {
      console.error("✗ 未捕获异常 " + o.exceptions.length + " 条:");
      o.exceptions.slice(0, 6).forEach(e => console.error("  - " + String(e).split("\n")[0]));
      process.exit(1);
    }
    const flows = o.evalResult || {};
    if (!flows.ran || !flows.ran.length) {
      console.error("✗ 冒烟流程一个都没跑起来(evalResult=" + JSON.stringify(o.evalResult) + ")");
      process.exit(1);
    }
    if (flows.failures && flows.failures.length) {
      console.error("✗ 冒烟流程抛异常 " + flows.failures.length + " 步:");
      flows.failures.forEach(f => console.error("  - " + f));
      process.exit(1);
    }
    console.log("  ✓ 冒烟流程 " + flows.ran.length + " 步全部无异常");
    if (o.consoleErrors.length) {
      console.log("⚠ console 报错/警告 " + o.consoleErrors.length + " 条(不阻断,供参考):");
      o.consoleErrors.slice(0, 4).forEach(e => console.log("  - " + e.text));
    }
    console.log("  ✓ 冒烟通过:游戏正常启动,无未捕获异常");
  ' "$SMOKE_OUT"; then
    echo "—— 部署中止。修好后重跑;确认是误报可 SKIP_SMOKE=1 bash deploy.sh 跳过"
    exit 1
  fi

  # 闸门 C: 部署后玩家刷新能不能真的拿到新代码(约 5 秒)
  # 2026-08-15 加：SW 预缓存曾走浏览器 HTTP 缓存(GitHub Pages max-age=600)，把上一版
  # 的文件装进新版本号的缓存里，玩家刷多少次都是旧代码。这一类 bug 静默且每次部署都犯，
  # 所以钉成闸门 —— 它自己起服务器复现 max-age=600 的场景。
  echo "▶ 闸门 C: SW 更新链回归测试(约 5 秒)…"
  if ! node scripts/verify/sw-update-test.mjs; then
    echo "—— 部署中止：部署后玩家刷新拿不到新代码(见上)。别绕过它，这会让所有人卡在旧版本。"
    exit 1
  fi

  # 闸门 D: 开屏「会员登录」按钮真的通往登录(约 12 秒)
  # 2026-08-17 加：这个按钮曾整整坏着而没人发现 —— 玩家在 boot 跑完前点它(手机上
  # 几乎必然，按钮 1.6 秒画出来、window.Farm 要 6 秒)，就被当成「进去逛逛」，
  # 登录弹窗一次都不出现。实测代价是 7 天 462 人进游戏、登录 0 次。
  # 冒烟(闸门 B)抓不到它：那边只看「有没有抛异常」，而这个 bug 一声不吭。
  echo "▶ 闸门 D: 开屏登录按钮回归测试(约 12 秒)…"
  $PYCMD scripts/verify/slow-server.py 8143 3 >/dev/null 2>&1 &
  SLOW_PID=$!
  trap 'kill $SLOW_PID 2>/dev/null || true' EXIT
  sleep 1
  SPLASH_OUT="$(mktemp)"
  node scripts/verify/cdp.mjs "http://127.0.0.1:8143/src/" "scripts/verify/splash-login-test.js" 300 >"$SPLASH_OUT" 2>/dev/null || true
  kill $SLOW_PID 2>/dev/null || true
  trap - EXIT
  if ! node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const r = o.evalResult;
    if (!r) { console.error("✗ 开屏登录测试没跑出结果(evalResult=null)"); process.exit(1); }
    if (r.inconclusive) { console.log("  ⚠ 未测到目标路径: " + r.inconclusive + "(不阻断)"); process.exit(0); }
    if (r.failures && r.failures.length) {
      console.error("✗ 开屏「会员登录」按钮不通往登录:");
      r.failures.forEach(f => console.error("  - " + f));
      process.exit(1);
    }
    console.log("  ✓ boot 前点登录 → 登录弹窗如期打开");
  ' "$SPLASH_OUT"; then
    echo "—— 部署中止：开屏主按钮写着「会员登录」却不通往登录。这条静默失败，别绕过。"
    exit 1
  fi

  # 闸门 E: 登录弹窗每一屏都画得出来、主按钮都绑上了(约 5 秒)
  # 2026-08-17 加：登录改造(手机号/用户名+密码)删掉了三个旧渲染函数。这类改动的
  # 典型伤是「某一屏点进去就 TypeError」，而它只在那屏被打开时发作 —— 闸门 B 走的是
  # 商店/任务那些入口，一个都碰不到登录弹窗。「点了没反应」是本项目反复出现的失败态。
  echo "▶ 闸门 E: 登录弹窗逐屏回归测试(约 5 秒)…"
  $PYCMD -m http.server 8145 --bind 127.0.0.1 >/dev/null 2>&1 &
  AUTH_PID=$!
  trap 'kill $AUTH_PID 2>/dev/null || true' EXIT
  sleep 1
  AUTH_OUT="$(mktemp)"
  node scripts/verify/cdp.mjs "http://127.0.0.1:8145/src/" "scripts/verify/auth-views-test.js" 4000 >"$AUTH_OUT" 2>/dev/null || true
  kill $AUTH_PID 2>/dev/null || true
  trap - EXIT
  if ! node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const r = o.evalResult;
    if (!r || !r.ran || !r.ran.length) {
      console.error("✗ 登录弹窗测试没跑起来(evalResult=" + JSON.stringify(r) + ")");
      process.exit(1);
    }
    if (r.failures && r.failures.length) {
      console.error("✗ 登录弹窗有问题:");
      r.failures.forEach(f => console.error("  - " + f));
      process.exit(1);
    }
    console.log("  ✓ 登录弹窗 " + r.ran.length + " 屏全部正常");
  ' "$AUTH_OUT"; then
    echo "—— 部署中止：登录流程有屏打不开或按钮没绑。别绕过，这直接挡住所有会员。"
    exit 1
  fi

  # 闸门 F: 新手引导指的那块地，手机上真的点得到(约 6 秒)
  # 2026-08-19 加：引导气泡曾压在它自己让你点的地块上(pointer-events:auto)，
  # 玩家照着点毫无反应 —— 7 天 423 次打开，走完引导 0 次。
  # 🔒 必须手机视口：气泡有上/下两种摆法，桌面走「下方」分支一切正常，
  #    正是它长期没被发现的原因，而 100% 的真实顾客在手机上。
  echo "▶ 闸门 F: 新手引导可点性回归测试(手机视口，约 6 秒)…"
  $PYCMD -m http.server 8149 --bind 127.0.0.1 >/dev/null 2>&1 &
  TUT_PID=$!
  trap 'kill $TUT_PID 2>/dev/null || true' EXIT
  sleep 1
  TUT_OUT="$(mktemp)"
  EF_MOBILE=1 node scripts/verify/cdp.mjs "http://127.0.0.1:8149/src/" "scripts/verify/tutorial-tap-test.js" 200 >"$TUT_OUT" 2>/dev/null || true
  kill $TUT_PID 2>/dev/null || true
  trap - EXIT
  if ! node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const r = o.evalResult;
    if (!r) { console.error("✗ 引导可点性测试没跑出结果"); process.exit(1); }
    if (r.inconclusive) { console.log("  ⚠ " + r.inconclusive + "(不阻断)"); process.exit(0); }
    if (r.failures && r.failures.length) {
      console.error("✗ 新手引导指的地方点不到:");
      r.failures.forEach(f => console.error("  - " + f));
      process.exit(1);
    }
    console.log("  ✓ 引导目标可点(命中 " + r.hitAtTarget + ")");
  ' "$TUT_OUT"; then
    echo "—— 部署中止：新手引导挡住了它自己让人点的地方。这条静默失败，每个新玩家都撞。"
    exit 1
  fi

  # 闸门 G: 「发送短信验证码」真的把号码发出去(约 8 秒)
  # 2026-08-19 加（客人 Alicia 报的）：这个按钮曾经**永远发不出去** ——
  # _sendCode 读的输入框只存在于上一屏，digits 恒为 0，每次都弹
  # 「请输入 10 位手机号」然后 return。而这是 909 个没登录过的会员唯一的入口。
  # 测试把 signInWithPhoneNumber 打桩，绝不真发短信。
  echo "▶ 闸门 G: 短信验证码发送回归测试(约 8 秒)…"
  $PYCMD -m http.server 8151 --bind 127.0.0.1 >/dev/null 2>&1 &
  SMS_PID=$!
  trap 'kill $SMS_PID 2>/dev/null || true' EXIT
  sleep 1
  SMS_OUT="$(mktemp)"
  EF_MOBILE=1 node scripts/verify/cdp.mjs "http://127.0.0.1:8151/src/" "scripts/verify/sms-send-test.js" 200 >"$SMS_OUT" 2>/dev/null || true
  kill $SMS_PID 2>/dev/null || true
  trap - EXIT
  if ! node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const r = o.evalResult;
    if (!r) { console.error("✗ 短信发送测试没跑出结果"); process.exit(1); }
    if (r.inconclusive) { console.log("  ⚠ " + r.inconclusive + "(不阻断)"); process.exit(0); }
    if (r.failures && r.failures.length) {
      console.error("✗ 发送短信验证码这一步是坏的:");
      r.failures.forEach(f => console.error("  - " + f));
      process.exit(1);
    }
    console.log("  ✓ 号码正确送到发送函数(" + r.sentTo + ")");
  ' "$SMS_OUT"; then
    echo "—— 部署中止：短信验证码发不出去。这挡住所有第一次登录的会员。"
    exit 1
  fi

  # 闸门 H: 登录全流程体检(手机视口，约 6 秒)
  # 2026-08-19 加：一天之内在登录这条路上查出 5 个「按钮在、点了没用、还不报错」
  # 的 bug。共同点是**都不报错**，客人只觉得怪怪的然后走掉。
  # 这一关逐屏问：画得出来吗 / 主按钮绑了吗 / 输入框能打字且 ≥16px 吗 /
  # 有没有死路 / 错误提示多行显示得了吗 / 触摸目标够不够 44px。
  echo "▶ 闸门 H: 登录全流程体检(约 6 秒)…"
  $PYCMD -m http.server 8153 --bind 127.0.0.1 >/dev/null 2>&1 &
  AUD_PID=$!
  trap 'kill $AUD_PID 2>/dev/null || true' EXIT
  sleep 1
  AUD_OUT="$(mktemp)"
  EF_MOBILE=1 node scripts/verify/cdp.mjs "http://127.0.0.1:8153/src/" "scripts/verify/login-audit.js" 300 >"$AUD_OUT" 2>/dev/null || true
  kill $AUD_PID 2>/dev/null || true
  trap - EXIT
  if ! node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const r = o.evalResult;
    if (!r || !r.ran || !r.ran.length) {
      console.error("✗ 登录体检没跑起来(evalResult=" + JSON.stringify(r) + ")");
      process.exit(1);
    }
    if (r.failures && r.failures.length) {
      console.error("✗ 登录流程有问题:");
      r.failures.forEach(f => console.error("  - " + f));
      process.exit(1);
    }
    if (r.warnings && r.warnings.length) {
      console.log("  ⚠ " + r.warnings.length + " 条提示(不阻断)");
    }
    console.log("  ✓ 登录体检 " + r.ran.length + " 项全过");
  ' "$AUD_OUT"; then
    echo "—— 部署中止：顾客登录会踩到问题。这类 bug 不报错，客人只会默默走掉。"
    exit 1
  fi

  # 闸门 I: 开车去任意地方(约 35 秒)
  # 2026-08-20 加：寻路一坏，人就从水塘和房子里穿过去；停车落盘一坏，
  # 开完车刷新就弹回原位。两者都不抛异常 —— 闸门 B 的冒烟看不见。
  # 这一关还钉住两个「只有真开起来才暴露」的坑：车自己是 building
  # (不排除就寻路起点失败)、闲逛逻辑会把整辆车挪走。
  echo "▶ 闸门 I: 开车/寻路回归测试(约 35 秒)…"
  $PYCMD -m http.server 8155 --bind 127.0.0.1 >/dev/null 2>&1 &
  CAR_PID=$!
  trap 'kill $CAR_PID 2>/dev/null || true' EXIT
  sleep 1
  CAR_OUT="$(mktemp)"
  EF_MOBILE=1 EF_CDP_TIMEOUT=120000 node scripts/verify/cdp.mjs "http://127.0.0.1:8155/src/" "scripts/verify/car-drive-tests.js" 45000 >"$CAR_OUT" 2>/dev/null || true
  kill $CAR_PID 2>/dev/null || true
  trap - EXIT
  if ! node -e '
    const o = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const r = o.evalResult;
    if (!r || !r.failures) { console.error("✗ 开车测试没跑出结果(evalResult=" + JSON.stringify(r) + ")"); process.exit(1); }
    if (r.failures.length) {
      console.error("✗ 开车/寻路是坏的:");
      r.failures.forEach(f => console.error("  - " + f));
      process.exit(1);
    }
    console.log("  ✓ 寻路 + 上下车 + 停车落盘全过");
  ' "$CAR_OUT"; then
    echo "—— 部署中止：人会穿墙，或者车停的位置存不进档。"
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
