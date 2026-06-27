# 抽奖 Phase 2 部署指引(Chris 亲手做)

> 这两份是**交付文件**,不在本仓库生效。要拷进 **EasternMarket_app** 仓库
> (`eastern-market-members` 项目),由你部署。所有 push / deploy 你自己做。
>
> - `firestore-rules.snippet` → 合并进 `EasternMarket_app/firestore.rules`
> - `functions/wcLottery.ts`   → 拷进 `EasternMarket_app/functions/src/wcLottery.ts`

---

## 1. Firestore 规则

1. 打开 `EasternMarket_app/firestore.rules`。
2. 把 `firestore-rules.snippet` 整段粘进
   `match /databases/{database}/documents { ... }` **大括号内部**
   (`wcEntryBeforeDeadline()` 函数和那些 `match` 块都放里面)。
3. 部署:
   ```bash
   firebase deploy --only firestore:rules --project eastern-market-members
   ```

**规则做了什么**:报名只能建自己的、一人一场一次、开球前、字段干净、提交后不可改删;
中奖名单/配置只能读自己的;实物库存与农场币只有云函数(admin)能写。

---

## 2. Cloud Functions

1. 拷 `functions/wcLottery.ts` 到 `EasternMarket_app/functions/src/wcLottery.ts`。
2. 在 `functions/src/index.ts` 里导出(和现有 `onOrderStatusChange` 并列):
   ```ts
   export { wcLotteryTick, wcLotteryDrawNow, wcLotterySetWinner } from './wcLottery';
   ```
3. 依赖:用了 firebase-functions **v2**、Node 18+ 的全局 `fetch`(都已具备,无需装包)。
   如果 `tsconfig` 报 `fetch` 未定义,把 `"lib": ["es2022","dom"]` 或 Node18 类型补上即可。
4. 部署:
   ```bash
   firebase deploy --only functions:wcLotteryTick,functions:wcLotteryDrawNow,functions:wcLotterySetWinner --project eastern-market-members
   ```
   `wcLotteryTick` 会自动注册一个**每 30 分钟**的定时任务(Cloud Scheduler)。

**函数做了什么**:
- **自动 seed**:把已确定双方的淘汰赛场写成 `wc_lottery/{matchId}`(deadline=开球时间)。
- **自动开奖**(每 30 分钟):开球 2.5h 后用 ESPN 确认终场 + 晋级队 →
  - 实物:全部报名者**纯随机**抽 `quota + carry` 名(库存抽完为止);没抽满的名额滚存到下一场;
  - 农场币:人人 1000,**猜对晋级队 2000**,直接加到 `farm_players/{uid}.coins`;
  - 幂等:重复跑不会重复发奖、不会重复扣库存。
- **决赛清仓**:32 场全开完仍有库存 → 在所有参与者里抽光(优先没中过实物的人)。

---

## 3. 配置(可选,控制台改)

首次运行会自动创建 `wc_lottery_config/config`,默认值:
```json
{ "coinsBase":1000, "coinsCorrectTotal":2000, "perMatchQuota":2, "carryQuota":0,
  "sweepDone":false,
  "stock":{"shaqima":22,"ryukakusan":35,"yogurt_orig":10,"yogurt_muscat":10} }
```
**实际备货后**到 Firestore 控制台把 `stock` 改成真实数量即可(开奖按这个扣)。

---

## 4. App Check(强烈建议)

防脚本批量刷报名。在 Firebase 控制台 → App Check 给 Web 应用启用
(reCAPTCHA v3 / Enterprise),并对 Firestore 开启 enforcement。
手机号登录的短信验证码本就该开,顺带防话费盗刷。

---

## 5. 管理员校验

`wcLotteryDrawNow` / `wcLotterySetWinner` 用 `assertAdmin()` 校验自定义 claim
(`token.admin === true`)。如果你的 admin 不是用 custom claim,把
`wcLottery.ts` 底部 `assertAdmin` 改成校验你的固定管理员 uid 即可。

`wcLotterySetWinner`(人工指定晋级队强制开奖):ESPN 万一识别不出(如点球未被标记)
时的兜底。调用参数:`{ matchId:'M089', winnerTeam:'MEX' }`。

---

## 6. 上线顺序建议

1. 先部署**规则**(此时前端报名会被正确管控)。
2. 真机用门店手机号登录,在某淘汰赛场报名一次,确认 `wc_lottery/{id}/entries/{你的uid}` 写入成功。
3. 再部署**函数**;用 `wcLotteryDrawNow` 手动催一次,看日志与 `farm_players` 加币、
   `wc_lottery_winners` 是否正确。
4. 开 App Check。
5. Phase 3:收银核销页(输券码 → 标 `redeemed=true`)+ 推送通知(下一步我写)。

---

## 删除(七月底)

删 `wc_lottery*` 三个集合、firestore.rules 里那段、`wcLottery.ts` 与 index.ts 的导出,
重新 deploy 即可。前端观赛台整体移除时一并清理。
