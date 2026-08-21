# 8 秒宣传片素材（2026-08-21）

竖屏 9:16，发微信群用。**分三段，中间那段必须是真的。**

| 秒 | 画面 | 素材 | 谁做 |
|---|---|---|---|
| 0–3 | 黄昏农场，镜头极缓推近 | 见下方 Veo 提示词 | **Chris 跑 Veo** |
| 3–6 | 农夫收菜，积分从 0 跳到 12 | `farm-harvest.*` | ✅ 已录好 |
| 6–8 | 会员卡 + 积分落袋 | `farm-endcard.*` | ✅ 已做好 |

## 文件

| 文件 | 用途 |
|---|---|
| `farm-harvest.webp` / `.gif` | 3 秒真实录屏（1.6 MB GIF，微信发得动） |
| `farm-endcard.webp` / `.gif` | 2 秒收尾卡 |
| `*-cover.jpg` | 首帧，发群里当预览图 |
| `frames-harvest/` `frames-endcard/` | 原始 PNG（1080×1920），剪辑用 |

⚠️ **没有 MP4** —— 这台机器没装 ffmpeg，我没擅自装。最后合成用任何剪辑工具
把三段接起来即可，帧序列是现成的。

## 3–6 秒那段是怎么录的（不是演的）

无头 Chrome 打开**生产站** `farm.easternmarket.ca`，真的点在菜地上收获，
拍到的是游戏自己的动画和数字：**积分 0 → 12** 是真收出来的，不是我写上去的。

唯一的「导演动作」是把地块的「种下时间」往前推 —— 等同于真的等过了生长期，
不改任何数值。

复现：
```bash
node capture.mjs setup_shoot.js <输出目录> 100 20 360 640 3     # 录 100 帧
python assemble.py <帧目录> promo/clip --start 0 --end 59       # 取前 3 秒
```
（两个脚本在会话 scratchpad 里，要长期保留的话我再收进仓库。）

## 0–3 秒的 Veo 提示词

```
Isometric miniature farm diorama at golden hour, soft warm sunset light
from the upper left, long shadows from spruce trees stretching to the
lower right. Rolling hills and a spruce treeline in hazy background.
A small wooden farmhouse with thin smoke curling from the chimney, a
water wheel turning slowly beside a pond, tidy raised vegetable beds
with cabbages, tomatoes, carrots and bok choy, a small produce stall
with a red-and-white striped awning.

Camera: extremely slow push-in, almost still. No cuts.
Motion: only the smoke drifting, the water wheel turning, grass and
leaves swaying gently in a light breeze. Everything else stays still.
Style: clean 3D render, warm and cozy, soft shadows, no text, no people
walking, no camera shake. 9:16 vertical.
```

🔒 `Camera: extremely slow push-in` 和「只有烟/水车/草在动」这两句不能删 ——
不写死，Veo 会自己加运镜和人物，出来就不是 `keyart-farm-portrait.jpg` 那张图了。

也可以直接把 `promo/keyart-farm-portrait.jpg` 当参考图喂给它，更稳。

## 屏幕上的字

双语各自成立，不是中文底下垫一行翻译：

```
0–3 秒   东方农场 / Eastern Farm
3–6 秒   种菜，收获 / Plant it. Harvest it.
6–8 秒   （已印在收尾卡上）
```

⚠️ **别在视频里写「截止 8/31」** —— 发出去没几天就要撤，9 月 1 日之后所有
带这行字的物料都得下架。
