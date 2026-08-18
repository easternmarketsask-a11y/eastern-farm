# 微信群分享文案 · 备份

> 这里保存正式版本，以后想发链接拷贝这里即可。
> 改文案后记得同时改 `src/index.html` 的 og:title / og:description
> 让自动预览和文案保持一致。

---

## 🎯 当前在用版本（2026-08-18 · 社区）

```
东方农场 | 去串门看邻居
登录后能看见今天谁在种菜。走进去浇水，熟了的菜可以顺一棵。
邀请好友，双方各得 200 农场币。免费玩，积分进会员卡。
https://farm.easternmarket.ca
```

手机海报：`promo/poster-phone-onart-05-community.png`（朋友圈发图）。
店内主海报仍用 04c（玩农场游戏 / 赚超市积分）。

---

## 自动预览（微信抓的内容）

- **标题**：东方农场 | 去串门看邻居
- **副标题**：登录后能看见今天谁在种菜。走进去浇水，熟了的菜可以顺一棵。免费玩，积分进会员卡。
- **缩略图**：`src/assets/images/share-card.png` (500×500)
- **域名**：farm.easternmarket.ca

---

## 缓存说明

微信会缓存链接预览。如果改了 og:* 标签或 share-card.png 但预览没刷新：
- 链接后加随机参数 `?v=community` 
- 等几小时让微信重新抓
- 不同设备首次看到的预览不一定一致

---

## 改版步骤（以后想换文案）

1. 改 `src/index.html` 里 og:title / og:description / meta description
2. 如果改图：改 `scripts/make_share_card.py` 然后跑 `python scripts/make_share_card.py`
3. commit + push
4. 等 5-10 分钟 GitHub Pages 部署
5. 拷贝新文案，发新链接（加 `?v=N` 让微信重抓）
