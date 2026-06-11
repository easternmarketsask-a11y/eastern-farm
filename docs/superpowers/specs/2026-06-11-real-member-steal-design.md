# 真会员互偷设计（2026-06-11，Chris 已批准）

> 背景：原偷菜系统（social-steal.js + 回家小报 + 看家狗，T1-T7 已测）建立在
> AI 邻居上；AI 已按 Chris 要求关闭（ai-neighbors.js `enabled=false`）。
> 本设计把偷菜迁移到**真会员之间**，异步模型（QQ农场式）。

## Chris 拍板的三个产品决策

1. **偷菜范围**：所有会员互偷（不限好友）。
2. **损失模式**：有损但温和——被偷地块清空，但每天最多被偷 3 棵 +
   Lv3 以下新手不可被偷 + 离线不足 2 小时零损失（沿用现有 config）。
3. **被偷推送**：默认开、设置可关（需 Cloud Function，分期实现）。

## 架构（全部复用现有通道，不改安全规则）

- `farm_players/{uid}.gameStats` 是公共社交集合，**玩家互写已被规则允许**
  （点赞/送礼/贴纸全在用 arrayUnion 模式）。偷菜事件走同一通道。
- 地块快照随现有 gameStats 同步推送：`farmPlots: [{i,c,p}]`
  （plotIdx / cropId / plantedAt），访客端用 plantedAt+grow_minutes 自算成熟。
- 快照同时带 `hasGuardDog`（看家狗在岗标志）。

## 数据流

```
小偷端：逛真会员农场(真快照渲染) → 点熟菜 → 本地校验限额
  → 菜入自己仓库 → arrayUnion 写 victim 的 gameStats.stealEvents
受害者端：上线 → 读自己 stealEvents → 逐条验证(同 crop+plantedAt 且未收+未超被偷上限)
  → 清地块 → 回家小报点名 + 「去讨回来」 → 清空 events 字段
```

## 规则参数（沿用 socialConfig + 新增）

| 参数 | 值 |
|---|---|
| 每日主动偷上限 | 6 棵（现有 STEAL_DAILY_TOTAL）|
| 单户每日上限 | 2 棵（现有；对方有狗 → 1 棵）|
| 每日被偷上限 | 3 棵（新增 LOST_DAILY_MAX，超出的事件作废）|
| 新手保护 | victim level < 3 不可偷（偷端禁入 + 结算端兜底）|
| 看家狗 | 单户限额 2→1 + 20% 被抓：偷不到 + 赔 20 币（victim 小报好消息 +20 币）|
| 冲突宽容 | victim 已自己收割 → 事件作废，小偷已得菜不追回（cozy 取向）|

## 分期

- **P1 真农场可见**：快照入 payload + viewFarm 真渲染（老客户端无快照 → 回落生成图）
- **P2 互偷**：偷端动作 + 事件写入 + 受害者结算 + 小报真名/报复
- **P3 推送**：Cloud Function 监听 farm_players stealEvents 写入 → FCM 推送
  「你的{菜}被{名字}顺走了」（需在 EasternMarket_app/functions 部署，单独做）

## 不变量

1. 事件验证以 (plotIdx, cropId, plantedAt) 三元组匹配，杜绝旧事件重放清新菜。
2. stealEvents 消费后必须清空字段（同 pendingGifts consume 模式）。
3. AI 相关代码路径保持 `if (Farm.aiNeighbors)` 守卫，AI 开关与真人互偷互不影响。
4. 小报事件携带 name/emoji 字段直接展示，不再依赖 AI 名册查名。
