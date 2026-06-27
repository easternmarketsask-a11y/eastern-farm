# 世界杯竞猜抽奖 · 方案 (LOTTERY_SPEC)

> Eastern Farm 观赛台的「淘汰赛竞猜抽奖 · 百分百中奖」。复用农场现有会员登录 +
> Firestore + 推送。7 月底随观赛台整体可移除。**有奖品 = 有人想刷,上线前安全必须到位。**

## 玩法(已与 Chris 确认)
- 范围:**淘汰赛全部 32 场**(R32 16 + R16 8 + QF 4 + SF 2 + 三四名 1 + 决赛 1)。
- 每场**开球前**:会员登录(门店手机号)→ 猜晋级队 → 提交。**一人一场一次**,过开球时间自动关闭报名。
- 赛后**云函数自动开奖,人人有奖**:
  - 🪙 **农场币 — 保底,人人有份**(参与即得;这就是"百发百中")。**一律 1000 币/场**。
    > Chris 选 A:目的是世界杯期间狠拉人进农场,接受农场币贬值(种子才 4–80 币、一茬菜赚
    > 10–50 币,1000 很慷慨)。营销期策略,非长期平衡。
  - 🎁 **实物 — 猜对晋级队的人额外赢**(限量):每场从"猜对的人"里随机抽 N 名得实物;
    实物库存发完后,该场只发农场币。中实物者得**券码**,到店核销领取。

## 奖品库存(Chris 提供,一次性)
| 奖品 | 数量 | 备注 |
|---|---|---|
| 沙琪玛(鸡蛋/芝麻) | 20–25 包 | |
| 龙角散(薄荷,10粒装) | 30–40 支 | 后续可再加款 |
| 农场币 | 不限 | 游戏内币,近乎零真实成本 |

- **每场实物名额(quota)**:默认 **2 名/场**(共享库存,抽完为止)。约 50–65 份 ÷ 32 场,够发整轮;尾段可能只剩农场币。
- 库存数字写在配置里,Chris 实际备货后填准确值。

## 成本
- 实物 = 你的真实库存(一次性,已有)。
- 农场币 = 免费(游戏内),还把人引去玩农场。
- **真实花费 ≈ 你已备的那些零食。**

## 数据模型(eastern-market-members Firestore)
```
wc_lottery_config            { coinsFlat:1000, perMatchQuota:2,
                               stock:{shaqima:22, ryukakusan:35} }
wc_lottery/{matchId}
  ├─ (doc) { kickoffUtc, deadline, status:'open|drawn',
  │          actualWinnerTeam, drawnAt }
  └─ entries/{uid}           { uid, name, phone, pickedTeam, createdAt }
wc_lottery_winners/{matchId}/{uid}
                             { uid, name, phone, prize:'shaqima|ryukakusan|coins',
                               couponCode, coins, redeemed:false, drawnAt }
```
- 农场币发放:云函数(admin)直接给 `farm_players/{uid}.coins` 加值(服务端=安全,防刷)。

## 自动开奖(Cloud Function)
- 触发:定时(淘汰赛期间每 ~30 分钟)或赛后。
- 步骤(**幂等**,已开奖不重复):
  1. 该场 `status!='drawn'` 且服务端从 ESPN 确认已终场 → 取真实晋级队。
  2. 全部 entries:**猜对的**进实物候选池。
  3. 从候选池随机抽 `min(quota, 剩余库存)` 名 → prize=实物 + 生成 couponCode + 扣库存。
  4. 其余所有 entries(含猜错)→ prize=coins,一律给 farm_players 加 1000 币。
  5. 写 winners + 标记 `status='drawn'`;可选推送通知中奖者。

## 奖品核销(到店)
- 实物中奖者在观赛台看到「🎉 恭喜中奖 + 券码 + 奖品名」。
- 到店出示券码 → 收银核对 → 给奖品 → 标 `redeemed=true`(收银用一个简单核销页/输码)。
- 农场币自动到账,无需核销。

## 安全(上线前必须)
- **Firestore 规则**:
  - entries:仅能 create 自己的(`request.auth.uid == uid`,docId==uid),仅当 `now < deadline`,不可改/删;不可读他人 entry。
  - winners / config / 库存:只读;写仅限云函数(admin)。
  - farm_players.coins:沿用"只能写自己 uid"规则,云函数 admin 加币。
- **App Check**:开启,防脚本批量刷报名(手机号登录用短信验证码,本就该开,顺带防话费盗刷)。

## 分工
- **Claude Code(本仓库)**:抽奖前端(登录门 + 竞猜 + 提交 + 中奖展示)、把 Firebase 接进观赛台、写好 Firestore 规则 + Cloud Function 代码 + 收银核销页。
- **Chris(亲手)**:部署 Firestore 规则、部署 Cloud Function、开 App Check、填准库存数字、跟收银交代核销。**所有 push/部署 Chris 自己做。**

## 默认值(可调)
- 农场币:一律 1000/场(Chris 选 A,营销期慷慨,接受贬值)。
- 每场实物名额:2。
- 库存:沙琪玛 22 / 龙角散 35(备货后填准)。

## 分阶段
1. 前端竞猜报名 + 登录门 + 中奖展示(本仓库,可先上,不发奖也能跑)。
2. Firestore 规则 + Cloud Function 自动开奖(Chris 部署)。
3. 收银核销页 + App Check + 推送通知。
