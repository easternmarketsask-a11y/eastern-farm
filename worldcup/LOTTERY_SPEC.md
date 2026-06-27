# 世界杯竞猜抽奖 · 方案 (LOTTERY_SPEC)

> Eastern Farm 观赛台的「淘汰赛竞猜抽奖 · 百分百中奖」。复用农场现有会员登录 +
> Firestore + 推送。7 月底随观赛台整体可移除。**有奖品 = 有人想刷,上线前安全必须到位。**

## 玩法(已与 Chris 确认 · 2026-06 改为方案 A)
- 范围:**淘汰赛全部 32 场**(R32 16 + R16 8 + QF 4 + SF 2 + 三四名 1 + 决赛 1)。
- 每场**开球前**:会员登录(门店手机号)→ 猜晋级队 → 提交。**一人一场一次**,过开球时间自动关闭报名。
- 赛后**云函数自动开奖,人人有奖**:
  - 🎁 **实物 — 进入即有机会(纯随机)**(限量):每场从**全部 entries**(不论猜对猜错)里随机抽
    N 名得实物。中实物者得**券码**,到店核销领取。这样实物发放量跟参与人数挂钩,发得更多更顺。
  - 🪙 **农场币 — 人人保底 + 猜对加码**:
    - 人人(参与即得)**1000 币**;
    - **猜对晋级队的人翻倍 = 2000 币**(猜对的奖励从"实物"挪到"农场币",币零成本)。
    > Chris 选 A:营销期狠拉人进农场,接受农场币贬值(种子才 4–80 币、一茬菜赚 10–50 币)。

### "发得完"两道保险(云函数)
- **名额滚存**:某场参与少、没抽满 N 个,剩余名额累加到下一场(`carryQuota`)。
- **决赛后清仓抽**:整届结束若仍有剩余实物,在**所有参与过的人**里来一次"清仓大抽奖"全部发掉。
- 结果:参与高 → 发得快、场场有人中;参与低 → 滚存 + 决赛清仓兜底,照样发完,不浪费。

## 奖品库存(Chris 提供,一次性)
| 奖品 | key | 数量 | 备注 |
|---|---|---|---|
| 沙琪玛(鸡蛋/芝麻) | `shaqima` | 20–25 包 | |
| 龙角散(薄荷,10粒装) | `ryukakusan` | 30–40 支 | |
| 요구르트气泡饮 · 原味(355mL) | `yogurt_orig` | 10 瓶 | 韩国乳酸菌气泡饮 |
| 요구르트气泡饮 · 香印青提(355mL) | `yogurt_muscat` | 10 瓶 | 韩国乳酸菌气泡饮 |
| 农场币 | `coins` | 不限 | 游戏内币,近乎零真实成本 |

- **每场实物名额(quota)**:默认 **2 名/场**(共享库存,抽完为止)。约 85–90 份(沙琪玛 22 + 龙角散 35 + 气泡饮 20)÷ 32 场,够发整轮且偏富余;低参与时尾段才靠农场币兜底。
- 库存数字写在配置里,Chris 实际备货后填准确值。

## 成本
- 实物 = 你的真实库存(一次性,已有)。
- 农场币 = 免费(游戏内),还把人引去玩农场。
- **真实花费 ≈ 你已备的那些零食。**

## 数据模型(eastern-market-members Firestore)
```
wc_lottery_config            { coinsBase:1000, coinsCorrectTotal:2000,
                               perMatchQuota:2, carryQuota:0,   // 滚存名额(云函数维护)
                               stock:{shaqima:22, ryukakusan:35,
                                      yogurt_orig:10, yogurt_muscat:10} }
wc_lottery/{matchId}
  ├─ (doc) { kickoffUtc, deadline, status:'open|drawn',
  │          actualWinnerTeam, drawnAt }
  └─ entries/{uid}           { uid, name, phone, pickedTeam, createdAt }
wc_lottery_winners/{matchId}/w/{uid}
                             { uid, name, phone,
                               prize:'shaqima|ryukakusan|yogurt_orig|yogurt_muscat|coins',
                               couponCode, coins, correct:bool, redeemed:false, drawnAt }
wc_coupons/{couponCode}      { code, matchId, uid, name, phone, prize,
                               redeemed, redeemedAt, drawnAt }   // 扁平索引,核销台按码秒查
wc_lottery_admin/secret      { cashierPass }    // 收银口令(规则全锁,仅云函数可读)
```
- 农场币发放:云函数(admin)直接给 `farm_players/{uid}.coins` 加值(服务端=安全,防刷)。

## 自动开奖(Cloud Function)
- 触发:定时(淘汰赛期间每 ~30 分钟)或赛后。
- 单场步骤(**幂等**,已开奖不重复):
  1. 该场 `status!='drawn'` 且服务端从 ESPN 确认已终场 → 取真实晋级队 `actualWinnerTeam`。
  2. 本场可抽名额 `slots = perMatchQuota + carryQuota`(滚存)。
  3. 从**全部 entries**(纯随机,不分对错)抽 `drawn = min(slots, 剩余库存合计)` 名
     → prize=实物(按库存随机分配款式)+ 生成 couponCode + 扣对应库存。
  4. `carryQuota += (slots - drawn)`(没抽满的名额滚到下一场)。
  5. 所有 entries 发农场币:猜对 `coinsCorrectTotal`(2000),其余 `coinsBase`(1000),
     写 `correct` 标记 + 给 `farm_players` 加币。
  6. 写 winners + 标记 `status='drawn'`;可选推送通知中奖者。
- **决赛后清仓**:全部 32 场 `drawn` 后,若库存仍 >0 → 在所有参与过的 uid 里去重随机抽满剩余库存,
  补发实物券码(`matchId='final-sweep'`)。

## 奖品核销(到店)— Phase 3 已做
- 实物中奖者在观赛台转盘揭晓后看到「🎉 恭喜中奖 + 券码 + 奖品名」。
- 收银核销页 `farm.easternmarket.ca/redeem`(farm 仓库 `redeem/index.html`):
  收银员输口令 → 输券码 → 显示奖品/中奖人/状态 → 「确认核销」→ 标 `redeemed=true`。
  已核销的码红字拦截,防重复领;另有记录页看全部实物券进度。
- 页面只调云函数 `wcLotteryRedeem`(口令服务端校验),不直接读写库。
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
- 农场币:人人保底 1000;猜对晋级队翻倍 2000(Chris 选 A,营销期慷慨,接受贬值)。
- 每场实物名额:2(纯随机抽全部参与者)+ 名额滚存 + 决赛清仓。
- 库存:沙琪玛 22 / 龙角散 35 / 气泡饮原味 10 / 气泡饮青提 10(备货后填准)。

## 分阶段
1. ✅ 前端竞猜报名 + 登录门 + 中奖展示 + 幸运转盘揭晓(本仓库,可先上,不发奖也能跑)。
2. ✅ Firestore 规则 + Cloud Function 自动开奖(交付在 worldcup/phase2/,Chris 部署)。
3. ✅ 收银核销页(redeem/,随 deploy.sh 上线)。⬜ App Check ⬜ 推送通知(待做)。
