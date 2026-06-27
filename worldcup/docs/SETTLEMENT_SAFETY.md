# 竞猜结算安全规范(农场币发放闸门)

> 这一份是硬性安全要求。竞猜涉及农场币变动,**账必须平**,误报绝不能自动把币发出去。
> 设计哲学同 supplier-receipt-voucher:自动给建议,人工做真相,每一步留流水。

## 黄金法则

**农场币只在「人工确认终场比分 + 人工点结算」之后发放。API 状态变化永远不直接触发发币。**

## 三道闸门

```
[1] API-Football 自动           [2] 人工确认(你)            [3] 人工结算(你)
    apiScore=[2,1]        →      officialScore=[2,1]      →    点「结算本场」
    apiStatus=FT                 officialFinal=true            ↓
    (仅建议,不可结算)           (写入真相源)                  发农场币 + 标注 won/lost
```

- 闸门 [2]:管理面板可提供「采用 API 比分」一键填入,但**仍需人点确认**(等于人工背书)。
- 闸门 [3]:只对 `officialFinal=true` 的比赛开放。未确认的比赛「结算」按钮禁用。

## 数据模型(`wc_bets`)

> 若 Farm 农场币系统已有交易表,优先复用;这里只描述竞猜需要的注单字段。

```jsonc
{
  "betId": "uuid",
  "playerId": "...",          // 取自 audit 确认的玩家标识
  "matchId": "M073",
  "pick": "home|draw|away",
  "stake": 100,               // 农场币
  "odds": 2.0,                // 下注当时锁定的赔率(固定赔率起步)
  "status": "pending|won|lost|void",
  "payout": 0,                // 结算后写入(won 时 = stake*odds)
  "createdAt": "ISO",
  "settledAt": null,
  "settleTxnId": null         // 关联农场币流水 id,用于审计/回滚
}
```

## 下注(扣币)— 原子事务

```
1. 校验 now < kickoffUtc 且该 match apiStatus=NS(未开赛)
2. 校验玩家农场币余额 >= stake
3. 在【同一事务】里:
     - 调用 Farm 农场币扣减函数(audit 确认的真实函数)扣 stake
     - 插入 bet 记录 status=pending
   任一步失败 → 整体回滚,不扣币不留注
4. 防并发双花:扣币走数据库原子操作 / 行锁 / CAS,不能「先读余额再写」
```

## 结算(发币)— 幂等 + 审计

```
settleMatch(matchId):
  断言 match.officialFinal === true        // 否则拒绝
  result = 由 officialScore 判定 home/draw/away
  对该 match 所有 status=pending 的 bet:
     won  = (bet.pick === result)
     在【同一事务】里:
        if won:
           payout = round(stake * odds)
           调用 Farm 农场币增加函数发 payout      // 复用游戏经济接口
           bet.status='won'; bet.payout=payout; bet.settleTxnId=<txn>
        else:
           bet.status='lost'; bet.payout=0
        bet.settledAt=now
  幂等守卫:status!=pending 的注跳过,绝不重复发币
  写审计日志:matchId, 操作人, 时间, 发币总额, 影响注数
```

**幂等实现**:`UPDATE bets SET status='won',... WHERE betId=? AND status='pending'` 影响行数=0 则说明已结算,跳过发币。农场币增加与该 UPDATE 在同一事务。

## 撤销结算(录错可逆)

```
unsettleMatch(matchId):
  对该 match 所有已结算的 bet:
     if status=='won': 调用农场币【扣减】回收 payout(可能使余额为负 → 记债务或拒绝并告警)
     bet.status='pending'; bet.payout=0; bet.settledAt=null
  清掉 match.officialFinal(回到待确认)
  写审计日志(撤销原因)
  边界:玩家已把赢来的币花掉 → 余额不足回收。策略二选一:
     (a) 允许负余额并标记,后续收入抵扣;
     (b) 拒绝撤销并提示「已有玩家消费,需人工处理」。
  起步选 (b) 最安全。
```

## 特殊情况

| 情况 | 处理 |
|---|---|
| 比赛取消/改期 | 全部 pending 注 `void`,**全额退农场币** |
| 缺平局选项 | 确保 home/draw/away 三选项都能押 |
| 加时/点球(淘汰赛) | `officialScore` 记常规+加时的实际比分;胜平负竞猜按「晋级方」或「90 分钟比分」二选一,**在规则里写死并在 UI 标明** |
| 玩家余额并发不足 | 扣币原子化,只成功一个 |

## 账平校验(定期跑)

```
对账:Σ(下注扣的农场币) - Σ(结算发的农场币) - Σ(void 退的) == 竞猜系统净沉淀
任何不平 → 告警。每次结算后或每日跑一次。
```

跟你 ledger.csv「源头即真相、人工纠错、账要平」完全一致。
