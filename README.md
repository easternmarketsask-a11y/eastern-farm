# Eastern Farm · 东方农场

> A cozy farm game for Eastern Market customers — mom and kid play together,
> grow Asian vegetables, celebrate Chinese festivals, earn real coupons.

## 5 秒看懂这个项目

- 单文件夹应用,零依赖,**双击 `src/index.html` 即可游玩**
- 已经能玩:种植、收获、卖菜、升级、商店、任务、节日、双语、兑换码
- 中等复杂度,1-2 个月可以打磨到上线水准
- 设计文档完整,Claude Code 拿来直接续写

## 怎么开始

```bash
# 重要:从项目根目录跑服务器 (不是从 src/!)
cd eastern-farm
python3 -m http.server 8000

# 浏览器打开:
#   http://localhost:8000/src/
```

> ⚠️ **必须从项目根目录跑**,因为 `src/index.html` 里的 JS 用
> `fetch('../data/crops.json')` 加载数据文件。如果从 `src/` 跑服务器,
> `../data/` 会被服务器当成穿越目录拒绝掉。
>
> ⚠️ **不要双击 index.html**:`file://` 协议下 fetch 会被 CORS 拦截,
> 数据加载不出来。一定要用 http 服务器。
>
> 移动端测试:用 `ngrok http 8000` 或局域网 IP `http://192.168.x.x:8000/src/`

## 文件结构

```
eastern-farm/
├── CLAUDE.md                 ← Claude Code 的入口文档,先读这个
├── README.md                 ← 你正在看的这个
├── src/
│   ├── index.html            ← 应用主入口
│   ├── css/style.css         ← 完整样式
│   └── js/                   ← 10 个模块,全部已实现
├── data/
│   ├── crops.json            ← 作物配置 (8 个主作物 + 5 个节日作物)
│   ├── tasks.json            ← 任务模板
│   ├── events.json           ← 节日活动 (春节, 中秋等)
│   ├── coupons.json          ← 预生成的优惠码池
│   └── i18n.json             ← 双语 UI 字符串
├── scripts/
│   └── gen_coupons.py        ← 生成新优惠码 (Python)
└── docs/
    ├── TASKS.md              ← 优先级任务清单 (Claude Code 看这个)
    ├── GAME-DESIGN.md        ← 完整游戏设计文档
    ├── CROPS.md              ← 作物文化背景
    ├── EVENTS.md             ← 节日活动设计
    ├── I18N.md               ← 双语支持指南
    └── BUSINESS-INTEGRATION.md ← V1→V2→V3 业务集成路线
```

## 现在能做什么 (V1 已实现)

打开游戏立即可见:
- ✅ 4 块解锁的地块 + 8 块锁定的地块 (升级解锁)
- ✅ 种子库存 (起步 3 颗上海青种子)
- ✅ 点击地块种植 → 等待生长 → 点击收获 → 自动卖出 + 获得金币和经验
- ✅ 升级解锁更多作物和地块
- ✅ 种子店 (5 种作物等级 1-5 解锁)
- ✅ 每日任务 (3 个,午夜刷新)
- ✅ 每日登录奖励 (连续登录倍数)
- ✅ 节日活动检测 (春节/中秋自动激活)
- ✅ 双语切换 (中文 ↔ English)
- ✅ 蔬菜图鉴 (含食谱和文化故事)
- ✅ 东方点 → 优惠码兑换
- ✅ 店主 NPC (随机问候 + 节日变化)
- ✅ 完整存档系统 (localStorage)

## 下一步:用 Claude Code 继续开发

```bash
# 把整个文件夹解压到你想要的位置
cd eastern-farm
claude  # 进入 Claude Code
```

让 Claude Code:
1. **先读** `CLAUDE.md` 理解项目
2. **再读** `docs/TASKS.md` 看优先级
3. 然后从 **P2 任务**开始 (作物图鉴细节、成就系统、声音设计等)

V1 的核心循环已经跑通,后续主要是:
- 美术升级 (作物 SVG 取代 emoji)
- 内容扩展 (更多节日、更多作物、更多任务)
- 体验打磨 (动画、音效、第一次玩的引导)

## 给 Chris 的几点提醒

1. **测试 iPhone 17 体验**:游戏是 mobile-first 设计,在桌面浏览器看完后,
   一定要在手机上跑一遍 (用 ngrok 或本地 IP 都行)。

2. **优惠码池要补充**:`data/coupons.json` 只有 10 个示例码。运行
   `python3 scripts/gen_coupons.py --update -n 100` 可以生成 100 个新码。

3. **节日日期要更新**:`data/events.json` 和 `src/js/events.js` 硬编码了
   2026-2028 年的节日窗口。2028 之后要手动加。

4. **店主台词可以加你的话**:`data/i18n.json` 的 `_storekeeper_pool_default_zh`
   是店主的台词池,直接加新台词进去就行,游戏会随机抽取。

5. **真正上线前必须**:
   - 加一个简单的 Eastern Market logo 替换 emoji 👨‍🌾
   - 决定优惠码的实际生效流程 (打印列表给收银员? 在线表格?)
   - 写一份"客户怎么玩"的简短海报放在店里
