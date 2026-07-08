# 一流标准审计 Findings（2026-07-07，12 agent 并行审计）

来源 workflow: wf_d491a096-455。每条含亲证 evidence。总表：

| 维度 | 得分 | P0 | P1 | P2 |
|---|---|---|---|---|
| 代码健康（可维护性） | 7 | 0 | 1 | 2 |
| 社交与世界杯模块质量 | 7.5 | 0 | 2 | 3 |
| 声音与 juice（打击感/庆祝感） | 7 | 0 | 2 | 4 |
| 移动端适配 | 5.5 | 1 | 2 | 5 |
| 加载性能 | 5 | 0 | 3 | 4 |
| 内容曲线与经济平衡 | 5 | 0 | 4 | 4 |
| 双语完整性 | 7.5 | 0 | 3 | 6 |
| 交互手感 | 6 | 0 | 3 | 7 |
| 视觉工艺 | 5.5 | 0 | 7 | 5 |
| 健壮性 | 8.5 | 0 | 0 | 5 |
| 新手引导 | 5.5 | 1 | 4 | 6 |
| 新玩家盲测（UX 研究员扮演萨斯卡通华人妈妈，iPhone 尺寸 390×844，全新 localStorage，CDP 驱动 30+ 步实玩 + 次日回访时间回拨模拟） | 6.5 | 1 | 4 | 4 |
| **合计** | | **3** | **35** | **55** |

## 代码健康（可维护性） · 得分 7/10

> 基础卫生相当好：window 上除 Farm 外零全局泄漏、全仓零 TODO/FIXME 欠账、console.log 仅 5 处启动标记、modal/toast 全部走 Farm.ui 单一入口、部署脚本自带 node --check + 无头冒烟闸门——这些已达到商业工艺水准。最大的维护负债是三套并行农场渲染器（iso 默认 + topdown 像素 + classic 竖排）：memory 里的「退役 mapview.js」待办实际未执行，它被画风切换器留活了，约 40 个同名方法与 iso 版近似重复，任何玩法改动要改 2-3 遍且已开始功能分叉（spotlight 引导跳过 topdown）。次要问题是地块解锁等级表三处硬拷贝、双渲染器给共享存档字段播不同默认值。

### [P1] mapview.js 不是死代码——退役计划半途而废，三套渲染器并行维护
- 位置: `src/js/mapview.js:110` · 工作量 M · 风险 med
- 证据: mapview.js:110 `active() { return Farm.state.farmStyle() === 'topdown' }`，main.js:205-208 boot 时按此分派 init；guide.js:110 画风切换器提供 ['topdown','俯视像素'] 选项且 guide.js:132 写入 state.data.farmStyle 后 reload——玩家可随时选中它，是活代码。docs/MAP-REDESIGN-PLAN.md:68 写明待办「把 ?iso 设为默认、退役俯视」，只做了前半。两文件方法名重叠约 40 个（_tapCell/_fakeEvt/_footprintFree/_screenToCell/_paintCell/_drawPlot/_buildUI…），mapview.js:681-705 与 mapview-iso.js:500-517 的 _tapCell 逐行近似（粘性连种、锁地 toast、收获 fakeEvt 全部双写）。功能已分叉：spotlight.js:65-67 注释明说 topdown 视图无定位 API 故新手引导整段跳过；iso 独有鸡舍/扩地/宠物/装饰。另有隐患：两渲染器给共享存档字段 data.map/mapTerrain 播不同默认值（mapview.js:138-143 vs mapview-iso.js:162-169），切换画风时同一坐标数据在两套网格（9×11 正交 vs 16×16 等距）间复用。
- 修复方向: 完成既定退役：需 Chris 确认放弃 topdown 选项后——(1) guide.js:110 删 'topdown' 按钮；(2) state.js:423 删 `topdown=1|map=1` URL 分支、:426 让存档里 farmStyle==='topdown' 静默回落 'iso'（无需存档格式版本迁移，字段本身向后兼容）；(3) index.html:359 删 script 标签；(4) 删 guide.js:145、spotlight.js:67 的 mapView 引用；(5) 最后删 mapview.js 文件。若 Chris 想保留像素画风，则至少把 _tapCell/REQUIRED_LV/存档默认值等共享逻辑提取到公共模块，杜绝双写。classic（farm.js 竖排）建议同期一并决策。

### [P2] 地块解锁等级表 REQUIRED_LV 三处硬拷贝，与 state.js 升级表无单一数据源
- 位置: `src/js/mapview-iso.js:25` · 工作量 S · 风险 low
- 证据: 同一张表 {4:2,5:2,6:3,7:3,8:4,9:4,10:5,11:5} 出现在 farm.js:79（requiredLevels）、mapview.js:22、mapview-iso.js:25，且 farm.js:79 注释写的是「Mirror of farm.js plot-unlock levels」互为镜像；state.js:226 另有一张按等级给地块数的表（12 plots by Lv5）需人工保持一致。改解锁曲线要同步改 4 处，漏一处则不同视图显示的解锁等级不一致。
- 修复方向: 提取到单一来源：放 Farm.crops 或 Farm.state 上导出（如 Farm.state.PLOT_UNLOCK_LV），三个渲染器引用之；或进 data/crops.json 由 Chris 可调。纯常量搬家，无存档影响。

### [P2] index.html 44 个 script 标签的依赖顺序仅一行注释，新人易错
- 位置: `src/index.html:316` · 工作量 S · 风险 low
- 证据: index.html:316 只有 `<!-- Module loading: order matters -->` 一行，其后 44 个 defer 标签无分组说明（哪些是硬依赖：i18n/state 必须先于一切；firebase-init 先于 firebase-*；main.js 必须最后）。缓解因素：main.js:78-86 注释表明所有消费方都有 `Farm.xxx &&` 守卫，插错位置是静默缺功能而非崩溃——这反而更难察觉。deploy.sh 的冒烟闸门只抓未捕获异常，抓不到「守卫吞掉的缺模块」。
- 修复方向: 零代码改动：在 index.html script 区加 4-5 行分组注释（核心 state/i18n → firebase 簇 → 玩法模块（顺序自由）→ 渲染器 → main.js 收尾），标明哪几条是硬顺序。可选：main.js boot 时对关键模块（state/ui/crops/farm/shop）做一次存在性 console.warn 清单，让「守卫吞掉」的缺失可见。

## 社交与世界杯模块质量 · 得分 7.5/10

> 社交闭环（偷菜→回家小报→讨回来）工艺扎实：调性红线写进常量、防重放三元组验证、看家狗攻防、新手保护、跨玩家名字全部 XSS 转义，历史遗留「讨回来宽限只存内存」已确认修复（social-steal.js:37-49 持久化进存档、按日懒重置）；实测走访/顺菜反馈完整（🧺角标→✓格子+浮字+音效+toast）。世界杯观赛台达到商用水准：ESPN 实时叠加、剧透保护、对阵图自动晋级、百分百中奖转盘，历史压盖坑已修且全量排查未发现新的 hub 内共享 UI 压盖入口（登录三处全走 loginFromHub，toast z7500、push横幅 z9000 均在 hub 之上）。登录引导一生仅弹一次、时机克制，不构成骚扰。离一流的差距主要在收尾工程：世界杯 7/19 决赛后没有任何退场/收官机制（入口永驻、轮询永续、无战绩回顾），且淘汰赛赛果 100% 依赖 ESPN 实时接口无静态兜底。

### [P1] 世界杯 7/19 决赛后无退场机制：入口永驻、无收官内容、ESPN 轮询永续
- 位置: `src/js/worldcup.js:1757` · 工作量 M · 风险 low
- 证据: 1) init()/ensureReentry()/updateReentry()（worldcup.js:1732-1769）无任何日期门控，⚽悬浮 reentry 按钮只在 splash/hub 打开时隐藏，决赛后永久留在农场界面；grep 全文无 sunset/07-19 相关逻辑。2) index.html:76 的 splash 入口按钮同样无门控。3) CDP 模拟 2026-07-22 打开 hub 实测截图：竞猜横幅正确隐藏（nearestLottoMatch 为空）、焦点卡自动变「⭐焦点回顾」、各轮次收起为「已全部结束·点开回看」、「我的奖品」保留——半优雅但仅止于此：无冠军收官卡、无个人竞猜战绩总结（参与N次/猜中M次/累计奖励），hub 打开期间 60 秒 ESPN 轮询（startTimers, worldcup.js:520-528）无限期继续。文件头注释自认『self-contained…deletes cleanly in July』即计划靠人工删除，违反 CLAUDE.md 验收守则第3条『赛程按日期自动推进，不等 Chris 来说该收起来了』。
- 修复方向: 按数据驱动自动收官（不新增依赖）：决赛 kickoffUtc + ~3 天后 hub 顶部渲染收官卡（🏆冠军 + 从 lottoLoadMine 汇总的个人竞猜战绩：参与次数/猜中次数/累计农场币/待领实物置顶）；同时农场内 reentry 按钮换为安静的「世界杯回顾」样式（去掉红点脉冲）。实物兑奖窗口期（建议决赛后 2 周，与 Chris 确认）过后自动隐藏 splash 入口与 reentry 按钮，仅保留 worldcup.html 直链可回看。日期全部从 wc2026.json 决赛场次推导，不写死第二份。

### [P1] 淘汰赛全部赛果 100% 依赖 ESPN 实时接口，无静态/本地兜底——离线或接口失效时整段淘汰赛显示「待更新」
- 位置: `src/js/worldcup.js:122` · 工作量 M · 风险 low
- 证据: data/wc2026.json 中决赛记录实测为 officialScore:null / officialFinal:false / apiScore:null（KO 场次普遍如此）；matchState()（worldcup.js:122-141）在无 officialScore、无 live 记录且过了开球窗口时返回 'awaiting' → 卡片显示「⏳ 待更新」。live 数据仅存内存变量 live（worldcup.js:20），不落 localStorage；fetchLive 失败即回落静态数据。即今日联网实测正常（截图见 ESPN 实时叠加工作中），但 PWA 离线打开、ESPN 接口变更或赛后 ESPN 清理历史数据时，16强以后所有已完赛比分全部消失。这也放大了上一条：收官回顾模式的赛果同样悬在第三方接口上。
- 修复方向: 两条都做成本很低：a) fetchLive 成功后把 byPair/byTime/standings 快照写 localStorage（带时间戳），fetchLive 失败或离线时读快照回填 live 变量（只信 finished 记录）；b) 收官时（或每轮打完后）用现成 deploy 流程把 officialScore/officialFinal 手工/脚本固化进 wc2026.json（代码已支持：ensureData 里『JSON 里已有 officialFinal 赛果时不等 ESPN 就先推一轮晋级』worldcup.js:162-163）。

### [P2] 竞猜提交成功的瞬间弹出推送权限预提示横幅，打断「过渡卡→转盘揭晓」的高光时刻
- 位置: `src/js/worldcup.js:1286` · 工作量 S · 风险 low
- 证据: wireLottoForm 提交成功回调里（worldcup.js:1286）调 Farm.push.maybePromptAfterHarvest()；firebase-push.js:104-129 显示它会立即 append 一个 .pwa-install-banner（style.css:3834 z-index 9000 > hub 7000，固定在屏幕底部）。用户刚点完「提交竞猜」、屏幕正显示「🎉参与成功！点击开启转盘」时，底部同时冒出「🔔开启提醒，菜熟了第一时间叫你？」——两个 CTA 抢注意力，且提醒文案讲的是种菜、与当下竞猜情境完全无关。style.css:3828 的 body.modal-open 隐藏规则对 hub 不生效（hub 不是 modal），横幅会一直叠在 hub 底部。
- 修复方向: 不在 hub 内触发：去掉 worldcup.js:1286 这一处调用（保留收菜后的原触发点），或延迟到 hub close() 后再 maybePrompt——一行注释掉即可，push 引导本就有收获后的主触发路径。

### [P2] 「今日邻居」第三个卡位常年空置：AI 补位上限 maxFill=2，3 列网格视觉上像缺了一块
- 位置: `src/js/ai-neighbors.js:43` · 工作量 S · 风险 low
- 证据: ai-neighbors.js:43 maxFill:2（『每天最多出场的 AI 数』），neighbors.js:110-118 真会员不足 3 时用 dailyPick(need) 补位但被 maxFill 封顶为 2。CDP 实测截图（游客态、无真会员可见）：邻居广场 3 列网格只有 2 张卡，右侧第三列整块空白，进度条固定显示 0/3『走访 3 户 → +40』——新玩家看到的任务目标（3户）与实际可走访数（2户）不一致，第 3 户只能等真会员出现，早期冷启动阶段走访任务实际不可完成。
- 修复方向: 两选一：a) 真会员+AI 合计不足 3 时，第三格渲染「📨 邀请好友」占位卡（复用现有 emptyInviteBtn 逻辑），把空白变成增长入口；b) 或将走访奖励门槛动态化为 min(3, 可见邻居数)。不建议简单把 maxFill 提到 3——『不满村假人』是 2026-07-02 有意收紧的设计（ai-neighbors.js:37-40 注释）。

### [P2] 【已验证无恙·记录】历史遗留与压盖专项复查结论：宽限已持久化、hub 内无新增压盖入口、登录引导不骚扰
- 位置: `src/js/social-steal.js:37` · 工作量 S · 风险 low
- 证据: 1) 「讨回来」宽限：social-steal.js:32-49 已于 2026-07-02 持久化为存档字段 stealGrace{date,byTarget}，按日懒重置，注释明确记载旧内存实现的问题——遗留问题确认已修复。2) hub 压盖专项：grep worldcup.js 全部 Farm.ui.* 调用（10 处全是 toast，z7500>7000 可见）；三处登录入口（横幅 :381、竞猜卡 :1198/1208、我的奖品 :1349）全走 loginFromHub() 先关 hub；奖品/竞猜中心用 hub 内部 .wc-mp-overlay（worldcup.css:451）；confetti z7100、streak toast 独立元素——未发现任何会打开共享 #modal(z100) 的 hub 内路径。3) login-nudge.js:23-38：guestLoginPromptShown 一生一次、仅游客、仅 Firebase 可用时、避开 spotlight 引导、可自由关闭，唯一调用点 warehouse.js:257（首次卖出）——频率完全不构成骚扰，符合 Chris『讨厌 nag 弹窗』的纪律。
- 修复方向: 无需修复；本条供编排器归档三个专项检查点的结论与证据坐标。

## 声音与 juice（打击感/庆祝感） · 得分 7/10

> 底子相当扎实：WebAudio 纯合成 8 种音效（plant/harvest/coin/buy/levelUp/achievement/error/tap），零资产文件，覆盖种/收/卖/买/升级/成就/错误/UI 全事件（60+ 调用点）；juice 侧有金币飞行(flyCoins)、数字滚动(_tickCounter+hud-bump)、粒子爆发(burst)、全屏彩带(showConfetti)、金币雨(coinBurst)、连击飘字、升级庆祝弹窗（CDP 实测收获时 harvest+coin 音效齐发、8 粒子+3 层彩带同屏，截图确认升级弹窗工艺在线）。静音开关在设置面板且随存档持久化，iOS 手势解锁用 armGestureGate 处理得干净。离 Hay Day 的差距主要在「氛围层」和「变化感」：完全没有背景音乐/环境声，且每个音效每次播放频率时长 100% 相同（连收 12 块地听 12 次一模一样的 chime），连击只有飘字没有音高递进；prefers-reduced-motion 在主 CSS 完全未处理。

### [P1] 无背景音乐/环境声，游戏氛围层缺失
- 位置: `src/js/audio.js:108` · 工作量 L · 风险 med
- 证据: src/js/audio.js 全文（157 行）只有一次性短音效，无任何循环/ambient 节点；grep 全 src/js 无 loop/ambient/bgm 相关代码。CDP 实测进入农场后除交互音外完全寂静。Hay Day 的『在农场里』感一半来自环境声底床。
- 修复方向: WebAudio 纯合成轻环境层（符合零资产约束）：低音量粉噪声风声 pad + 随机间隔的合成鸟鸣 chirp（正弦扫频 2-4kHz, 每 8-20s 随机触发）+ 节日期间可加五声音阶随机风铃。挂在独立 gain 上，设置面板给独立开关（默认开、音量 ~0.05）。注意合成 ambient 容易做廉价，需反复调参试听。

### [P1] 音效零随机变化 + 连击无音高递进，高频动作听觉疲劳
- 位置: `src/js/audio.js:98` · 工作量 S · 风险 low
- 证据: audio.js:77-151 _tone/play 无任何 Math.random/detune/参数入口，harvest 永远是 523→784Hz 同一对音；farm.js:342 连击 ≥2 时固定 play('coin')（同一音高），连击爽感只有飘字在涨、耳朵听不到递进。连收一排地 = 连续 N 次完全相同的 chime。
- 修复方向: 两步（改动极小）：1) _tone 里给 freq 乘 (1 + (Math.random()-0.5)*0.06) 做 ±3% 随机 detune；2) play(name, opts) 加可选 opts.step，harvest/coin 按连击数把整组频率乘 Math.pow(2, step/12)（每连击升半音，封顶 +7），farm.js 连击处传 _comboCount。这是 Hay Day 式收获爽感最便宜的一半。

### [P2] prefers-reduced-motion 在主样式表完全未处理
- 位置: `src/css/style.css:416` · 工作量 S · 风险 low
- 证据: grep 'prefers-reduced-motion' 只命中 src/css/worldcup.css:626；style.css（4160 行、40+ @keyframes 含 confettiFall/burstFly/hudBump）零命中。flyCoins/burst/showConfetti（ui.js:226/276/474）也无 matchMedia 检查。对晕动敏感用户（目标客群含年长家庭成员）全屏彩带+金币雨无豁免。
- 修复方向: style.css 末尾加一段 @media (prefers-reduced-motion: reduce){ .confetti-piece,.burst-particle,.fly-coin{animation:none;display:none} .currency.hud-bump{animation:none} }；ui.js 的 showConfetti/coinBurst/flyCoins/burst 开头加 if(matchMedia('(prefers-reduced-motion: reduce)').matches) return（flyCoins 保留 refreshHUD 回退路径已存在）。

### [P2] 触觉反馈缺在最高频的两个爽点：收获与卖货
- 位置: `src/js/farm.js:283` · 工作量 S · 风险 low
- 证据: grep navigator.vibrate 全仓只 4 处：ui.js:466（升级）、firebase-points.js:348、store-rewards.js:216、login-calendar.js:258。核心循环里每天做几十次的 farm.js harvestPlot（255 起）和 warehouse.js deliver（203 起）都没有 haptic——Hay Day 的收获手感很大一部分是触觉。
- 修复方向: harvestPlot 播 harvest 音效处加 navigator.vibrate(12)（单次极短脉冲，连收不烦人）；warehouse.deliver 成功路径（flyCoins 处）加 vibrate([15,40,15])。照抄现有 try/catch 包裹模式即可，iOS Safari 无效但无害。

### [P2] 音量只有全开/全关二元静音，无小声档
- 位置: `src/js/audio.js:18` · 工作量 S · 风险 low
- 证据: audio.js:18 MASTER_VOLUME=0.18 写死常量；设置面板（main.js:632-650）只有 🔊开/🔇静音 两颗按钮。妈妈+孩子在公共场合的真实需求常是『调小声』而不是关掉。
- 修复方向: state 加 audioVolume(0-1, 默认 1) 字段（存档新增字段向后兼容、无需版本迁移），masterGain.gain = MASTER_VOLUME * audioVolume；设置面板两颗按钮改成 开/小声/静音 三档（比滑杆更适合触屏+孩子）。

### [P2] tap 音效靠逐按钮手工接线，通用按钮覆盖不全
- 位置: `src/js/main.js:194` · 工作量 M · 风险 low
- 证据: grep play('tap') 显示 tap 全部是散布在 main.js/guide.js/ep-shop.js 等的手工 onclick 接线（约 20 处）；modal 关闭 ✕、warehouse/kitchen 面板内多数次级按钮无 tap 反馈（如 warehouse.js 只在 298 行一处 tap）。按钮视觉按压(.btn:active translateY(3px), style.css:2483)是全局的，听觉反馈却是抽样的，手感不一致。
- 修复方向: document 级事件委托统一处理：pointerdown 时 closest('.btn,.modal-close') 且目标 handler 未自带音效的播 tap。最简做法是委托无条件播 tap、然后删掉现有零散的 play('tap') 手工接线（保留 buy/error 等语义音效），一处管全部。

## 移动端适配 · 得分 5.5/10

> 游戏主界面（农场/商店/任务/dock）在 390–428px 竖屏下表现扎实：HUD 单行不溢出、dock 与左下店主头像/右下建造按钮矩形互不重叠、弹窗 80vh 内滚动、body 锁滚无穿透，这部分接近商业水准。但入口即翻车：开屏 splash 是 fixed+flex 居中且不可滚动，360×640 下游客入口被裁掉、844×390 横屏下登录/游客按钮全部不可达（无法进入游戏），"360px 最窄可用、竖横屏皆可"两条达标线直接不过。且 viewport meta 缺 viewport-fit=cover，全站十几处 env(safe-area-inset-*) 在 iOS 刘海机上实际恒为 0，safe-area 适配是纸面功夫。PWA manifest/SW 基础齐全（192/512/maskable、standalone、根作用域 SW+版本自动刷新），比多数小团队做得好，但 orientation:portrait 锁死与横屏诉求矛盾。离 Hay Day 级差距主要是窄屏/横屏的系统性降级策略缺失（全 CSS 仅 3 个媒体查询）。

### [P0] 开屏 splash 不可滚动且 flex 居中裁切：360×640 游客入口不可见，844×390 横屏登录/游客按钮全部不可达（无法进入游戏）
- 位置: `src/css/style.css:2612` · 工作量 S · 风险 low
- 证据: .splash 为 position:fixed inset:0 + display:flex align-items:center，无 overflow-y:auto；html/body 又是 overflow:hidden + position:fixed（style.css:55-72，注释明言锁外层滚动）。CDP 实测（764×485 视口）：splash scrollHeight 649 > clientHeight 485，overflowY:visible，splashStart 按钮 inView:false。截图 splash-360x640.png：顶部 logo 被裁半、「先随便逛逛」与页脚完全不可见；splash-844x390.png：手机号登录与先随便逛逛按钮均在屏外，页面无任何滚动路径，横屏用户被永久挡在开屏。
- 修复方向: 给 .splash 加 overflow-y:auto + -webkit-overflow-scrolling:touch，并把居中方式从 align-items:center 改为 .splash-content { margin:auto }（safe centering，溢出时自动顶对齐可滚），一处 CSS 改动即同时修复窄屏与横屏。

### [P1] viewport meta 缺 viewport-fit=cover，全站 env(safe-area-inset-*) 在 iOS 刘海机上恒为 0，safe-area 适配实际全部失效
- 位置: `src/index.html:5` · 工作量 S · 风险 med
- 证据: index.html:5 viewport 为 width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no，无 viewport-fit=cover。而 style.css 至少 5 处依赖 env()：topbar padding-top(197)、#bottombar dock bottom(1965)、建造按钮(4137)、coach 气泡(4122)、教程条(3832)，worldcup.css 另有 3 处。iOS 规则：非 cover 模式下 env(safe-area-inset-*) 全为 0——PWA standalone（已声明 apple-mobile-web-app-capable）在 iPhone 刘海/灵动岛机型上 dock 会贴住 home indicator，这些 calc 全是无效代码。Chris 的测试机就是 iPhone 17。
- 修复方向: viewport content 追加 viewport-fit=cover；改后需真机验证顶部 topbar 是否被状态栏侵入（已有 padding-top calc(6px + env(top)) 应能接住）。

### [P1] manifest orientation:"portrait" 锁死安装版横屏，与「竖横屏皆可」达标线冲突；浏览器横屏又被 splash 挡死，横屏路径整体不可用
- 位置: `src/manifest.webmanifest:9` · 工作量 S · 风险 low
- 证据: manifest.webmanifest:9 明写 "orientation": "portrait"（Android 安装后系统级锁竖屏）。而浏览器横屏实测：splash 阻断（见 P0）；用脚本绕过 splash 后农场/商店/任务在 844×390 下其实渲染良好（farmclean-844x390.png：HUD 单行、dock 居中、弹窗可滚）——即游戏本体具备横屏能力，被入口和 manifest 两道闸拦住。
- 修复方向: 产品先拍板：若要横屏可用，manifest orientation 改 "any" 并修 splash（见 P0）；若决策竖屏-only（对妈妈+孩子用户合理），保留 portrait 锁但需在浏览器横屏时给「请竖屏游玩」提示层，并把达标线改掉——现状两头不靠。

### [P2] 已知项确认：签到提示胶囊在 390px 折两行，360px 下空地提示同样折两行，顶部状态胶囊高度膨胀
- 位置: `src/css/style.css:661` · 工作量 S · 风险 low
- 证据: 实测截图 capsule-390.png（390×844，强制注入签到相位文案）：「今日还没签到 · 点我领奖励」折成两行，胶囊撑高约一倍；farmclean-360x640.png 中「地都空着，种点什么吧」同样两行。CSS 上 .harvest-status-text 无 white-space/nowrap 控制（style.css:661），文案长度未按 360px 预算裁剪。中英双语下英文 'Daily check-in ready · tap me!' 也偏长。
- 修复方向: 缩短文案（如「今天还没签到 › 」）或 ≤400px 媒体查询降 font-size 至 11.5px；保底 white-space:nowrap + text-overflow:ellipsis 防两行，i18n.json 里为窄屏准备短版 key 亦可。

### [P2] 世界杯卡片 LIVE 徽章绝对定位压在标题文字上：360px 压「观赛」二字，428px 与横屏压「FIFA」
- 位置: `src/css/worldcup.css:603` · 工作量 S · 风险 low
- 证据: worldcup.css:603 .splash-wc-pill { position:absolute; top:8px; right:12px; ... }，而标题 .splash-wc-txt 是流式换行文本、无 padding-right 避让。截图 splash-360x640.png：LIVE 白字直接叠在「观赛」上；splash-428x926.png 与 splash-844x390.png：LIVE 压住换行后的「FIFA」。所有测过的宽度都有不同程度碰撞。
- 修复方向: 给 .splash-wc-txt 或首行标题加 padding-right:44px 为徽章预留空间，或把 LIVE pill 改为标题行内 inline-flex 元素（跟随文字流不重叠）。

### [P2] 「先随便逛逛」游客入口为无底色 ghost 文字叠在房屋插画上，对比度极低近乎不可读
- 位置: `src/css/style.css:1233` · 工作量 S · 风险 low
- 证据: style.css:1233 .splash-start--ghost { background:none; border:none; color:var(--warm-text-soft) }，位于 splash 底部正好叠在 farm-backdrop 房屋图案上。截图 splash-390x844.png / splash-428x926.png：「先随便逛逛」几个字与浅色墙面几乎融为一体（中文部分尤其难辨）。这是不想登录用户的唯一入口，视觉上等于隐藏。
- 修复方向: 给 ghost 按钮加半透明奶油底 pill（rgba(255,253,246,0.8) + backdrop-filter:blur），或加 text-shadow 白色描边提对比；不必改成实心按钮以免抢登录主 CTA。

### [P2] 360px 顶部 HUD 拥挤：天气 pill 被压缩成残影、品牌 logo 与 Lv 徽章轻微挤叠，无窄屏降级规则
- 位置: `src/css/style.css:2051` · 工作量 S · 风险 low
- 证据: 对比截图：farmclean-390x844.png 天气位置尚有太阳 icon，farmclean-844x390.png 完整显示「☀ 萨城 14°」，而 farmclean-360x640.png 同一位置只剩一个被裁的碎片（形似冒号），logo 的 Eastern 与 Lv1 徽章边缘相贴。全 style.css 仅 3 个媒体查询（141:@339px、2051:@375px、4160:@360px），顶部条无任何 ≤375px 收缩策略，靠 flex 硬挤。
- 修复方向: 加 @media (max-width:375px) 规则：天气 chip 只留 icon 隐藏文字（或整体 display:none）、brand logo 缩到 84px、currency pill 减 padding——参照 Hay Day 窄屏只保核心数值的做法。

### [P2] PWA manifest 细节缺口：无 192 maskable、无 screenshots/shortcuts，安装体验低于一流水准
- 位置: `src/manifest.webmanifest:12` · 工作量 S · 风险 low
- 证据: 读 manifest.webmanifest 全文：icons 仅 any-192、any-512、maskable-512 三枚，缺 maskable-192（部分 Android launcher 取 192 档时回退 any 图标会被圆形蒙版裁角）；无 screenshots 字段（Chrome Android 富安装卡片不显示预览）、无 shortcuts。基础项（name/short_name/display/theme_color/scope/start_url/根作用域 SW+自动刷新）已齐全且正确。
- 修复方向: 补一枚 icon-maskable-192.png 进 icons 数组；有余力再加 2-3 张 screenshots（narrow form factor）提升安装转化——纯资产追加，零代码风险。

## 加载性能 · 得分 5/10

> SW 架构是亮点：导航网络优先+3.5s 超时兜底、静态资源 stale-while-revalidate、全 shell 预缓存，实测生产站热启动 DCL 0.86s / FCP 0.56s，轻松过 1.5s 达标线；重型地图图片也做到了按需加载不进预缓存。但冷启动明显不达标：Fast-3G+4x CPU 基线下生产站首屏 FCP 5.6s、可交互（DCL）5.8s，接近 3s 达标线的两倍——主因是 style.css 内 @import 造成的字体串行加载链（单独吃掉约 2.3s）、启动窗口约 760KB 首屏根本用不到或严重超采样的图片、以及 52 个并行 script 与 CSS 抢带宽。点"进入农场"后还要再拉 3.27MB / 25 张未压缩 PNG（hd_bg 698KB、hd_soil 430KB…），弱网下地图要十几秒才完整。资产层面 src/assets 共 9.8MB 完全没有压缩管线（多张 500-800px PNG 达 300-730KB），离 Hay Day 级"打开即玩"的工艺还有一段真实距离，但前三个修复（S/M 工作量）就能把冷启动拉回 3s 线附近。

### [P1] style.css 内 @import 字体串行链 + 字体重复加载，首屏渲染被拖 ~2.3s
- 位置: `src/css/style.css:6` · 工作量 S · 风险 low
- 证据: style.css:6 有 @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC...&family=ZCOOL+KuaiLe...')，而 index.html:49 的 <link> 已加载另一份 css2（Fredoka+ZCOOL KuaiLe，ZCOOL 被重复请求）。CDP 实测（生产站 farm.easternmarket.ca，Fast-3G+4xCPU）：style.css 265→3305ms 下载完成后才发现 @import，第二个 css2 3309→4714ms，FP/FCP 最终 5624ms、DCL 5771ms——@import 链是 FP 与 style.css 到达之间 ~2.3s 空档的直接原因。此外末尾内联 SW 注册 <script>（index.html:369）会等待所有 pending 样式表，把 domInteractive 也拖到 5610ms。
- 修复方向: 把 style.css:6 的 @import 删除，families 合并进 index.html:49 已有的 <link>（去掉重复的 ZCOOL KuaiLe），保留 preconnect——两份字体 CSS 变成一个并行请求，消除串行链。进一步可把该 <link> 改为 media="print" onload="this.media='all'" 的经典无构建异步化写法（字体本就 display=swap，系统字兜底），FP 可再提前到只受 style.css 约束（~3.3s）。不新增任何依赖。

### [P1] 点「进入农场」瞬间拉取 3.27MB / 25 张未压缩地图 PNG，弱网下地图 15s+ 才完整
- 位置: `src/js/mapview-iso.js:46` · 工作量 M · 风险 low
- 证据: CDP 实测：splash 点击 splashStart 后新增 25 个资源共 3273KB——hd_bg.png 699KB（PIL 实测仅 1248×832 RGB）、hd_soil.png 430KB（949×619）、p_stall.png 276KB（360×489）、house.png 292KB（512×658）等，全部是 truecolor PNG。按 Fast-3G 1.6Mbps（~200KB/s）计算需 ~16s 全部到达。mapview-iso.js:46-47 引用 hd_soil/hd_bg。这些图不在 SW 预缓存里（service-worker.js 注释明确 images 走 network-first/on-demand），首访玩家全额付费。
- 修复方向: 离线批量转 WebP（手绘风 PNG→WebP 通常省 70-85%，hd_bg 698KB 预计 ~100-150KB；可用本机 cwebp 或项目已有的 Pillow 脚本，属离线工具不违反无外部依赖红线），代码里改文件名后缀即可（iOS 14+/所有现代浏览器支持 WebP；mapview-iso 用 new Image() 加载，无 <picture> 需求）。同时把最大图限制到实际显示分辨率。预估进场图片 3.27MB→约 0.8-1.0MB，弱网地图完整时间从 ~16s 降到 ~4-5s。注意存档/逻辑零改动，纯资产替换。

### [P1] 启动窗口加载 ~760KB 首屏用不到或严重超采样的图片，与关键资源抢带宽
- 位置: `src/js/warehouse.js:293` · 工作量 S · 风险 low
- 证据: 冷启动 CDP 资源清单（生产站）：warehouse-barn.png 395KB（760×428，藏在 warehouse.js:293 注入的未打开弹窗模板 <img> 里，boot 即下载，7816→14455ms 占满后段带宽）；wc2026-logo.png 275KB（PIL 实测 800×800，worldcup.css:597 显示高度仅 54px，超采样 ~15 倍，5589→13769ms 下了 8 秒）；logo-horizontal.png 92KB（1080×556，splash 小 logo）。三者合计 ~760KB，全在首屏关键窗口内与 CSS/JS 竞争 1.6Mbps。
- 修复方向: wc2026-logo 重采样到 108-160px + WebP/压缩 PNG（275KB→~10-15KB）；logo-horizontal 缩到 2x 显示宽度（92KB→~20KB）；warehouse-barn 改为弹窗首次打开时才注入 src（data-src 或打开时拼 HTML，vanilla JS 一行改动）+ 压缩。合计首访节省 ~700KB，且释放首屏带宽让 style.css 更早到达。

### [P2] worldcup.js 97KB 全量加载在主游戏页，index 只用到 splash 按钮绑定
- 位置: `src/index.html:362` · 工作量 M · 风险 med
- 证据: index.html:362 以 defer 全量加载 worldcup.js（97KB raw / 31KB gz，1807 行）；grep 显示其对 index 页的作用主要是 worldcup.js:1729 绑定 #splashWorldcup 按钮 + 世界杯 hub 主体逻辑在 worldcup.html（WC_STANDALONE 分支，worldcup.js:499）。冷启动瀑布里 worldcup.js 318→3320ms 与 style.css 同窗口抢带宽。同理 share.js 16KB、promo.js 6.7KB、login-calendar.js 14KB 均非首屏必需。SW 预缓存后热启动无感，但首访冷启动全额付费。
- 修复方向: 无构建约束下两个手段任选：(a) 把 splash/游戏内入口按钮绑定拆成 ~1KB 的 worldcup-entry.js 留在 index，主体 worldcup.js 改为点击入口或 requestIdleCallback 时 createElement('script') 动态注入；(b) 最低成本版——worldcup.js 移出 index.html 的 script 列表（worldcup.html 自己加载），入口按钮绑定挪进 main.js。注意 window.Farm 挂载顺序与 SW 预缓存清单同步更新。收益：启动少 ~31KB gz 传输 + 97KB 解析，减一路带宽竞争。

### [P2] 52 个并行 <script defer> 与渲染关键 CSS 抢带宽，style.css 30KB 走了 3 秒
- 位置: `src/index.html:317` · 工作量 L · 风险 med
- 证据: index.html:317-365 共 47 个本地 defer script + 5 个 Firebase compat（curl 实测 gz 合计 158KB：firestore-compat 99KB、auth 38KB、app 9KB、messaging 9KB、functions 3KB）。生产站 Fast-3G 实测 style.css（30KB gz）265→3305ms 才完成——不是文件大，是与 ~50 路并发下载分享 1.6Mbps；FP 因此至少 3.3s 起步。自有 JS 合计 986KB raw（gz 后约 300KB）。
- 修复方向: 先做前三条（去掉 @import、砍 760KB 首屏图、worldcup.js 出列）后此项自然缓解。进一步无构建手段：把 firebase-messaging-compat/functions-compat（合计 gz 12KB 但各占一路请求）与 login-nudge/share/promo/guide/spotlight 等增强模块改为 main.js 启动完成后 requestIdleCallback 动态注入，压缩首屏并发路数。deploy.sh 已是发布闸门，也可考虑在部署时做简单 cat 合并（属现有脚本扩展，非新构建链）——但建议放最后，风险在加载顺序。

### [P2] worldcup 奖品图未压缩：shaqima.png 714KB（500×500），单页面肥肉
- 位置: `src/assets/worldcup/prizes/shaqima.png:1` · 工作量 S · 风险 low
- 证据: wc -c + PIL 实测：shaqima.png 714KB 仅 500×500 RGBA（照片类内容存成 PNG，每像素 ~2.9 字节，极不正常）；yogurt_orig.png 181KB、yogurt_muscat.png 169KB、ryukakusan.png 102KB 同目录同问题。仅 worldcup 页加载，不影响主游戏冷启动，但该页是拉新分享落地页（splash LIVE 按钮直达），弱网首开同样卡。
- 修复方向: 照片类奖品图转 JPEG/WebP（500×500 照片 ~30-50KB 足够），预计 prizes 目录 ~1.2MB→~150KB。纯资产替换 + 改后缀引用，零逻辑风险。

### [P2] SW 首访 install 预缓存 61 个文件与进场 3.2MB 地图下载窗口重叠
- 位置: `src/index.html:379` · 工作量 S · 风险 low
- 证据: index.html:379 在 window load 时注册 SW；service-worker.js:74-101 预缓存 61 个 URL（全部 JS/CSS/JSON/HTML）。冷启动实测 load 事件 14.5s（Fast-3G），此时用户很可能已点进农场正在拉 3.27MB 地图图——install 的 cache.add 走 HTTP 缓存（GitHub Pages max-age=600 命中磁盘，实际网络代价小），但 icon/未到达资源仍会发网络请求，与地图图竞争。影响有限，属打磨项；SW 整体策略（导航 3.5s 超时兜底、SWR、逐文件容错预缓存）实测热启动 DCL 0.86s，是达标的。
- 修复方向: 把 SW 注册从 load 事件再推迟到 requestIdleCallback（或 setTimeout 8-10s / 首次用户交互后），避开首访进场的图片下载高峰。一行级改动，注意保留 controllerchange 自动刷新逻辑（index.html:373-378）不变。收益小但零风险。

## 内容曲线与经济平衡 · 得分 5/10

> 前 10 级的内容节奏是真扎实的：38 种作物按真实销量数据分层、Lv1-10 每一两级都有新作物/菜谱/地块落地，coins/h 曲线从 75 单调爬到 115、订单 1.5×/厨房 2.25×/应季 1.15× 三层出口设计意图清晰，2026-07-02 的 XP 表平滑修复也确实把墙推后了。但墙还在：数学模型显示活跃玩家第 8 天、休闲玩家第 12 天到 Lv14 后内容彻底归零，而 XP 需求超线性增长（Lv16 后每级 +900 递增）→ Lv15-20 有 12-20 天真空、Lv20-30 是 47-83 天荒漠，只剩 Lv500 地块表在空转。经济侧更糟：Lv8+ 金币水龙头 1.7-4.6 万/天，终身一次性水槽合计仅约 3 万，且催熟剂（60 币无限买、实测单次净赚 +900 币 +60 XP 的即时循环）和化肥（×8 ROI）实为金币放大器，三套地块获取定价互相矛盾（200 币无上限 vs 3000 币限 4 块 vs 等级解锁排到 Lv500）。离 Hay Day 的差距不在首周手感，在中后期：缺 Lv15-20 内容档、缺可重复金币水槽、任务/订单/成就的数值全部不随等级缩放。

### [P1] 内容悬崖：全部内容止步 Lv14，XP 需求却超线性推进——Lv15 后 12-83 天零解锁
- 位置: `data/crops.json:836` · 工作量 M · 风险 low
- 证据: crops.json 最高解锁 li_zhi unlock_level=14（CDP 运行时验证 maxUnlockCropLv=14）；recipes.json 最高 corn_pine_nuts Lv10（:106）；achievements.json 最高 level_10（:53）；state.js:212-219 XP 表到 Lv16=19000 后走 19000+4500k(1+0.1k) 超线性外推（运行时验证 xpForLevel(17)=23950, (30)=170200）。节奏模型（3×8min/天会话、6h+6h+12h 槽位填最优作物）：休闲盘（60% 利用率）Lv10=第5天、Lv14=第12天、Lv15→Lv20 空窗 20 天、Lv20→Lv30 空窗 83 天；活跃盘（90%）Lv14=第8天、Lv15→20 空窗 12 天。XP/天/地块从 Lv8 起冻结在 126-146（最优 6h 作物永远是 shan_yao 42XP），而每级需求持续增长——曲线在内容停止处正好开始失速。
- 修复方向: 纯数据补齐（不动存档格式）：① crops.json 加 5 个华超真实商品作物，数值沿现有曲线外推（coins/h 每级 +1~2、xp≈grow_h×7.5、seed≈sell/11）：Lv15 龙眼(grow 540m, seed 100, sell 1150, xp 70)、Lv16 苋菜(360m, 75, 720, 45——刻意做成 Lv8 后第一个打赢 shan_yao 的 6h 槽新答案)、Lv17 佛手瓜(420m, 85, 890, 52)、Lv18 韭黄(multi_harvest×3, grow 300m+regrow 120m, seed 90, sell 380/茬, xp 25/茬——jiucai 的高级版)、Lv20 榴莲(720m, 150, 1600, 95——过夜档新王，华超冰冻榴莲明星品)。② recipes.json 补 6 道把菜谱梯子从 Lv10 延到 Lv20（沿 ×2.25 价格/×1.5 XP 既有公式）：Lv12 油焖春笋(chun_sun×2, 50m, 4320, 180xp)、Lv14 荔枝冰饮(li_zhi×2, 45m, 4550, 186xp)、Lv15 桂圆红枣茶(龙眼×2)、Lv17 凉拌佛手瓜、Lv18 韭黄炒蛋、Lv20 榴莲班戟(90m, 3600, 142xp)。③ state.js PLOT_UNLOCK_AT 在 17 插一块地填 15→20 空窗（一行改动）。全部奖励只用农场币/XP，不加任何 east_points_bonus 字段。

### [P1] 催熟剂 60 币无限购 = 1367% ROI 即时印钞循环，同时打爆金币与 XP 两条曲线
- 位置: `data/ep-shop.json:24` · 工作量 S · 风险 low
- 证据: ep-shop.json:20-28 fertilizer(催熟剂) cost_coins=60 立即成熟一块地；ep-shop.js:40-51 canBuy 只查余额和 extra_plot 的 max_owned，消耗品无任何购买上限；farm.js:244-246 使用后 plot.plantedAt 直接回拨到成熟。CDP 无头实测完整链路：买催熟剂→种 chun_sun→加速→收获→交仓，coinsBefore 500 → coinsAfter 1400（净 +900，扣除种子成本后 +820）+60 XP，全程数秒。等价于 60 币可无限兑换『任意作物全额收益+全额 XP』：li_zhi 单次 +860 币/+62 XP（1433% ROI）。一个 8 分钟会话内可循环几十次，比正常玩一天的 XP 还多——发现此循环的玩家进度曲线直接作废。
- 修复方向: 对齐 Hay Day 的『按剩余时长计价』：催熟价格 = ceil(剩余分钟/30)×20 币（或至少 = 作物 seed_cost×2），使即时循环净收益≈0；同时给 stack_consumable 加 daily_buy_cap 字段（ep-shop.json 数据 + ep-shop.js canBuy 十行内判断）。EP 版加速券(10EP)不动——那是 EP 侧的既有定价，属红线不碰。

### [P1] 金币通胀：Lv8+ 水龙头 1.7-4.6 万/天 vs 终身一次性水槽约 3 万，唯一循环水槽是通向真实负债的 EP 兑换
- 位置: `src/js/state.js:636` · 工作量 M · 风险 low
- 证据: 模型：Lv8 休闲 17.3k 币/天、Lv10 21k、活跃 Lv10 36.7k（13-16 块地 × 6h/6h/12h 最优作物 × 订单 1.5× 部分加成）。全部一次性水槽实测枚举：ep-shop 装饰+宠物+仓库扩容+4 块 3000 币地+第二口灶 = 20,070（ep-shop.json + kitchen.js:17）；iso 地图土地扩张 800+1500+3000（mapview-iso.js:30-35）+ 建筑一套约 3,260（mapview-iso.js:80-92）≈ 终身 3 万，不到 Lv10 玩家两天收入。此后金币唯一去处是 10:1 换 EP（state.js:636 exchangeCoinsToEp，服务端日上限兜底）——即『玩家金币过剩会持续转化为店主真实积分负债压力』，EP 经济本身是红线只报告不动。
- 修复方向: 加农场币循环/大额水槽（全部游戏内，不碰 EP）：① 厨房灶台 3-5 级升级链（第 3 口灶 15k、出菜速度 -10%/级 10k-50k）；② 建筑升级（谷仓/温室外观+功能等级，5k-80k 递增，吃掉 Hay Day 式『攒一周买一个』的期待感）；③ 季节限定装饰轮换商店（每季 3-5 件 2k-20k，制造重复购买）；④ 高级种子袋（500 币随机 Lv10+ 种子×3，小额循环）。目标：Lv10+ 玩家每周有 5-10 万币的想买清单。

### [P1] 三套地块获取系统定价互相矛盾：iso 建造 200 币无上限 vs ep-shop 3000 币限 4 块 vs 等级解锁排到 Lv500
- 位置: `src/js/mapview-iso.js:647` · 工作量 M · 风险 med
- 证据: mapview-iso.js:647 _PLOT_COST=200，_addPlot(:655-676) 只检查『自有土地上有空格』即可无限买菜地（L3 满地 16×16 减建筑后可容纳几十块），且建造面板明码标价（:736）；同一块地在 ep-shop.json:224 卖 3000 币且 max_owned=4；state.js:225-230 PLOT_UNLOCK_AT 把 +1 地块当成 Lv20/30/50/…/500 的长线胡萝卜。200 币地块按模型 <3 小时回本，之后每块地日产 1500-2000 币——既让 3000 币档变笑话，也让 Lv20-500 的地块期待感完全落空，还会指数放大金币通胀（finding 3）。
- 修复方向: 统一为一条地块价格曲线：iso 菜地价格改为递增序列（第 N 块 = 200×2^N 或读同一张表），并加数量上限 = 当前等级已解锁地块数 + 4（与 ep-shop extra_plot 上限合并成同一个计数器 extraPlots，两个入口同价同帽）。存档字段已有 extraPlots/plots[]，不需要迁移，只是购买入口收口。改动集中在 mapview-iso.js _addPlot 与 ep-shop.js extra_plot 分支。

### [P2] XP 效率倒挂：xp/h 从 Lv1 的 24 跌到 Lv8+ 的 7，最优 XP 策略永远是刷 5 分钟上海苗，Lv8 后无任何新作物改善 6h 槽位
- 位置: `data/crops.json:792` · 工作量 S · 风险 low
- 证据: 模型逐作物表：shanghai_miao 24 xp/h、Lv2-3 档 9-12、Lv4+ 全部 6-7.75，单调递减——长线作物在 XP 维度惩罚玩家。且 6h 会话间隔的最优 XP 作物自 Lv8 shan_yao(42xp/360m) 起永远不再更替：Lv10 yu_mi 只有 28xp/240m（crops.json:792 unlock_level=10 但数值弱于 Lv8 档）、Lv12 ku_gua 35xp——新解锁作物在核心槽位上打不过旧的，『升级解锁新作物』的奖励感从 Lv10 起是空头支票。
- 修复方向: 数据调整两步：① yu_mi xp 28→34、ku_gua xp 35→44、li_zhi 保持 62，让每个新档至少在一个时段槽位（4h/5h/8h）成为新最优；② finding 1 的新作物按此原则设计（苋菜 45xp/360m 明确接替 shan_yao）。长线作物可给 5-10% xp/h 溢价（li_zhi 已是 7.75 的正确方向），把『活跃刷苗 vs 挂机长线』的 XP 差距从 3.4× 收敛到 2× 以内。

### [P2] 化肥 120 币 ×2 产量在高价作物上是 ×8 正 ROI 金币放大器，而非消耗性水槽
- 位置: `data/ep-shop.json:34` · 工作量 S · 风险 low
- 证据: ep-shop.json:30-40 fertilizer_pro cost_coins=120，crops.js:167-172 施肥后额外入库一棵。对 chun_sun(960)/li_zhi(1010) 使用即 120 币换 ~1000 币，ROI 700-740%，无购买上限（ep-shop.js canBuy 同 finding 2）。抽奖轮盘还会免费掉落（ep-shop.json:253 weight 7）。Hay Day 中产量加成属于稀缺道具/钻石侧，这里是人人可无限买的币购品——高等级玩家理性玩法是每块地每茬必施肥，进一步加剧通胀。
- 修复方向: 价格与作物档挂钩：施肥时按目标作物收取 sell_price×0.4（动 tending.js 施肥结算处读作物定价），或化肥分三档（普通 120 限 Lv6 下作物 / 高级 400 / 特级 900）；再或每日施肥次数上限 5 次（dailyClaims 加一个计数字段即可，模式与 stolenToday 相同）。保持正收益但把 ROI 压到 +30-50%，让它是『加速感』而不是『印钞机』。

### [P2] 任务与订单奖励数值静态，不随等级缩放：Lv8 玩家日任务奖励只占日收入 0.2%，订单规模冻结在 1-3 行×1-3 个
- 位置: `data/tasks.json:6` · 工作量 M · 风险 low
- 证据: tasks.json:6-15 日任务 reward_coins 固定 15-40 币、周任务 100-200 币，对 Lv8+（日收入 17k+）等于噪音，earn_coins 档位也只有 150/400 两级（:9-10）；orders.js:65-77 订单永远 1-3 行、maxQty 3-4（sell_price≥18 时 3——Lv9 后所有作物都≥18，订单上限被锁死在 3 行×3 个），与 60 容量仓库和 15+ 块地完全不成比例。对照 Hay Day：订单价值/卡车规模随等级持续放大，是中后期的核心目标感来源。
- 修复方向: ① tasks.json 加高档位模板（数据即生效）：earn_coins 2000/5000（min_level 6/9，reward_coins 300/800）、harvest 15/25 高档、新增 cook 型日任务（tasks.js:151 已收 cook 事件但只计 earn_coins，需在 onEvent 加 t.type==='cook' 分支，五行内）；② orders.js _makeOrder 引入等级项：lineCount 上限 = min(4, 2+floor(level/5))、qty 上限 +floor(level/6)，coins 溢价对 4 行单提到 1.35×——大单带来『攒一仓库交一票大的』的中后期目标感。全部用农场币。

### [P2] 成就体系第 30 天耗尽，且 totalDeliveries/totalOrdersFilled/totalDishesCooked 三个终身计数器无任何成就消费
- 位置: `data/achievements.json:4` · 工作量 S · 风险 low
- 证据: achievements.json 共 12 个成就，长线锚点只有 level_10（:53，活跃玩家第 4 天达成）、totalHarvests 100（:33，约一周）、streak_30（:106，第 30 天）——之后成就页永久全绿。而存档里已在维护 totalDeliveries（state.js:111）、totalOrdersFilled（state.js:119）、totalDishesCooked（kitchen.js:244）三个终身计数器，achievements.js 的 stat 型 check 天然支持它们，纯数据就能加成就却一个都没建。
- 修复方向: achievements.json 补 8-10 个（纯数据）：level_15/level_20、harvest_500/harvest_1000、orders_50/orders_200（totalOrdersFilled）、dishes_30/dishes_100（totalDishesCooked）、deliveries_100（totalDeliveries）、streak_100。注意红线：新成就奖励改用农场币而非 reward_points（现有字段只有 reward_points=真实积分负债；需在 achievements.js 领奖处支持 reward_coins 字段，小改），EP 发放总量一分不加。

## 双语完整性 · 得分 7.5/10

> 底子非常扎实：data/i18n.json 109 个 key zh/en 双全零缺失，9 个数据 JSON（crops/tasks/achievements/events/ep-shop/recipes/news/ai-neighbors）所有 *_zh 字段都有对应 *_en，店主问候池 25/25 对称，document.documentElement.lang 随切换正确变为 en/zh-CN。CDP 实测 English 模式下商店、任务、厨房、社区、商城、积分页、新手教程、HUD、dock 全部干净英文（含 AI 邻居名都本地化成 Half-Acre Liu 等），无 raw key 泄漏。离一流的差距在边缘面：开屏页主 CTA「手机号登录·领礼包」和 3 条卖点列表完全无英文（英文优先的孩子第一屏就卡住）、天气 chip 切语言后不刷新直到重载、登录态开屏按钮硬编码中文、社区兜底昵称/系统 toast/分享 title 十来处中文残留。对标 Hay Day 的本地化工艺（零混语+即时全量切换）还差最后一层打磨。

### [P1] 开屏页主登录按钮和会员卖点列表完全没有英文
- 位置: `src/index.html:96` · 工作量 S · 风险 low
- 证据: src/index.html 96-104 行：splash-perks 三条卖点（🥬 攒超市积分…/🏘 跟邻居互动…/☁️ 进度云端保存…）和主 CTA <button id="splashLogin">手机号登录 · 领礼包</button> 只有中文，无对应 -en span；splash-wc-sub「赛程赛果 · 积分榜 · 对阵图 — 全部萨省时间」同样纯中文。截图证实（scratchpad/shot_en_collection.png 前置开屏帧）：开屏其余元素都是 zh+en 双行设计，唯独付费转化最关键的登录按钮和卖点无英文。目标用户里英文优先的孩子第一屏看不懂最重要的按钮。
- 修复方向: 沿用开屏已有的双行模式：给 splashLogin 加 .splash-start-en 式副行（Sign in with phone · claim gift），三条 perks 各加一行小号英文（或 data-i18n 化由 firebase-auth._renderSplash 按存档语言渲染，该函数已有 lang 判断先例）。

### [P1] 天气 chip 切换语言后不刷新，保持旧语言直到整页重载
- 位置: `src/js/weather.js:255` · 工作量 S · 风险 low
- 证据: CDP 实测：切到 English 并跑完 settings 的 applyLanguage 等价流程后，#weatherChip 仍显示「☀️ 萨城 14°」（cdp evalResult weatherEnChip 字段）。代码根因：weather.js 的 _renderChip() 只在 fetch 成功时调用（121/175 行），文件头注释明示 chip 只随 page load 更新；main.js 706-717 行 applyLanguage 刷了 HUD/grid/isoView/events/storekeeper，唯独没调 Farm.weather。
- 修复方向: applyLanguage 里加一行 if (Farm.weather && Farm.weather._renderChip) Farm.weather._renderChip();（数据已缓存于 this.data，纯重渲染无网络请求）。

### [P1] 登录态开屏「进入农场」按钮硬编码中文，EN 用户看到混语按钮
- 位置: `src/js/firebase-auth.js:226` · 工作量 S · 风险 low
- 证据: firebase-auth.js 226 行：已登录分支 if (zh) zh.textContent = '进入农场'; 不判断语言（副行 'Enter ›'）；对比 242 行游客分支 zh.textContent = en ? 'Just look around' : '先随便逛逛' 是判断语言的。已登录的英文用户每次打开都看到中文主行按钮。
- 修复方向: 照抄 242 行的写法：读 Farm.state.data.language，en 时主行给 'Enter farm'、副行留空或 '›'。

### [P2] 社区/邻居兜底昵称约 7 处硬编码「邻居/萨城邻居/匿名邻居/(你)」，EN 界面漏中文
- 位置: `src/js/firebase-game-sync.js:65` · 工作量 M · 风险 low
- 证据: 亲读代码：firebase-game-sync.js 65 行 return fc ? fc+'邻居' : '萨城邻居'；264 行 '匿名邻居'；272 行同 65；state.js 123 行注释明示昵称派生规则 {firstChar}邻居；home-report.js 72/114 行 fallback '邻居'；social-steal.js 175 行 thiefName || '邻居'；neighbors.js 374 行排行榜自己标记 '(你)' 无 EN 分支（同文件其余全是 lang 三元）。真实会员未设昵称时，EN 排行榜/访客记录/晨报会显示中文昵称。
- 修复方向: 抽一个 fallbackNeighborName(lang) 工具（en 用 'Neighbor'/'Saskatoon farmer'），'(你)' 改 lang==='en'?'(you)':'(你)'。注意昵称可能已写入 Firestore 快照，显示层兜底即可，勿动存档格式。

### [P2] 零散玩家可见中文残留：扩建 toast、navigator.share 标题
- 位置: `src/js/main.js:387` · 工作量 S · 风险 low
- 证据: main.js 387 行 Farm.ui.toast('扩建仅在农场视图可用') 无 EN 分支（菜单点扩建且非 iso 视图时触发）；share.js 319 行与 firebase-game-sync.js 860 行 navigator.share({ title: '东方超市·快乐农场' }) title 恒中文（text 参数倒是双语的），EN 用户系统分享面板标题是中文。
- 修复方向: toast 加 lang 三元；share title 用 lang==='en' ? 'Eastern Market · Happy Farm' : 现值。

### [P2] NPC 名称 EN 译名不统一：Little East vs 小东
- 位置: `src/js/rewards.js:89` · 工作量 S · 风险 low
- 证据: EN 截图对照：厨房标题「Little East's Kitchen」（shot2_en_kitchen.png），但积分页赚取列表显示「Deliver 小东's orders」（shot2_en_rewards.png，rewards.js 89 行 EN 字符串内嵌 小东）；orders.js 256 行账本描述也是 'Filled 小东 order'。同一 NPC 在 EN 界面两个名字，一个还是汉字。
- 修复方向: EN 文案统一用 Little East（或统一保留小东作品牌名，但要全局一致）；账本描述见下一条一并处理。

### [P2] 写入真实会员积分账本的 description 单语且中英混杂
- 位置: `src/js/ep-shop.js:68` · 工作量 S · 风险 low
- 证据: ep-shop.js 68 行 description: '商城: '+(item.name_zh||item.id) 恒中文；firebase-points.js 232 行 '首次登录：旧本地积分回填' 恒中文；orders.js 256 行 'Filled 小东 order '+id 恒英文。这些描述写进 eastern-market-members 的 points_transactions，会员在超市前端积分历史里能看到，语言随机。
- 修复方向: 账本描述建议统一固定为中文+英文双写或纯中文（Chris 客群），一次定规即可；不涉及金额逻辑（EP 经济红线不动），只改描述字符串。

### [P2] 语言切换时已打开的弹窗/提示胶囊不即时重渲染
- 位置: `src/js/i18n.js:58` · 工作量 S · 风险 low
- 证据: CDP 实测：EN→zh 切回后农场提示胶囊仍显示英文 'Your plots are empty — plant something!'（evalResult latinLeft），约 20s 后随 harvest-status 轮播 tick 自愈；i18n.applyAll() 只处理 [data-i18n] 的 textContent（i18n.js 58-64 行），动态 innerHTML 面板靠各自下次渲染。实际影响低（切语言必经设置弹窗，closeModal 后再开的面板都正确）。
- 修复方向: applyLanguage 里追加 Farm.harvestStatus && Farm.harvestStatus.render()，与已有的 refreshHUD/renderGrid 并列即可；不必做全局重渲染框架。

### [P2] 世界杯观赛台纯中文（店主有意，7/19 退场）——仅备注
- 位置: `src/js/worldcup.js:1205` · 工作量 S · 风险 low
- 证据: worldcup.js 271 行含中文（全文件最多），hub 内容纯中文系店主决策。EN 界面下的入口观感：开屏 banner 主行中文但副行有 'FIFA WORLD CUP 26 · LIVE HUB'（shot_en_farm 前帧截图），游戏内重入按钮是纯 ⚽ 图标（worldcup.js 1737 行）+ aria-label 双语——EN 用户可辨识，观感可接受。
- 修复方向: 不修。7/19 退场时随入口一并移除即可；若延期再评估 banner 副行加一句英文 sub。

## 交互手感 · 得分 6/10

> 基础盘扎实：tap/drag 判定阈值 12px 合理、地块按压有即时白菱形高亮（不等 rAF 节流当帧渲染）、拖拽 1:1 跟手、捏合缩放以双指中点为锚、开局 autoFrame 保证地块屏宽 ≥53px、粘性连种实测 5.9ms 内完成种植+反馈、收获有 burst/连击/金币雨/modal 队列等完整 juice 层，四轮 CDP 实测零异常零崩溃。但离 Hay Day 级还有三道硬伤：(1) 成熟作物命中盒是全格宽×3.85格高的矩形，实测吞掉相邻空地 56%–100% 的点击面积——点空地会收邻居的菜、被夹在两棵熟菜中间的空地完全无法点种，核心循环里「点错目标」高频发生；(2) 相机松手即停，全代码无任何惯性/回弹（对标线明确算 P1）；(3) 最高频主操作「一键全收」胶囊仅 26px 高、金币/积分卡 23px、建造钮 39px，44px 热区补丁只打到了汉堡钮和 modal 关闭钮。达标线 5 项里干净通过约 2 项。

### [P1] 成熟作物命中盒吞掉相邻空地 56%–100% 的点击：点空地收了邻居的菜，夹在熟菜中间的空地无法点种
- 位置: `src/js/mapview-iso.js:482` · 工作量 M · 风险 med
- 证据: 代码：_plotAtPoint 对已种地块用矩形盒 halfW=tw*0.5（全菱形宽）、top=c.y-th*(0.7+3*0.6)=向上2.5格、front-to-back 优先命中（467-483 行）。CDP 实测（本地 8203 端口+合成 PointerEvent）：对空地 plot0 自身菱形区(d<=0.88)网格采样 145 点，右前方一棵熟辣椒时 56% 采样点命中邻居；右前+左前两棵熟菜时 100% 被劫持(own=0)。端到端：在空地苗床视觉中心 dispatch pointerdown/up -> 按压高亮亮在邻居格(2,2)、邻居被收获(warehouse+1、plot1.crop 变 null)、选种器未弹出。
- 修复方向: 两段式命中：第一遍先对所有地块做精确菱形测试（沿用空地的 d<=0.88），命中即返回；仅当无精确命中时才回退到高盒（接住点在植株上半身的 tap）。高盒宽度同时收窄到苗床宽（BED_W 0.88 的一半宽），盒底裁到自身菱形不向下侵占。改完用同一 CDP 采样脚本回归验证 stolenPct。

### [P1] 拖拽松手即停：无惯性滑行、无边缘回弹，对标无尽冬日/Hay Day 的相机手感缺失
- 位置: `src/js/mapview-iso.js:428` · 工作量 S · 风险 low
- 证据: CDP 实测：模拟 6 帧连续 pointermove 拖拽后 pointerup，松手瞬间 camX 位移 90px，其后 400ms camX 变化=0（inertiaDelta=0）。代码证据：grep inertia|momentum|velocity|glide 全文件零命中；_up()（431-462 行）直接清 _drag 无任何释放后动画；_clampCam 是 Math.max/min 硬截断，无弹性边缘。
- 修复方向: 在 _move 里用最近 2-3 个 pointermove 记录速度(px/ms)，_up 时若速度超阈值启动 rAF 衰减循环（每帧 cam += v*dt、v *= ~0.93，低于 0.5px/帧停止），每帧过 _clampCam。纯增量十几行 vanilla JS，不动现有 tap 判定。

### [P1] 最高频主操作触控目标低于 44px：一键全收胶囊 26px 高、金币/积分卡 23px、建造按钮 39px
- 位置: `src/css/style.css:656` · 工作量 S · 风险 low
- 证据: CDP getBoundingClientRect 实测（390x844 视口）：#harvestStatusCenter 133x26（『N 棵已熟可收』一键全收入口，每日最高频动作）、#coinsCard 54x23、#pointsCard 42x23（均为可点按钮开兑换/明细面板）、isoBuildBtn 90x39（mapview-iso.js 719 行 padding 11px 16px）。对照组：hamburger 36px+::after 外扩4px=44（style.css 4107）、modal 关闭钮 34+::after 外扩5px=44（2115）已打补丁，这几个没打。.harvest-status-center 只有 padding:4px 12px 无 min-height（649-660 行）。
- 修复方向: 同项目已有的 ::after 透明外扩热区手法（style.css 4105-4107 注释就是模板）套到这三处；收获胶囊可直接 min-height:44px（所在条有空间），currency 卡 ::after inset:-11px 0。纯 CSS。

### [P2] 捏合缩放后剩余单指变死指：必须全部抬起重新按下才能继续平移
- 位置: `src/js/mapview-iso.js:434` · 工作量 S · 风险 low
- 证据: CDP 实测：双指捏合缩放成功（zoom 变化 +0.804），抬起一指后剩余手指连续 6 次 pointermove，camX 变化=0（remainingFingerPanDelta=0）。代码：_down 384 行进捏合时 _drag=null；_up 434 行指针<2 时清 _pinch 但不为存活指针重建 _drag；_move 424 行平移需 this._drag 存在。Hay Day/无尽冬日捏合后单指无缝续拖。
- 修复方向: _up 里检测『刚结束捏合且剩 1 个指针』时，用该指针当前位置重建 _drag（moved 预置 true 防误判 tap）。约 3 行。

### [P2] 一键全收时每块地的采摘 burst 粒子全部错位生成在屏幕 (0,0) 左上角
- 位置: `src/js/farm.js:296` · 工作量 S · 风险 low
- 证据: CDP 实测：iso 视图种 3 块熟菜后调 harvestStatus.harvestAll()，document 里 burst-particle 全部 left:0px/top:0px（采样 6 个全是）。根因链：harvest-status.js 120 行 harvestPlot(idx) 不传 evt -> farm.js 288-300 行取隐藏 DOM 地块(display:none 的 #farmGrid 内) rect 为 0x0，evt 兜底分支(296 行)因 evt 为 undefined 不生效 -> bx=by=0。单点收获走 _fakeEvt 路径位置正确，只有全收批量路径坏。
- 修复方向: harvestAll 循环里为每个 idx 构造 fake evt：iso 激活时用已有的 Farm.isoView.plotScreenRect(idx)（spotlight 引导已在用）转矩形传入 harvestPlot；DOM 视图不受影响。

### [P2] modal 关闭无退出动画硬切消失；dock 随 modal 开关瞬间消失/重现
- 位置: `src/js/ui.js:165` · 工作量 S · 风险 med
- 证据: hideModal()（ui.js 165-184 行）直接加 .hidden；style.css 2066 行 .modal.hidden{display:none}，CDP 验证 hide 后 computed display 立即为 none。开窗有 modalIn 0.25s 弹性动画（2086 行）但关窗零过渡，视觉不对称。style.css 2048 行 body.modal-open #bottombar{display:none} 令 dock 同样硬切。Hay Day 面板关闭有 150-200ms 缩退。
- 修复方向: 关窗时先加 .closing 类播 150ms 反向 scale/fade（期间 pointer-events:none），animationend 或 setTimeout 后再落 .hidden；注意 MEMORY 里 feedback_modal_pointer_events 教训——关闭动画期间容器必须 pointer-events:none 防吞点击。dock 可用 transform:translateY 过渡替代 display:none。

### [P2] toast 单槽覆盖：连续奖励提示互相顶掉，前一条被截断
- 位置: `src/js/ui.js:194` · 工作量 M · 风险 low
- 证据: CDP 实测：toast('第一条') 后 200ms toast('第二条')，#toast textContent 立即变『第二条』，第一条 2800ms 展示被截断。代码：ui.js 186-206 单一 #toast 元素 innerHTML 覆写 + clearTimeout。而 farm.js 348-363 行收获 bonus（金疙瘩/今日首收/周末流星）按 600+i*700ms 排队发多条 toast，间隔 700ms < 2800ms 时长，必然互相覆盖。
- 修复方向: 小型 toast 栈：容器内最多堆 2-3 条竖排，各自独立计时淡出；或收获路径把同一次结算的多条 bonus 合并成一条多行 toast。

### [P2] 收获后快速连点同一块地立刻弹出选种器，打断连续收获节奏
- 位置: `src/js/mapview-iso.js:512` · 工作量 S · 风险 low
- 证据: CDP 实测：孤立熟菜双击（两次 tap 间隔 60ms），第一击收获(warehouse=1)，第二击 250ms 内 modal 已打开（选种器）。代码路径：_tapCell 509-513 行，收获后地块变空，紧跟的 tap 走 !plot.crop 分支直接 openSeedPickerForPlot。快速扫收多块地时手速快就会被模态窗打断。
- 修复方向: harvestPlot 成功时记录 {plotIdx, t}；_tapCell 对空地开选种器前检查该地块 400ms 内刚被收获则忽略本次 tap（粘性连种激活时不受影响，仍直接连种）。

### [P2] canvas 无 setPointerCapture：桌面鼠标拖拽移出画布即失控冻结
- 位置: `src/js/mapview-iso.js:184` · 工作量 S · 风险 low
- 证据: grep setPointerCapture 全仓库零命中（CDP 探测 l_setPointerCapture=false）；pointerdown/move/up 只挂在 cv 上（init 184-188 行）。触摸有隐式指针捕获不受影响；鼠标拖拽一旦移出 canvas 边界 move/up 不再到达 -> 平移冻结、松键无 _up。妈妈们手机为主影响小，但桌面/平板鼠标是明确粗糙点。
- 修复方向: _down 里 try{ cv.setPointerCapture(e.pointerId) }catch{}，一行修复，touch 行为不变。

### [P2] 建筑按压无任何视觉反馈：按压高亮只做了地块，谷仓/小屋按下无响应感
- 位置: `src/js/mapview-iso.js:400` · 工作量 M · 风险 low
- 证据: _down 399-403 行 _pressCell 仅由 _plotAtPoint 命中设置，_buildingAtPoint 不参与；按压建筑到 pointerup 打开仓库/商店 modal 之前无任何按下状态（Hay Day 建筑按压有 squash 缩放）。截图确认建筑（谷仓/小屋）是主要 tap 目标之一（打开仓库=卖货入口）。
- 修复方向: _down 里若 _buildingAtPoint 命中则记 _pressBuilding 索引，render 的 _drawBuilding 对该索引画 scale(0.96) 或提亮一档，up/cancel 清除——复用 _pressCell 同一套生命周期。

## 视觉工艺 · 得分 5.5/10

> 面板/弹窗系统已经相当接近 cozy premium：木牌标题+奶油卡+圆角+暖绿色板高度统一，农场商城、种子店、任务、七日签到的卡片工艺是全游戏最好的部分。但玩家 90% 时间停留的农场主视图是全局最弱一屏：竖屏开局农场只占屏高约 20%、上方近半屏是空天空（已知项①确认），锁定地块 9 个 🔒+Lv 徽章互相压盖，顶栏天气 chip 在 360–390px 被水平裁成表情碎片。开屏页在 360px 宽世界杯横幅整体破版（LIVE 徽章压标题、三行文案糊成一团），游客入口文字叠在插画上几乎不可见。全部 UI chrome 图标依赖 emoji（dock、菜单、标题、锁、今日按钮），跨平台渲染色彩/单色混杂，是与 Hay Day 级工艺之间最系统性的差距。

### [P1] 竖屏开局镜头构图失衡：农场只占屏高约20%，上方近半屏空天空
- 位置: `src/js/mapview-iso.js:293` · 工作量 M · 风险 med
- 证据: 截图 shots/02-farm-390.png、05-farm-360.png（scratchpad/shots/）：390×844 与 360×780 两档下农田+建筑压缩在纵向 55%~65% 带内，0~50% 全是山丘/天空，蝴蝶 emoji 悬浮空中。代码 src/js/mapview-iso.js:267-296 _autoFrame：fitW 仅取视口宽 65%，_camY 落点再被 _clampCam (343-364行) 的背景 cover 约束垂直钉死（'Vertically it's pinned tight'），导致草地带永远偏下。
- 修复方向: 调整 _autoFrame 的 camY 目标（-cssH*0.14 偏移）与 _clampCam 的 BG_FY 锚定比例，让草地带上移、农场包围盒占竖屏高度 55-65%；或裁切背景图上部天空后重算锚点。改完用 scripts/verify/cdp.mjs 量农场包围盒屏占比回归。

### [P1] 顶栏在 360-390px 溢出：天气 chip 被水平裁成表情碎片挤在货币 pill 旁
- 位置: `src/css/style.css:141` · 工作量 S · 风险 low
- 证据: 截图 05-farm-360.png：C100 与 P0 之间夹着一条被裁到只剩半个字形的碎片；02-farm-390.png 中 chip 只露出 ☀ 半截。CDP 实测 chip 全宽 79px（文本'☀️ 萨城 14°'）。src/css/style.css:141 媒体查询阈值仅 max-width:339px 才隐藏 chip，而 .topbar-right 是 flex-shrink:0（style.css:205 区段），空间不足时只能挤压 brand-cluster 把 chip 裁碎。
- 修复方向: 把隐藏阈值从 339px 提到 ~430px（或改为 brand-cluster 内 overflow:hidden + chip min-width:0 时直接 display:none），保证 chip 要么完整显示要么不显示，绝不半截。

### [P1] 顶部状态胶囊文案折成两行且断点破词（已知项②确认，360/390 均复现）
- 位置: `src/js/harvest-status.js:96` · 工作量 S · 风险 low
- 证据: 截图 04-signpill-390.png：'今日还没签到 · 点\n我领奖励'在'点/我'之间断行，chevron 掉到第二行；05-signpill-360.png 连默认文案'地都空着，种点什\n么吧'也折行。文案在 src/js/harvest-status.js:94-102 _renderSignHint（'📅 今日还没签到 · 点我领奖励'），容器 .harvest-status-center 允许 wrap（src/css/style.css:649-660 min-width:0 注释'allow the text to shrink/wrap'）。
- 修复方向: 缩短文案（如'签到领奖 ›'/'Check-in gift ›'）并给 .harvest-status-text 加 white-space:nowrap + text-overflow:ellipsis，或按容器宽用 12px 字号降档；390px 单行是验收线。

### [P1] 全部 UI chrome 图标用 emoji，跨平台渲染彩色/单色混杂，质感低于商业标准
- 位置: `src/index.html:276` · 工作量 L · 风险 low
- 证据: src/index.html:275-292 底部 dock 图标为 📋🛒🌾☰；src/js/main.js:358-368 汉堡菜单 11 项全 emoji；modal 标题牌 🛒📦🍳⚙️🗓、今日按钮 🌅（index.html:137）、canvas 锁 🔒（mapview-iso.js:1204）。截图 03-menu-390.png 中'社区'🏘 渲染为黑色单色字形而相邻图标全彩，同一网格内两种图标语言并存；03-kitchen-390.png 标题 🍳 渲染成深色团块。
- 修复方向: 为 dock/菜单/标题牌/锁等 chrome 位手绘一套内联 SVG sprite（与 crop-art.js 的圆润风格一致，零外部依赖），emoji 只保留在数据语义处（作物图标、奖励文案）。分批替换：dock+汉堡菜单先行。

### [P1] 锁定地块徽章互相压盖：9 块锁定地各画一个 🔒+Lv，相邻格文字被遮挡
- 位置: `src/js/mapview-iso.js:1204` · 工作量 M · 风险 med
- 证据: 截图 02-farm-390.png / 05-farm-360.png：锁定区 Lv 数字（'Lv?'）被邻格 🔒 emoji 盖住，多个徽章叠成一团噪点，开局第一屏即可见。代码 src/js/mapview-iso.js:1204-1205：每个未解锁 plot 在格心 fillText('🔒') + fillText('Lv'+REQUIRED_LV[idx])，无相邻去重。
- 修复方向: 按解锁等级把相邻锁定格聚合成一个组徽章（每个 Lv 环只画一枚居中的锁+Lv 牌），其余格只画变暗地皮；或缩小徽章到格宽 40% 并只在 zoom 超过阈值时显示文字。

### [P1] 开屏世界杯横幅 360px 整体破版：LIVE 徽章压在标题上、三行文案糊成一段
- 位置: `src/css/worldcup.css:599` · 工作量 S · 风险 low
- 证据: 截图 06-splash-360.png：标题断成'萨省观赛/台'且'观赛'两字被绝对定位的 LIVE 徽章直接覆盖，中英文案与 meta 行连排成一团。代码 src/index.html:76-82 三个文字 span（splash-wc-zh/en/sub）为 inline span 未设 display:block（src/css/worldcup.css:599-601），窄屏自然回流连排；.splash-wc-pill 绝对定位 top:8px right:12px（worldcup.css:603）不避让文字。
- 修复方向: splash-wc-zh/en/sub 各设 display:block；LIVE 徽章改为标题行内 inline-flex 元素或给 splash-wc-txt 加 padding-right 避让；≤380px 时隐藏 splash-wc-sub 行。

### [P1] 开屏游客入口'先随便逛逛'叠在小屋插画上，对比度接近不可见
- 位置: `src/css/style.css:1233` · 工作量 S · 风险 low
- 证据: 截图 01-splash-390.png / 06-splash-360.png：中文'先随便逛逛'与英文'Just look around ›'直接压在屋顶/烟囱插画上，肉眼几乎读不出（浅棕文字 over 米黄墙+红棕屋顶）。代码 src/css/style.css:1233-1244 .splash-start--ghost：background:none、color:var(--warm-text-soft)、无任何衬底。这是游客转化的唯一次级 CTA。
- 修复方向: 给 ghost 按钮加半透明奶油胶囊底（rgba(255,253,246,.85) + 圆角 + 1px 描边），或把按钮上移到插画区外的纯色背景带内。

### [P2] 设置面板原生蓝色复选框破坏暖色调色板
- 位置: `src/css/style.css:1` · 工作量 S · 风险 low
- 证据: 截图 03-settings-390.png：'在农场上显示宠物+装饰品'与'显示在邻居列表里'两个 checkbox 呈系统亮蓝色（Chrome 默认 accent），与全屏奶油+暖绿色板冲突。grep src/css/style.css 无任何 accent-color 声明。
- 修复方向: 全局加 input[type=checkbox]{ accent-color: var(--leaf-green); }（一行，全浏览器支持，无依赖）。

### [P2] 图鉴 modal 标题固定'蔬菜图鉴'，切到成就/成长之路 tab 不变
- 位置: `src/js/main.js:476` · 工作量 S · 风险 low
- 证据: 截图 03-achievements-390.png：当前激活 tab 是'成就'（解锁 0/12 成就列表），顶部木牌标题仍是'📖 蔬菜图鉴'。代码 src/js/main.js:476 modal-title 写死 collection_title，tab 切换只重渲 body。
- 修复方向: 标题随 _collectionTab 切换（作物图鉴/成就/成长之路），或把固定标题改为中性的'图鉴'。

### [P2] 世界杯观赛台场馆行 CJK 断行：'10:00 萨/省'跨行拆词
- 位置: `src/js/worldcup.js:1` · 工作量 S · 风险 low
- 证据: 截图 04-wc-390.png 今日焦点战卡：'Mercedes-Benz Stadium · Atlanta, Georgia · 10:00 萨\n省'——时区后缀'萨省'被拆到两行。渲染来自 src/js/worldcup.js 焦点卡 venue 行模板。
- 修复方向: 把'10:00 萨省'包进 white-space:nowrap 的 span（时间+时区永远同行），或场馆与时间分两行渲染。

### [P2] 装饰性 emoji 蝴蝶与椭圆云雾贴片和手绘背景风格冲突
- 位置: `src/js/mapview-iso.js:1462` · 工作量 M · 风险 low
- 证据: 截图 02-farm-390.png / 06-bubble-390.png：🦋 以平面 emoji 字形随机悬浮在天空/湖面/锁徽章上（src/js/mapview-iso.js:1462 ctx.fillText('🦋')），白色半透明椭圆云团（05-signpill-360.png 左上）边缘生硬像渲染瑕疵而非云。
- 修复方向: 蝴蝶换成 2-3 帧手绘 PNG sprite（与 crop-art 同风格）并限制活动区域在草地带；云改用多层径向渐变叠加+更低不透明度或预渲染云朵图。

### [P2] 种子店卡片 360px 时 ×N 库存 chip 掉行导致相邻卡高度不齐
- 位置: `src/css/style.css:1` · 工作量 S · 风险 low
- 证据: 对比截图 03-shop-390.png（'5m ×3'同行）与 06-shop-360.png（×3/×2 掉到独立一行，上海苗/小葱/香菜卡被撑高，与右列锁定卡节奏错开）；且'今日-50%'角标左缘被卡片圆角裁掉一角。
- 修复方向: 种子卡 meta 行改 flex nowrap + 字号 11px 降档，保证时长与库存 chip 在 320px 卡宽内同行；折扣角标 left 偏移收进卡片内。

## 健壮性 · 得分 8.5/10

> 健壮性是这个项目目前最扎实的维度，四条达标线全部实测通过：10 种存档注入（垃圾串/"null"/半截 JSON/空数组/嵌套类型全错）全部优雅恢复不白屏；SW 全量预缓存（66 项）让「杀服务器+断网冷启动」也能完整进场并可玩（38 种作物从缓存加载）；进场→种→收→卖→14 个面板×8 轮开关→狂点按钮全程 0 未捕获异常、0 未处理 rejection；定时器普查在 ~120 次面板开关后 active 数稳定在 11-12 无增长（kitchen 倒计时用「DOM 不在就自清」模式，很干净）；localStorage 全接口 throw 时仍能进场内存态游玩并只弹一次诚实提示。2026-07-05 的 boot 加固回归通过。离一流的差距只剩打磨项：存档标量字段不做类型消毒（coins:"abc" 会被持久化并串接成 "abc10"）、plots 空数组漏过守卫变成零地块、save.version 写了但从未被读取（无 breaking 格式迁移钩子）、后台 EP 同步 fetch 无超时（挂死时既不回滚也不进队列）。

### [P2] 存档标量字段无类型消毒——corrupted-but-parseable 存档的错误类型被接受并持久化回写
- 位置: `src/js/state.js:303` · 工作量 S · 风险 low
- 证据: 实测注入 {"coins":"abc","level":"x","xp":null} 后刷新：游戏正常进场（无异常），但 state.data.coins==="abc"（HUD 显示 abc），执行 addCoins(10) 后 coins==="abc10"（字符串串接），且 savedBackValid=true 即污染值被 save() 持久化回 localStorage；level:"x" 使 checkLevelUp 的 xpForLevel("x"+1) 永远算出 NaN → 永不升级、无任何报错。另注入 coins:1e999 → Infinity → JSON.stringify 回写成 null。根因：state.js:303 Object.assign(深拷贝STARTER, parsed) 对顶层标量直接覆盖，仅 plots/seeds/嵌套对象有形状守卫（state.js:307-323），数字字段无 Number()+isFinite 校验
- 修复方向: init() 的 Object.assign 之后加一个小型 sanitize pass：遍历 STARTER_STATE 中 typeof===number 的顶层键（coins/level/xp/totalHarvests 等），对 this.data 同键做 Number() 转换，!isFinite 时回落 STARTER 默认值；同理 typeof===string 的键非 string 时回落。纯 vanilla JS 十几行，放在现有硬化块（307-323 行）旁边即可

### [P2] plots 空数组漏过 Array.isArray 守卫——玩家零地块进场，游戏不崩但完全不可玩
- 位置: `src/js/state.js:307` · 工作量 S · 风险 low
- 证据: 实测注入 {"version":999,"plots":[]} 后刷新：boot 无异常、开屏可点、iso 画布渲染，但 plotCount===0——没有任何土地可种，游戏死局且无自愈路径（save() 会把空 plots 继续持久化）。根因：state.js:307 守卫是 if(!Array.isArray(this.data.plots)) 才回落 STARTER，空数组 [] 通过检查；applyCloudSave（state.js:449）走同一 Object.assign，云端坏 blob 同样能带入空 plots
- 修复方向: 守卫从 !Array.isArray(plots) 收紧为 !Array.isArray(plots) || plots.length===0（或 <4，即起始解锁数），命中即深拷贝 STARTER_STATE.plots；applyCloudSave 复用同一判断。一行改动

### [P2] save.version 字段写死 1、全库无任何读取——breaking 格式改动没有迁移钩子
- 位置: `src/js/state.js:10` · 工作量 S · 风险 low
- 证据: state.js:10 STARTER_STATE 含 version:1 且文件头注释明言 "Always version the save format. Migrate old versions explicitly"（CLAUDE.md 也要求存档格式改动必须版本迁移），但 grep 全部 src/js/ 无一处读取 parsed.version / data.version（实测注入 version:999 的未来版本存档被静默接受）。现有迁移全靠 Object.assign 补字段 + ad-hoc 补丁（bumperCharges 迁移 state.js:314、crop alias state.js:499），只能应付「加字段」，任何字段语义变更/重命名都无版本分支可挂
- 修复方向: init() 解析成功后读 parsed.version：小于当前版本走显式 migrate 链（现在就把 bumperCharges 迁移挪进去作为 v1→v1 示例位）；大于当前版本（旧代码读新存档，PWA 缓存回退时真会发生）先把原始串备份到 eastern_farm_save_backup key 再继续 best-effort 加载——existing 存档格式不变，纯加钩子，符合红线

### [P2] 后台 EP 同步 _callStockWise 无超时——挂死的 fetch 既不触发乐观回滚也不进重试队列
- 位置: `src/js/firebase-points.js:80` · 工作量 S · 风险 low
- 证据: firebase-points.js:80 _callStockWise 用裸 await fetch(...)（无 AbortSignal/无 Promise.race）；对比同文件 claimStorePurchaseRewards（firebase-points.js:204-210）已有 15s race 超时+调用方重试 UI。syncEpEarn 只在 fetch reject 时才 enqueue 重试（catch 分支 firebase-points.js:141-151），state.js:597-611 的乐观积分回滚也只在 promise resolve 出 rejected 时执行——若 fetch 永挂（弱网/iOS，正是 main.js:80 注释记载的 boot 挂死同款根因，memory feedback_loading_state_must_be_recoverable 亦有此教训），该笔 earn 既不回滚也不入队，本地 EP 与服务器静默漂移到下次登录对账。注意这只影响一致性时效，不产生多付（服务器是权威且有 eventId 幂等），不触碰 EP 经济红线
- 修复方向: 给 _callStockWise 加默认 15s Promise.race 超时（照抄同文件 claimStorePurchaseRewards 的现成模式），超时抛 code:'timeout' 的 Error → 自然落入 syncEpEarn 现有 catch 的「网络失败→enqueue」分支（timeout 不在 429/422/404/401/403 终态名单里，语义正确）。全部现有调用方行为不变

### [P2] 游客排行榜 Firestore 权限报错被静默吞掉，榜单退化为纯 AI 无任何提示
- 位置: `src/js/firebase-game-sync.js:1` · 工作量 S · 风险 low
- 证据: 实测游客打开 社区→排行榜：console 出现 "[gameSync] fetchLeaderboard failed FirebaseError: Missing or insufficient permissions."（登录态 Firestore 规则拒绝匿名读），UI 无报错、无提示地只显示 2 个 AI 邻居（悠然见南山/半亩良田）——健壮性上算优雅降级（不卡不崩，断网下同样表现），但玩家不知道「登录后能看到真人排行」，与开屏卖点『跟邻居互动』的转化钩子脱节。列为观察项供 Chris 决策，不是必修
- 修复方向: 在排行榜 tab 的游客路径 catch 到 permission 错误时，于 AI 榜单底部加一行静态引导文案+登录按钮（复用好友 tab 已有的『登录后才能添加好友』同款处理，该处实测已是正确示范）；纯前端文案改动

## 新手引导 · 得分 5.5/10

> 三层引导架构（一次性3步欢迎窗 tutorial.js → 聚光灯手把手 spotlight.js → just-in-time 单条 coach.js + 可随时回看的 guide.js）是对标一流手游的正确形态：新玩家 30 秒内确实进入第一次种植，首棵魔法速熟（借鉴 Hay Day）让种→收在 60 秒内完成，可跳过、不霸屏。但执行有一处致命断裂：引导第三步「卖给东方超市」在实测新号下不可完成——开局自动生成的小东订单把仅有的一棵菜全额保留，本次可卖 C0，聚光灯永远卡在 step 2 直到玩家自己点跳过；且引导中断/刷新后永不恢复（maybeStart 唯一调用点在欢迎窗按钮里）。再叠加「小白菜约30秒」的假承诺（实际5分钟，种子卡同屏就写着 5m）和教学后 4-5 分钟无事可做的空窗，闭环教学的后半段基本失效。结构 7 分、执行 4 分，离 Hay Day 级 FTUE 的差距主要在鲁棒性（引导必须保证能走完）和前 15 分钟连续短循环节奏。

### [P0] 引导第三步「卖给东方超市」新号常态下无法完成：唯一一棵菜被订单板全额保留，聚光灯永久卡在 step 2
- 位置: `src/js/spotlight.js:168` · 工作量 S · 风险 low
- 证据: 全新存档 CDP 实测（trusted input，390×844）：完成引导种植+收获后仓库仅 1 棵上海苗；开局自动生成的订单板需求为 cilantro×4 + xiao_cong×2 + shanghai_miao×2——三种起始种子全部被覆盖，无论玩家选哪种都会被保留。仓库弹窗截图显示「留1 / 已为小东订单留1件 / 本次可卖 C0」，点「卖给东方超市」后 state dump: {step:2, active:true, totalDeliveries:0}。代码链：state.js:814 deliverWarehouse 按 orders.reservedNeeds() 保留 → 卖出 0 → state.js:838 totalDeliveries 不自增 → spotlight.js:168 的完成条件 (totalDeliveries>base) 永假；orders 交付路径不加 totalDeliveries（grep 全仓库仅 state.js:838 一处自增）。玩家被留在全屏变暗遮罩+「点谷仓」指令的死循环里，+50 币完成奖励也拿不到，唯一出路是自己发现「跳过引导」。
- 修复方向: 三选一（都不动存档格式）：① spotlight._active 时 deliverWarehouse 跳过保留（或 reservedNeeds 返回空）；② 引导期第一棵菜标记为不可保留；③ spotlight step 2 的完成条件同时监听 totalHarvests 后的任意变现事件（订单交付也算）并把气泡指向可行动作。首选 ①，改动最小。

### [P1] 引导中断（刷新/关页/点✕）后永不恢复，玩家半途被扔进无引导的开放农场
- 位置: `src/js/spotlight.js:70` · 工作量 S · 风险 low
- 证据: Farm.spotlight.maybeStart() 全仓库唯一调用点是 tutorial.js:81 的「开始种菜」按钮回调。实测：引导进行中页面重载后再入（点先随便逛逛），state: {spotlightOverlay:false, spotActive:false, spotlightDone:false, tutorialV1Done:true}——没人再调 maybeStart；且 spotlight.js:70 的守卫 cropsEverGrown.length>0 会把已种过 1 棵菜（引导前半段）的玩家直接标记 spotlightDone=true 静默放弃。截图 f10：重载后玩家面对空农场，无任何续接引导，底部 dock 还被 PWA 安装横幅盖住。
- 修复方向: main.js wireSplash 回调里（tutorial.maybeShow 之后）补一次 spotlight.maybeStart()；把 cropsEverGrown 守卫放宽为「已有交付记录 (totalDeliveries>0)」，让种过但没卖过的半途玩家能续上后半段。

### [P1] 教程文案假承诺「小白菜约 30 秒」，实际生长 5 分钟，且与同屏种子卡「⏱5m」直接矛盾
- 位置: `data/i18n.json:1` · 工作量 S · 风险 low
- 证据: i18n.json tutorial_step2_body: "种子会自己长大（小白菜约 30 秒）" / en "bok choy ~30 sec"。crops.json shanghai_miao grow_minutes=5；crops.js growMultiplier() 只计算温室/水井加成（新号=1.0），无任何新手加速——魔法速熟仅限 spotlight 第一棵。实测截图 f04 种子选择器同屏显示「⏱5m」。玩家按承诺等 30 秒发现纹丝不动，是 FTUE 信任损伤。
- 修复方向: 改文案为「约 5 分钟」并顺势教浇水（-20% 时间）；或若想保 30 秒的爽感，给 Lv1 加一个真 30-60 秒的教学作物（需过一遍经济数值，注意别产生刷币口）。改文案是零风险路线。

### [P1] 教学闭环后 4-5 分钟无事可做的空窗期，前 15 分钟节奏远逊 Hay Day 标准
- 位置: `data/crops.json:1` · 工作量 M · 风险 med
- 证据: 数据实证：Lv1 三种作物 grow 5/5/8 分钟；xp_reward 均 2；升 Lv2 需 10 XP（state.js XP_TABLE_FIXED）= 5 次收获；首单小东订单 xp=totalQty*3+(lines-1)*4≈20 但依赖 5-8 分钟生长。时间线推演：0:30-1:30 引导循环结束后，下一个有意义节拍（第 2 次收获）在 ~5 分钟外（浇水后 ~4 分钟），期间只有翻菜单可做；Lv2 解锁新作物最快也在 6-10 分钟。对标：Hay Day 用 1 分钟小麦让新玩家前 15 分钟连跑 3-4 个完整循环并保证首次升级在前 10 分钟内密集发生；本作首会话只有 1 个即时循环 + 漫长等待，教程甚至主动说「出门买菜、做饭、回来收都行」——对留存主动放手太早。
- 修复方向: 给 Lv1 加 60-90 秒短周期教学作物（限低价值防刷），或首会话前 3 棵作物享受一次性 4× 加速（存档加 firstSessionBoost 计数即可，不动存档版本）；同时把首单订单的所需数量在 Lv1 调低到「引导收获+1 棵」即可完成，把首个大节拍从 8 分钟拉到 3 分钟内。

### [P1] 新手看到的第一条店主提示教的是「金币换超市积分」——高级功能抢占核心循环教学位
- 位置: `src/js/ui.js:62` · 工作量 S · 风险 low
- 证据: ui.js:62 触发条件 s.coins>=100，而游客开局余额恰好 100 币 → boot 后第一次 refreshHUD 即触发。实测两轮全新存档 coachSeen 第一条均为 first_coins_exchange，店主气泡在玩家还没种第一棵菜时就显示「🪙 农场币攒到一些啦！点左上角金币卡，可换成超市积分」。coach 每条一生只弹一次，这个最宝贵的首条位被非核心（且指向店主真实负债方向的 EP 兑换）占用，而不是核心循环提示。
- 修复方向: 阈值改为高于开局余额（如 ≥300）并追加 totalDeliveries>0 条件——玩家至少完成一次卖货后再教货币兑换。一行改动。

### [P2] 聚光灯洞对空地画得过高：发光框 60% 罩在空草地上，视觉指向含糊
- 位置: `src/js/mapview-iso.js:535` · 工作量 S · 风险 low
- 证据: plotScreenRect 统一返回 top=c.y-th*1.6, height=th*2.2 的高盒（为成株高度设计）。截图 f03/f11：step 0 时黄框主体在地块上方的空草地，地块床只贴着洞的底缘，👆 箭头与洞中心均不落在棕色床上。实测 trusted tap 洞中心能命中（_plotAtPoint 对空地有宽容盒），功能可用，但「点这块发光的地」指向的发光区大半不是地。
- 修复方向: plotScreenRect 按地块状态返回：无作物时用矮盒（top=c.y-th*0.5, height=th*1.4）对准菱形床；有作物时保留高盒。spotlight 洞随之贴床。

### [P2] 「跳过引导」点击目标仅 60×21px，低于 44px 移动端最小标准
- 位置: `src/css/style.css:2932` · 工作量 S · 风险 low
- 证据: 实测 getBoundingClientRect: {w:60, h:21}；第一次 trusted tap 打在按钮上缘 0.05px 外未触发（skip 未执行，spotlightDone 仍 false），第二次打正中心才生效。目标用户含手大的家长，21px 高的文字链接容易连点不中，而这是被卡住玩家（见 P0）唯一的逃生口。
- 修复方向: .sl-skip 加 padding 把命中区撑到 ≥44px 高（视觉可保持小字），或改为带边框的次级按钮。

### [P2] 欢迎弹窗可被 ✕ 关闭绕过，spotlight 本会话丢失且流程状态不一致
- 位置: `src/js/tutorial.js:73` · 工作量 S · 风险 low
- 证据: 截图 f02 显示弹窗右上有 modal 通用 ✕。tutorialV1Done 只在「开始种菜」按钮回调置位（tutorial.js:74），spotlight.maybeStart 也只在该回调触发（:81）。点 ✕ → 本会话无 spotlight；tutorialV1Done=false 下次又弹同一欢迎窗（轻度重复骚扰）；若期间种过菜，下次 maybeShow 在 :19-23 静默标记完成——玩家从未见过后半段引导却被记为已完成。
- 修复方向: showModal 的 ✕/背板关闭对 tutorial 弹窗也走与主按钮相同的收尾（置 tutorialV1Done + 起 spotlight），关闭≠没看过；或 tutorial 弹窗禁用 ✕ 只留主按钮（弹窗本身只有一步，成本低）。

### [P2] 引导期间干扰元素同屏竞争注意力：签到 pill、红点×2、PWA 安装横幅（后者直接盖住底部 dock）
- 位置: `src/js/pwa-install.js:1` · 工作量 M · 风险 low
- 证据: 截图 f03：spotlight step 0 进行中，顶部同时有「今日还没签到·点我领奖励」pill、新闻图标红点 5、任务红点 4。截图 f09/f10：新号第 2 分钟 PWA 安装横幅弹出并完全遮住底部 dock（任务/商店/谷仓/菜单四个入口不可见不可点）。Hay Day 级 FTUE 会在引导态压制所有非核心 UI 与推广位。
- 修复方向: spotlight._active 或 !spotlightDone 期间：延迟 PWA 横幅（首次会话完成核心循环后再弹）、隐藏签到 pill 与红点；各模块已有 spotlight._active 检查先例（coach.js:79、login-nudge.js:33），照抄即可。

### [P2] splash 游客入口「先随便逛逛」白字压亮色房屋插画，对比度不足近乎不可读
- 位置: `src/index.html:1` · 工作量 S · 风险 low
- 证据: 截图 f01（390×844 全新开局）：主 CTA「手机号登录·领礼包」清晰，但下方游客入口「先随便逛逛 Just look around ›」为白色文字叠在浅色天空+米色房屋图上，中文四字有一半笔画淹没在背景里。这是不想留手机号的新客（华人妈妈群体常见顾虑）进入游戏的唯一路径，也是 FTUE 第一个决策点。
- 修复方向: 给该链接加半透明深色底片或描边（同页世界杯卡片的处理方式），或改为浅色描边按钮；纯 CSS。

### [P2] 种子选择器分组首行留空格：组标题「⚡马上好」占据网格一格，首张卡被挤到右列
- 位置: `src/js/shop.js:159` · 工作量 S · 风险 low
- 证据: 截图 f04：弹窗内「⚡ 马上好（40 分钟内）」标题占左格，上海苗卡孤悬右格，左下方大片空白，视觉像布局 bug。这是引导流程中玩家看到的第一个功能弹窗。
- 修复方向: 组标题改为跨整行的 grid-column:1/-1（或独立 div 脱离网格流），卡片从新行开始。

## 新玩家盲测（UX 研究员扮演萨斯卡通华人妈妈，iPhone 尺寸 390×844，全新 localStorage，CDP 驱动 30+ 步实玩 + 次日回访时间回拨模拟） · 得分 6.5/10

> 核心循环（种→收→交订单→金币/积分）扎实且经济透明度是 Hay Day 级的（订单卡"比直接卖多+72"、教程首棵菜秒熟、浇水"不打理也照常收获"的减压设计都很专业）；次日回访体验是最大亮点——「回家小报」的邻居送币+偷菜事件+「今日」日程枢纽给足了"回来真好"的感觉。但离一流有三类硬伤：(1) 实测 20 分钟内存档两次被静默清零回教程后基线（code 里确有"localStorage 读取抛错→当作无存档→用初始状态覆盖真存档"的窗口），违反"存档神圣"铁律；(2) 首会话信任裂缝密集——教程第三步"卖菜"因唯一收成被订单预留而死锁、"小白菜约30秒"承诺 vs 实际最快 5 分钟、P 积分（核心卖点载体）全程无人解释；(3) Day-2 回访被「去讨回来」引导进邻居农场后，Lv1 玩家按提示点熟菜完全无反应（偷菜 Lv7 解锁但提示文案分支写错）。修完这三类，7.5-8 分可期。

### [P0] 存档静默清零：20 分钟实玩内两次进度全失，回退到「教程刚完成」基线
- 位置: `src/js/state.js:362` · 工作量 M · 风险 low
- 证据: 两次亲历：第一次 coins125/收获1/仓库1 → 自刷新后 localStorage 存档变为 coins100/harvests0/tutorialV1Done:true（诊断 eval：perfNav=['reload']，页面自触发 reload）；第二次 p06 确认存档 coins110/harvests1/wh1 后仅隔约 60-90 秒（点签到 pill 前后），再读 q04 又变回 coins100/ep0/harvests0，perfNav 再次=['reload']。代码窗口：src/js/state.js load() 里 `try{saved=localStorage.getItem(SAVE_KEY)}catch(e){仅 warn}`，随后 `if(saved){...}else{ this.data=STARTER_STATE; ...; this.save(); }`——getItem 一旦瞬时抛错（iOS Safari 内存压力/存储暂时被锁都可能），会把真存档当作不存在并用初始状态覆盖写回。自刷新来源：src/index.html:371-378 SW controllerchange → location.reload()。手动 reload 无法复现（save 正常保留），属偶发竞态，但两次都发生在无人为导航时。
- 修复方向: load() 的 catch 必须与「确无存档」分流：读取抛错→进入内存态运行且本次会话禁止 else 分支的 save() 覆盖（或写前二次 getItem 确认仍为空）；SW controllerchange 自动 reload 前先同步 flush 一次 Farm.state.save()。存档是神圣的：任何「写初始状态」路径都应先证明 key 确实不存在而不是读不到。

### [P1] 新手引导第三步死锁：唯一收成被「小东订单」预留，被指示的「卖给东方超市」永远无法完成
- 位置: `src/js/spotlight.js:168` · 工作量 S · 风险 low
- 证据: 实玩复现：教程秒熟 1 棵上海苗→收进仓库→spotlight 指向谷仓说「点谷仓，把菜卖给东方超市换农场币」→仓库显示「留1 / 本次可卖 C0」，点卖货按钮只弹 toast「都是给小东订单留的，去交订单更划算」但不告诉订单在哪（入口是左下无标签头像，我摸索 5+ 步才找到，且弹窗标题叫「东超订单」与 toast 的「小东订单」措辞不一致）。代码链：spotlight.js:168 第三步只认 totalDeliveries+1；state.js:827 all_reserved 时不增；orders.js:261 交订单只增 totalOrdersFilled——照 toast 的建议做完订单，spotlight 仍卡在谷仓步骤，直到 4 分钟后下一批熟了卖掉才解锁。
- 修复方向: 三选一（都小改）：教程期首棵菜不进订单预留（让第三步立即可完成）；或 spotlight 第三步同时接受 totalDeliveries 或 totalOrdersFilled 增加并把聚光洞改指订单入口；同时 all_reserved toast 文案补路标「点左下角小东头像交订单」。统一「小东订单/东超订单」叫法。

### [P1] 次日回访核心动线断裂：「去讨回来」引导 Lv1 玩家进邻居农场，提示「点熟了的菜顺一棵回家」但点了毫无反应（偷菜 Lv7 才解锁）
- 位置: `src/js/neighbors.js:533` · 工作量 S · 风险 low
- 证据: 时间回拨 -1 天实测：回家小报显示「悠然见南山 顺走了你1棵香菜 [去讨回来]」（我的香菜真被扣了 2 棵）→进入邻居农场，页面明示「🧺 点熟了的菜，顺一棵回家～」→连点两块 mature 高亮格子零反馈（截图 v06-v08 无任何变化，DOM 检查 .neighbor-plot.mature 无 stealable class 无 onclick）。代码根因：neighbors.js:470 canSteal 要求 stealUnlocked(Lv≥7)，但 :533 提示文案条件是 `(isAI||realStealable)`——AI 邻居恒真，导致 Lv1 也显示「点菜顺走」教学而非已写好的「🔒 农场到 Lv7 解锁顺菜」分支（:535 永远走不到 AI 场景）。另外 Lv1 就会被 AI 偷走真库存，但自己 Lv7 才能偷回，新手期观感不公平。
- 修复方向: 提示分支改为先判 stealUnlocked：未解锁时无论 AI/真人一律显示🔒Lv7 文案（该文案已存在，只是条件顺序错）；回家小报的「去讨回来」按钮在 Lv<7 时改成「去看看/去点赞」；建议 Lv7 前 AI 偷菜事件只作剧情不扣真库存（或小报里明示补偿）。

### [P1] 教程承诺「小白菜约 30 秒」但全游戏最快作物是 5 分钟——首会话第一个可验证承诺就落空
- 位置: `data/i18n.json:122` · 工作量 S · 风险 low
- 证据: data/i18n.json:122 tutorial_step2_body=「种子会自己长大（小白菜约 30 秒）」（EN 同样 'bok choy ~30 sec'）；data/crops.json 全表扫描：最快 shanghai_miao/xiao_cong grow_minutes:5，cilantro 8，唯一带「白菜」的 da_bai_cai 90 分钟 Lv4 解锁——不存在任何 30 秒作物。实玩中种下后界面显示「还剩 4m」「下一批 3m 后成熟」，与承诺差 10 倍。
- 修复方向: 文案改为与事实一致（「上海苗约 5 分钟——出门买个菜回来正好收」，本身就贴合买菜人设），或真加一个 30-60 秒的教学专用速生作物强化「今天就能收菜」的爽点。改文案是一行 JSON。

### [P1] 核心卖点「攒超市积分换真优惠」的发现链靠运气：紫 P 从未被介绍，P 面板主按钮「打开商城」还指向虚拟道具商城
- 位置: `src/js/rewards.js:59` · 工作量 M · 风险 low
- 证据: 实玩全程：HUD 紫 P pill 无标签；首次收获 +7P 无任何 callout；任务奖励里的紫球无名。P 的真身（超市积分=会员积分、每日凌晨同步、10⇄1 兑换、每日上限 500）解释得非常好——但藏在「点 P pill」这一步之后，我作为研究员 20+ 步才想到去点，普通玩家首会话大概率不会点。更误导的是该面板唯一大 CTA「🛍 打开商城」打开的是农场商城（加速券/化肥/宠物），与「真优惠」无关（rewards.js V1.1 注释确认游戏内不再展示优惠券档位，真实兑换在店内会员系统）。Guest 模式下也无「未登录不会同步到会员卡」的警示。
- 修复方向: 三个小改：①首次获得 P 时加一次 coach 气泡「这是超市积分，和东方超市会员积分 1:1，攒够能在店里当钱花」；②P 面板把「打开商城」改名「农场商城」并降为次按钮，主位换成「积分怎么在店里用」说明（或登录 CTA）；③guest 状态在 P 面板顶部加一行「登录后才会同步到你的会员卡」。EP 经济本身勿动（店主真负债红线）。

### [P2] 每次回访都撞满屏登录墙：老 guest 玩家的「继续游戏」入口是压在插画上的低对比幽灵链接
- 位置: `src/css/style.css:1233` · 工作量 S · 风险 low
- 证据: Day-2 回访实测：进入即完整开屏（登录立得3000币 + 手机号登录·领礼包大按钮），无「欢迎回来/你的农场 Lv2·294币」；guest 续玩链接「先随便逛逛 Just look around」用 --warm-text-soft 灰字直接压在房子插画的白墙/棕门上（截图 s01 放大 crop 证实可读性差，CSS style.css:1233 .splash-start--ghost 无底色无描边）。首访压登录合理，但对已有存档的回头客是每日摩擦。
- 修复方向: 有本地存档且未登录时：主按钮改「▶ 继续我的农场（Lv2 · 294币）」，登录 CTA 降为次级（保留 3000 币钩子文案）；幽灵链接至少加半透明白 chip 底提升对比。

### [P2] PWA 安装横幅完整盖住底部主导航和小东头像，且同一会话内会再次出现
- 位置: `src/js/pwa-install.js:68` · 工作量 S · 风险 low
- 证据: 截图 s12、u08 两次出现：横幅「把东方农场加到主屏幕 [添加][✕]」完全覆盖 任务/商店/谷仓/菜单 dock 和左下订单头像；u08 那次直接吃掉了我点头像的 tap（点击无效）。第一次点 ✕ 关闭后约 10 分钟内横幅再次出现（pwa-install.js whenEngaged 5s 轮询 + 多展示路径，dismissed 键只在恰好点中 ✕ 时写入）。
- 修复方向: 横幅定位改到 dock 上方（bottom 偏移 = 导航高度 + safe-area）绝不遮主导航；任何一次关闭（含点横幅外空白）当次会话内不再出现；「添加」失败路径也写 dismissed。

### [P2] 种植弹窗分组网格留大空洞 + 订单「还差一点」在 0 进度时失真
- 位置: `src/js/farm.js:1` · 工作量 S · 风险 low
- 证据: 截图 s05/r07/u06：「⚡马上好（40分钟内）」分组标题占左列，首张种子卡在右列，左下留整卡空白洞，视觉像加载失败；截图 u11：订单需求 小葱0/2+香菜0/2（一棵都没有）按钮仍显示「还差一点」。
- 修复方向: 分组标题 grid-column:1/-1 占满整行让卡片自然两列流排（纯 CSS）；「还差一点」按缺口分级：全空→「还没种这些菜」，≥50%→「还差一点」。注：种植弹窗渲染函数在 farm.js/crops.js 内，行号需以实际 grep '马上好' 为准。

### [P2] HUD 390px 下太阳/天气图标被金币 pill 裁剪重叠，且「超市积分」面板出现豆腐块字符
- 位置: `src/index.html:1` · 工作量 S · 风险 low
- 证据: 截图 w02/w07：金币 pill 左缘外露出被裁剪的太阳图标残片（w07 在 C 与 P pill 之间留下一个孤立小圆弧），视觉像渲染错误；截图 t19：超市积分面板大 P 图标旁渲染出一个空心方框（tofu 字形，Windows headless Chrome 环境；iPhone 上需复核该字符/emoji 是否存在）。
- 修复方向: HUD 容器给太阳图标固定 min-width 或并入金币 pill 内；t19 处排查该字符（可能是生僻 emoji 或图标字体缺字），换成通用 emoji 或内联 SVG。两处都是纯前端小改。
