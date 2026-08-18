/**
 * mapview-iso.js — isometric (2.5D, Hay Day-style) farm view (Farm.isoView)
 *
 * PREVIEW behind ?iso=1. Renders the EXISTING state (plots/buildings) on an
 * isometric diamond grid and runs the EXISTING plant/harvest/care flow on tap.
 * Does NOT touch the live top-down default (mapView). Once approved, the build/
 * terrain/decoration editor gets ported and this becomes the default.
 *
 * Ground = flat grass diamonds (guaranteed tessellation). Crops/buildings are
 * upright sprites placed on cells, depth-sorted back-to-front (gx+gy).
 */
(function () {
  const COLS = 28, ROWS = 26;      // 东扩 8 格 + 往镜头前（马路对面）加 10 格。路心仍不能建。
  // Start zone origin. (The 2026-06-18 "forward move" to (6,6) was cancelled — Chris
  // preferred adapting via the new full-scene background instead. _undoForwardOnce()
  // shifts any save that got forwarded back to here.)
  const PLOT_COLS = 3;
  const PLOT_ORIGIN_BACK = { ox: 1, oy: 2 };   // 旧开局：靠山（y 小）
  const PLOT_ORIGIN_FRONT = { ox: 3, oy: 10 }; // 田居中偏右，左侧让给溪+水车+鸡舍
  const TW = 46, TH = 23;          // diamond width/height at zoom 1 (2:1 iso) — halved 2026-06-18 (Chris: shrink whole farm 50% so it's a small cluster in the meadow centre; bg is canvas-based so the farm gets relatively smaller)
  // ZMIN === BG_ZOOM_REF (0.70): at the most-zoomed-out point the painted backdrop's
  // FULL HEIGHT exactly fills the viewport (Chris 2026-06-18: "高度一旦达到背景图全高则不可
  // 再缩小"). You can't zoom out past that, so no base band ever shows top/bottom. Because
  // the image is WIDER than the screen, at min zoom you can pan left/right within it
  // (_clampCam keeps the bg covering). ZMAX zooms in.
  const ZMIN = 0.70, ZMAX = 2.4;
  const REQUIRED_LV = { 4: 2, 5: 2, 6: 3, 7: 3, 8: 4, 9: 4, 10: 5, 11: 5 };
  // Pay-to-expand land. Each level's TOTAL owned rectangle (cells x1,y1..x2,y2).
  // 两套表：旧存档 landOrigin≠front 继续用 BACK（从山脚往镜头扩）。
  // 新农场 landOrigin=front：开局在镜头前，扩地往山上（y 变小）再往东。
  // 🔒 每一档只许放大、不许缩小（老存档已建物不能掉出地界）。
  // 2026-08-18：东扩之后再往镜头前扩过乡路（y 变大 = 马路对面那片草甸）。
  const LAND_LEVELS_BACK = [
    { x1: 0, y1: 0, x2: 14, y2: 20, coins: 0, points: 0 },
    { x1: 0, y1: 0, x2: 18, y2: 22, coins: 800, points: 0 },
    { x1: 0, y1: 0, x2: 22, y2: 24, coins: 1500, points: 0 },
    { x1: 0, y1: 0, x2: 25, y2: 25, coins: 3000, points: 30 },
    { x1: 0, y1: 0, x2: 27, y2: 25, coins: 6000, points: 50 },
  ];
  const LAND_LEVELS_FRONT = [
    { x1: 0, y1: 6, x2: 16, y2: 22, coins: 0, points: 0 },      // L0 含马路对面
    { x1: 0, y1: 3, x2: 20, y2: 24, coins: 800, points: 0 },
    { x1: 0, y1: 1, x2: 23, y2: 25, coins: 1500, points: 0 },
    { x1: 0, y1: 0, x2: 25, y2: 25, coins: 3000, points: 30 },
    { x1: 0, y1: 0, x2: 27, y2: 25, coins: 6000, points: 50 },  // L4 满图 28×26
  ];
  // 🔒 默认水塘 v2（2026-08-13 二次修正）：谷仓正前方**隔一整排草**。
  // v1 的 (6,6) 与谷仓底座 (6,5) 是相邻格——有机水塘的波浪轮廓一溢出就贴着
  // 房子了（Chris:「水塘跟房子连在一起了」）。规矩：**默认水塘与任何建筑
  // footprint、菜地生长列(x1..3)之间至少隔 1 格草。**
  // 建筑占 (5..6, 2..5)，v2 最北的格是 y=7 → y=6 整排是草；x 最小 5 → 与
  // 菜地列隔着 x=4 一列草。
  // v3(2026-08-14): 十字形五格必然渲染成四瓣花 —— 改 2×2 实心块 + 东侧小湾,
  // 融合后是一块圆润的不规则塘。
  const DEFAULT_POND = { '5,7': 'water', '6,7': 'water', '5,8': 'water', '6,8': 'water', '7,8': 'water' };
  // 新开局水塘：跟菜地/摊/谷仓一起前移 +5y，仍隔一排草
  // 新号左侧小溪（老号已写入的 mapTerrain 不改）。贴着水车南沿，长条不是花瓣塘。
  const DEFAULT_POND_FRONT = { '0,13': 'water', '1,13': 'water', '0,14': 'water', '1,14': 'water', '0,15': 'water' };
  // 历代默认水塘形状 —— _migratePond 只认这些**精确形状**搬家（用户自己画的不动）：
  // v0 在菜地生长路径上（第13块地曾直接落进水里）；v1 贴着谷仓。
  const LEGACY_POND_SHAPES = [
    ['1,6', '2,6', '2,7', '3,7', '1,7'],             // v0
    ['6,6', '5,7', '6,7', '5,8', '6,8'],             // v1
    ['6,7', '5,8', '6,8', '7,8', '6,9'],             // v2(十字→四瓣, 不真实)
  ];
  const USE_PAINTED_BG = false;   // 2026-08-14 程序化世界上线; true = 回滚旧照片背景
  // 2026-08-15 宣传图同款光色：左上侧光、金色黄昏、草地偏暖黄绿。
  // 只改程序化调色/影子方向，不引入位图背景（USE_PAINTED_BG 铁律照旧）。
  const GRASS_A = '#7eaa3d', GRASS_B = '#72963a', GRASS_EDGE = 'rgba(60,90,40,0.18)';
  const SOIL_TOP = '#9c6b3f', SOIL_FURROW = 'rgba(80,50,26,0.5)';
  const ASSET_DIR = 'assets/images/map/';
  // All map art is served as WebP (B4 perf: 6.6MB PNG → 0.84MB WebP, -87%).
  // The original .png files are kept on disk as a rollback safety net; code
  // references .webp only. WebP is supported by every browser this game targets.
  const ASSET_SRC = {
    barn: 'p_barn.webp', house: 'p_house.webp', greenhouse: 'p_greenhouse.webp', coop: 'p_coop.webp', well: 'p_well.webp', stall: 'p_stall.webp', tree: 'p_tree.webp',
    p_house_1: 'p_house_1.webp', p_house_2: 'p_house_2.webp', p_house_3: 'p_house_3.webp', p_house_4: 'p_house_4.webp',
    p_house_5: 'p_house_5.webp', p_house_6: 'p_house_6.webp', p_house_7: 'p_house_7.webp', p_house_8: 'p_house_8.webp',
    p_house_9: 'p_house_9.webp', p_house_10: 'p_house_10.webp', p_house_11: 'p_house_11.webp', p_house_12: 'p_house_12.webp',
    p_house_13: 'p_house_13.webp', p_house_14: 'p_house_14.webp',
    p_house_15: 'p_house_15.webp', p_house_16: 'p_house_16.webp', p_house_17: 'p_house_17.webp', p_house_18: 'p_house_18.webp',
    p_house_19: 'p_house_19.webp', p_house_20: 'p_house_20.webp', p_house_21: 'p_house_21.webp', p_house_22: 'p_house_22.webp',
    deco_bush: 'deco_bush.webp', deco_lantern: 'deco_lantern.webp', deco_fence: 'deco_fence.webp', deco_wheel: 'deco_wheel.webp', deco_bridge: 'deco_bridge.webp',
    crop0: 'crop_qingcai_0.webp', crop1: 'crop_qingcai_1.webp', crop2: 'crop_qingcai_2.webp', crop3: 'crop_qingcai_3.webp',
    tile_grass: 'p_grass.webp', tile_grass_b: 'p_grass_b.webp', tile_grass_c: 'p_grass_c.webp',
    tile_soil: 'p_soil.webp', tile_path: 'p_path.webp', tile_water: 'p_water.webp',
    plot_bed: 'plot_bed.webp',
    hd_soil: 'hd_soil.webp',   // painted tilled-soil bed (grass no longer tiled — the bg image is the ground)
    hd_bg: 'hd_bg.webp',   // painted landscape backdrop (hills + forest + grass)
  };
  // Painted iso ground cube tiles. `cy` = fraction of the image height where the
  // diamond-top CENTER sits (so it lands on the cell center; tuned by screenshot).
  const ISO_TILES = {
    grass: { img: 'tile_grass', cy: 0.42 }, soil: { img: 'tile_soil', cy: 0.40 },
    path: { img: 'tile_path', cy: 0.34 }, water: { img: 'tile_water', cy: 0.40 },
  };
  // Grass variety (Hay Day ground feel): mostly plain, with sparse flowers/mossy
  // tiles. Each variant keeps its OWN cy anchor (the taller tufts push the flat
  // top down) so they tessellate flush with the plain tile. Picked deterministically
  // per cell so the pattern is stable across frames and reloads.
  const GRASS_VARIANTS = [
    { img: 'tile_grass', cy: 0.42 },     // plain (most cells)
    { img: 'tile_grass_b', cy: 0.47 },   // little yellow flowers
    { img: 'tile_grass_c', cy: 0.50 },   // mossy + bare dirt patch
  ];
  function grassVariant(gx, gy) {
    const h = ((gx * 73856093) ^ (gy * 19349663)) & 0xffff, r = h % 100;
    return r < 15 ? GRASS_VARIANTS[1] : (r < 25 ? GRASS_VARIANTS[2] : GRASS_VARIANTS[0]);
  }
  // Painted iso 4-stage crop sprites (each frame includes its own soil cube), keyed
  // by crop id. shanghai_miao keeps its pixel sprite (no cube) — handled separately.
  const ISO_CROPS = {
    eggplant: 'crop_eggplant', cilantro: 'crop_cilantro', jiucai: 'crop_chives',
    niu_jiao_jiao: 'crop_chili', suan_tai: 'crop_garlic', tomato: 'crop_tomato', cucumber: 'crop_cucumber',
    shanghai_miao: 'crop_qingcai',
    // 未单独重绘的叶菜/葱蒜走最近的油画贴图，避免成熟后飘 emoji
    qingcai: 'crop_qingcai', cai_xin: 'crop_choysum', bo_cai: 'crop_spinach',
    you_mai_cai: 'crop_youmai', wa_wa_cai: 'crop_wawa', da_bai_cai: 'crop_qingcai',
    ji_mao_cai: 'crop_jimao', tong_hao: 'crop_jimao', xian_cai: 'crop_spinach',
    wo_sun: 'crop_youmai',
    xi_lan_hua: 'crop_broccoli',
    tw_cauliflower: 'crop_cauli',
    hu_luo_bo: 'crop_carrot', bai_luo_bo: 'crop_daikon',
    yu_mi: 'crop_corn', lian_ou: 'crop_lotus',
    kumquat: 'crop_kumquat', pomelo: 'crop_pomelo',
    sha_tang_ju: 'crop_kumquat', wo_gan: 'crop_kumquat', pa_pa_gan: 'crop_pomelo',
    narcissus: 'crop_narcissus', taro: 'crop_taro', sheng_jiang: 'crop_ginger',
    mang_guo: 'crop_mango', pi_pa: 'crop_mango',
    huo_long_guo: 'crop_dragon',
    li_zhi: 'crop_lychee', long_yan: 'crop_lychee',
    xiang_yin_putao: 'crop_grape',
    osmanthus: 'crop_osmanthus',
    shan_yao: 'crop_yam', chun_sun: 'crop_bamboo',
    ye_zi: 'crop_coconut', liu_lian: 'crop_durian',
    jing_cong: 'crop_cong', xiao_cong: 'crop_chives', jiu_huang: 'crop_jiuhuang',
    ku_gua: 'crop_cucumber', fo_shou_gua: 'crop_cucumber', dong_gua: 'crop_cucumber',
  };
  // cost = 农场币 to place (coins; East Points stay scarce for real rewards). charm =
  // 农场魅力 gained (derived ≈ cost/8) — a vanity progression to drive the build impulse.
  const BUILDINGS = {
    // 我的家：可多座（HOME_CAP）。碰撞仍 2×2。点房子=改建补差价；调色盘再建=付全价。
    home: { img: 'house', w: 2, h: 2, sc: 2.3, zh: '我的家', en: 'My Home', tap: 'home', cost: 300 },
    barn: { img: 'barn', w: 2, h: 2, sc: 2.4, zh: '谷仓', en: 'Barn', tap: 'warehouse', cost: 350 },
    // 菜摊(类型名 house 是历史存档键, 不能改): 2026-08-14 二次定位 ——
    // Chris:「摊位看起来就是菜摊, 干脆作为菜摊用, 卖菜给路人; 种子店不需要实体」。
    // 点摊 → Farm.stall(路人溢价买菜); 买种子走底部「商店」按钮, 无实体入口。
    // 全场限一座(一位路人一处招呼)。招牌由 _drawShopSign 画「菜摊」。
    house: { img: 'stall', w: 2, h: 2, sc: 2.8, zh: '菜摊', en: 'Veggie Stand', tap: 'stall_sale', cost: 400, unique: true },
    greenhouse: { img: 'greenhouse', w: 2, h: 2, sc: 2.4, zh: '温室', en: 'Greenhouse', cost: 600 },
    coop: { img: 'coop', w: 2, h: 2, sc: 2.3, zh: '鸡舍', en: 'Coop', cost: 450 },
    stall: { img: 'stall', w: 2, h: 2, sc: 2.8, zh: '超市摊位', en: 'Stall', cost: 320 },
    well: { img: 'well', w: 1, h: 1, sc: 3.15, zh: '水井', en: 'Well', cost: 180 },
    tree: { img: 'tree', w: 1, h: 1, sc: 2.2, zh: '树', en: 'Tree', cost: 90 },
    bush: { img: 'deco_bush', w: 1, h: 1, sc: 1.7, zh: '花丛', en: 'Flowers', cost: 40 },
    lantern: { img: 'deco_lantern', w: 1, h: 1, sc: 2.6, zh: '灯笼', en: 'Lantern', cost: 70 },
    fence: { img: 'deco_fence', w: 1, h: 1, sc: 1.9, zh: '篱笆', en: 'Fence', cost: 40 },
    wheel: { img: 'deco_wheel', w: 2, h: 2, sc: 2.2, zh: '水车', en: 'Water Wheel', cost: 480 },
    bridge: { img: 'deco_bridge', w: 2, h: 1, sc: 1.6, zh: '小桥', en: 'Bridge', cost: 140 },
  };
  const BLD = 0.7;   // global building-sprite scale (Chris 2026-06-18: buildings were too big) — shrinks all building sprites uniformly so the starter farm fits the central meadow
  const charmOf = (b) => Math.max(1, Math.round((b.cost || 0) / 8));
  const COOP_INTERVAL = 5 * 60 * 1000, COOP_REWARD = 30;   // 鸡舍每 5 分钟产一窝蛋，收一次 +30 农场币
  const BED_W = 0.78;   // 独立苗床：格间露草。点按热区仍用满格菱形，缝里也好点
  // World-locked backdrop placement (mapview-iso _drawBackdrop). The landscape image's
  // focal point (BG_FX, BG_FY in image fractions = the central flat meadow) is pinned to
  // world cell (BG_ANCHOR_GX, BG_ANCHOR_GY) ≈ the farm start-area centre, and it scales
  // with farm zoom (see BG_ZOOM_REF). Tune these to position the farm on the meadow; they
  // keep the bg locked to the farm at every pan/zoom.
  const BG_FX = 0.5, BG_FY = 0.66, BG_ANCHOR_GX = 2, BG_ANCHOR_GY = 3.5;
  // 背景图固有尺寸（hd_bg 1248×832）。_autoFrame 在图片可能还没解码时就要算构图，
  // 所以用常量兜底，图片加载好之后以实际尺寸为准。
  const BG_IMG_W = 1248, BG_IMG_H = 832;
  // ===== 竖屏首屏构图（2026-08-11）=====
  // 07-07 审计标记「竖屏开局镜头失衡：农场只占屏高约 20%，上方近半屏空天空」，
  // 07-05 那版把竖屏 fitW 从 0.65 提到 1.15 想靠放大解决 —— 08-11 实测没解决：
  // 390×844 下地块块 314×159px，占屏宽 80.5%、屏高 18.8%，上方空白仍有 43.9%。
  //
  // 真正的根因是两条，跟 zoom 大小无关：
  // ① 2:1 等距下地块块的屏高恒等于屏宽的一半 —— 宽已经占 80%，高必然只有 19%，
  //    **再放大也填不满竖屏**，只会把地块顶出屏幕两侧。
  // ② 背景 hd_bg 是世界锁定的：焦点 BG_FY(0.66，草甸碗) 钉在农场中心，
  //    可见范围完全由 zoom 决定。zoom 2.29 时 dh≈2596px，竖屏只能看到图片
  //    y≈0.51–0.81 —— 正好是整张图最平的草甸带，天空和树线全在屏外。
  //    所以上方那 44% 不是「空」，是背景图最没内容的一块被放大铺满。
  //
  // 结论：竖屏构图要靠**降 zoom 把树线/远山放进画面**，而不是继续放大农场。
  // 下面两个常量就是构图目标，改它们即可微调（横屏/桌面不走这条分支）：
  const BG_TOP_TARGET = 0.42;   // 视口顶端要看到背景图的哪个纵向分数（0.42≈树线带）
  // 0.60 是截图对比选出来的：0.55 会把树线顶出视口顶端（上方退回成一片糊的远山），
  // 0.60 刚好让森林轮廓留在画面里、下方还剩一段前景草地。改这个值前先跑一遍截图。
  const FARM_SCREEN_Y = 0.60;   // 旧开局：农场落点
  const FARM_SCREEN_Y_FRONT = 0.72; // 新开局：整场再往镜头推一截
  const BG_ZOOM_REF = 0.70;   // zoom at which the bg exactly covers the canvas; >this = covers w/ margin, <this (zoomed out) = shrinks w/ farm, base shows around (no float)
  // ===== TUNABLE: farm position + size (independent of the background) — Chris 2026-06-18 =====
  // FARM_SCALE multiplies ONLY the farm (grid/plots/crops/buildings); the background is
  // unaffected, so this resizes the farm relative to the meadow. FARM_DX/FARM_DY shift the
  // whole farm on screen (pixels at default zoom): +DX → right, +DY → down. Tune these to
  // place the farm exactly on the meadow. (1.0 / 0 / 0 = current look.)
  // 2026-08-11 首屏构图：0.85 → 1.15。
  // 这是「农场显得不重要」和「上方一片空」这两件事的解耦点 ——
  //   zoom 决定**看到多少风景**（见 BG_TOP_TARGET，降 zoom 才能把树线放进画面），
  //   FARM_SCALE 决定**农场在这片风景里有多大**（只缩放农场，背景不动）。
  // 只调 zoom 的话两者会互相打架：降 zoom 露出了树线，农场也跟着缩小
  // （实测 zoom 2.29→1.75 时地块块从占屏宽 80.5% 掉到 61.4%）。
  // 提 FARM_SCALE 把农场大小补回来，构图不受影响。
  const FARM_SCALE = 1.15;     // 0.6 (small) … 1.0 … 1.5 (big)
  const FARM_DX = 0;          // −150 (left) … 0 … +150 (right), pixels
  const FARM_DY = -70;          // −150 (up)   … 0 … +150 (down), pixels
  // 'stall' 2026-08-14 从面板下架: 摊位贴图现在是种子店的专属形象, 再卖同款
  // 装饰摊 = 两个一样的摊分不清哪个能买种子。已放置的照常渲染不受影响。
  const PALETTE = ['home', 'barn', 'house', 'greenhouse', 'coop', 'well', 'tree', 'bush', 'lantern', 'fence', 'wheel', 'bridge'];
  // 我的家图册。改建只收与现款的差价；另建一座收全价（农户小宅另建至少 cost=300）。
  // lv 存在每座 map 对象上。全场最多 HOME_CAP 座。
  const HOME_CAP = 4;
  const HOME_CATS = [
    { id: 'cottage', zh: '农舍', en: 'Cottages', face: 'p_house_1' },
    { id: 'court', zh: '小院', en: 'Courtyards', face: 'p_house_17' },
    { id: 'villa', zh: '洋房', en: 'Villas', face: 'p_house_5' },
    { id: 'mansion', zh: '豪宅', en: 'Mansions', face: 'p_house_8' },
  ];
  const HOME_LEVELS = [
    { zh: '农户小宅', en: 'Farm Cottage',     cost: 0,     needLv: 1,  charm: 40,   upkeep: 0,   stem: 'p_house_1', draw: 1.00, mansion: false, cat: 'cottage' },
    { zh: '砖瓦农居', en: 'Brick Farmhouse',  cost: 1200,  needLv: 3,  charm: 90,   upkeep: 8,   stem: 'p_house_2', draw: 1.22, mansion: false, cat: 'cottage' },
    { zh: '院落人家', en: 'Courtyard Home',   cost: 3000,  needLv: 5,  charm: 160,  upkeep: 15,  stem: 'p_house_3', draw: 1.48, mansion: false, cat: 'court' },
    { zh: '乡绅别墅', en: 'Country Villa',    cost: 6000,  needLv: 7,  charm: 260,  upkeep: 30,  stem: 'p_house_4', draw: 1.75, mansion: false, cat: 'villa' },
    { zh: '花园洋房', en: 'Garden Manor',     cost: 12000, needLv: 9,  charm: 400,  upkeep: 50,  stem: 'p_house_5', draw: 2.05, mansion: false, cat: 'villa' },
    { zh: '泳池雅墅', en: 'Pool Villa',       cost: 20000, needLv: 11, charm: 620,  upkeep: 90,  points: 100, stem: 'p_house_6', draw: 2.35, mansion: true, cat: 'mansion' },
    { zh: '湖景豪宅', en: 'Lakeside Mansion', cost: 36000, needLv: 14, charm: 920,  upkeep: 160, points: 250, stem: 'p_house_7', draw: 2.70, mansion: true, cat: 'mansion' },
    { zh: '东方庄园', en: 'Eastern Estate',   cost: 60000, needLv: 18, charm: 1400, upkeep: 250, points: 400, stem: 'p_house_8', draw: 3.05, mansion: true, cat: 'mansion' },
    { zh: '石墙农舍', en: 'Stone Hut',        cost: 1500,  needLv: 3,  charm: 95,   upkeep: 8,   stem: 'p_house_9', draw: 1.20, mansion: false, cat: 'cottage' },
    { zh: '青瓦小院', en: 'Grey-Tile Court',  cost: 3500,  needLv: 5,  charm: 175,  upkeep: 18,  stem: 'p_house_10', draw: 1.50, mansion: false, cat: 'court' },
    { zh: '双翼别墅', en: 'Twin-Wing Villa',  cost: 7000,  needLv: 7,  charm: 280,  upkeep: 35,  stem: 'p_house_11', draw: 1.80, mansion: false, cat: 'villa' },
    { zh: '花廊洋房', en: 'Pergola Manor',    cost: 14000, needLv: 9,  charm: 430,  upkeep: 55,  stem: 'p_house_12', draw: 2.08, mansion: false, cat: 'villa' },
    { zh: '圆池雅墅', en: 'Round-Pool Villa', cost: 24000, needLv: 11, charm: 680,  upkeep: 100, points: 150, stem: 'p_house_13', draw: 2.38, mansion: true, cat: 'mansion' },
    { zh: '园林庄园', en: 'Garden Estate',    cost: 68000, needLv: 18, charm: 1500, upkeep: 280, points: 500, stem: 'p_house_14', draw: 3.08, mansion: true, cat: 'mansion' },
    { zh: '茅草暖屋', en: 'Thatched Cottage', cost: 800,   needLv: 1,  charm: 70,   upkeep: 5,   stem: 'p_house_15', draw: 1.08, mansion: false, cat: 'cottage' },
    { zh: '木篱农舍', en: 'Timber Farmhouse', cost: 1800,  needLv: 3,  charm: 110,  upkeep: 10,  stem: 'p_house_16', draw: 1.25, mansion: false, cat: 'cottage' },
    { zh: '四合小院', en: 'Siheyuan Court',   cost: 4200,  needLv: 5,  charm: 190,  upkeep: 20,  stem: 'p_house_17', draw: 1.55, mansion: false, cat: 'court' },
    { zh: '竹影人家', en: 'Bamboo Home',      cost: 5000,  needLv: 5,  charm: 210,  upkeep: 22,  stem: 'p_house_18', draw: 1.58, mansion: false, cat: 'court' },
    { zh: '黄墙洋楼', en: 'Ochre Villa',      cost: 8500,  needLv: 7,  charm: 310,  upkeep: 38,  stem: 'p_house_19', draw: 1.85, mansion: false, cat: 'villa' },
    { zh: '玫瑰洋房', en: 'Rose Villa',       cost: 15500, needLv: 9,  charm: 460,  upkeep: 58,  stem: 'p_house_20', draw: 2.12, mansion: false, cat: 'villa' },
    { zh: '白石宫墅', en: 'White Palace',     cost: 28000, needLv: 11, charm: 750,  upkeep: 110, points: 180, stem: 'p_house_21', draw: 2.45, mansion: true, cat: 'mansion' },
    { zh: '金顶庄园', en: 'Golden Estate',    cost: 80000, needLv: 18, charm: 1700, upkeep: 300, points: 550, stem: 'p_house_22', draw: 3.20, mansion: true, cat: 'mansion' },
  ];
  // EP-shop pets → painted iso animal sprites (replaces the emoji pet).
  const ANIMALS = { pet_chick: 'animal_chicken', pet_cat: 'animal_cat', pet_rabbit: 'animal_rabbit', decoration_dog: 'animal_dog', guard_dog: 'animal_dog' };
  /* 小动物体型（2026-08-15 Chris：「宠物小鸡小狗比人都大不好吧」）
     以摊前站着的路人为尺子，数值 = 占人身高的比例（实测：emoji 人的墨迹高度 ≈ 字号
     th*1.5，所以这个比例是诚实的）。按现实来：狗到人大腿(0.40)、猫到小腿(0.30)、
     鸡鸭到膝下(0.26)、乌龟贴地(0.15)；马/牛这类大牲口才接近或超过人高。
     ⚠️ 第一版给到 0.62/0.42（狗到腰）实测仍读作「和人一样大」——小动物要明显矮于人
     才像院子里的活物。_drawAnimal / _drawDeco 都用它；emoji 兜底宠物同表（没列的按 0.3）。 */
  const PERSON_H = 1.5;                       // 路人 emoji 字号（th 的倍数），见 _drawBuilding 摊前路人
  const ANIMAL_SCALE = { pet_chick: 0.26, pet_rabbit: 0.24, pet_cat: 0.30, decoration_dog: 0.40, guard_dog: 0.40,
    pet_turtle: 0.15, pet_duck: 0.26, pet_squirrel: 0.19, pet_hedgehog: 0.17, pet_swan: 0.36,
    pet_horse: 1.05, pet_cow: 0.85, pet_goat: 0.50, pet_sheep: 0.45, pet_pig: 0.40, pet_peacock: 0.45 };
  const animalH = (itemId, th) => th * PERSON_H * (ANIMAL_SCALE[itemId] || 0.3);   // 最大高度（px）
  const BRUSHES = [
    { key: 'path', zh: '小路', en: 'Path', color: '#a8743a' },
    { key: 'water', zh: '水塘', en: 'Water', color: '#5aa0c8' },
    { key: 'grass', zh: '草地·擦除', en: 'Grass', color: '#8bbf5a' },
  ];
  const SEASON_PARTICLES = {
    spring: ['🌸', '🌸', '🌷'], summer: ['🦋', '🦋', '🐝'],
    autumn: ['🍂', '🍁', '🍂'], winter: ['❄️', '❄️', '🌨'],
  };
  function monthSeason() {
    const m = new Date().getMonth() + 1;
    if (m >= 3 && m <= 5) return 'spring';
    if (m >= 6 && m <= 8) return 'summer';
    if (m >= 9 && m <= 11) return 'autumn';
    return 'winter';
  }

  const iso = {
    _on: false, _cv: null, _ctx: null, _dpr: 1,
    _camX: 0, _camY: 0, _zoom: 1, _ox: 0, _oy: 0,
    _w: 0, _h: 0, _img: {}, _cropImg: {},
    _pointers: {}, _drag: null, _pinch: null, _pressCell: null, _pressBuilding: -1, _glideRaf: null, _justHarvested: null,
    _tick: null, _raf: null, _lastFrame: 0,
    _cellToPlotN: -1,
    _build: false, _editMode: 'build', _brush: 'path', _painting: false, _clearMode: false,
    _sel: -1, _moving: null,
    _pets: {},          // seed -> {fx,fy,tx,ty,pause,face,hx,hy} live walk state (not persisted)
    _lastWalkT: 0,
    _buildBtn: null, _communityBtn: null, _palette: null, _hint: null, _modeTabs: null, _palBuild: null, _palTerrain: null,

    // DEFAULT farm view (Hay Day isometric). Chosen via Farm.state.farmStyle()
    // (saved preference + URL override); players switch in the guide (ⓘ).
    active() { return (Farm.state && Farm.state.farmStyle) ? Farm.state.farmStyle() === 'iso' : true; },
    _tw() { return TW * this._zoom * FARM_SCALE; },   // farm tile size (FARM_SCALE = farm-only zoom; bg uses base TW*zoom)
    _th() { return TH * this._zoom * FARM_SCALE; },
    _lang() { return (Farm.state && Farm.state.data && Farm.state.data.language === 'en') ? 'en' : 'zh'; },

    init() {
      if (!this.active() || this._on) return;
      this._on = true;
      document.body.classList.add('mapmode');
      const farmEl = document.getElementById('farm');
      if (farmEl) { farmEl.style.padding = '0'; farmEl.style.overflow = 'hidden'; }
      ['farmGrid', 'farmDecorations'].forEach((idd) => { const e = document.getElementById(idd); if (e) e.style.display = 'none'; });
      const sc = document.querySelector('.farm-scene'); if (sc) sc.style.display = 'none';

      this._ensureLandOrigin();
      this._stampDefaultWorld();

      const cv = document.createElement('canvas');
      cv.id = 'isoCanvas';
      cv.style.cssText = 'position:fixed;z-index:5;touch-action:none;display:block;background:#7a9a38;';
      document.body.appendChild(cv);
      this._cv = cv; this._ctx = cv.getContext('2d');

      Object.keys(ASSET_SRC).forEach((k) => { const im = new Image(); im.onload = () => { this._img[k] = im; this._bgKey = null; if (this._on) this.render(); }; im.src = ASSET_DIR + ASSET_SRC[k]; });   // _bgKey=null → re-render cached backdrop once the landscape/tiles finish loading
      HOME_LEVELS.forEach((s) => { if (s.stem) this._lazyImg(s.stem); });
      this._undoForwardOnce();
      this._buildLayout();
      // ⚠️ 顺序：必须在 _buildLayout 之后（老存档的 plot 坐标在那里才补上），
      // 在 _autoFrame 之前（搬完水塘再定镜头）。
      this._migratePond();
      this._repairPlotsOnWater();
      this._repairDecoOverlaps();
      this._resize();
      window.addEventListener('resize', () => { this._resize(); this._clampCam(); this.render(); });
      cv.addEventListener('pointerdown', (e) => this._down(e));
      cv.addEventListener('pointermove', (e) => this._move(e));
      cv.addEventListener('pointerup', (e) => this._up(e));
      cv.addEventListener('pointercancel', (e) => this._up(e));
      cv.addEventListener('wheel', (e) => this._wheel(e), { passive: false });

      this._buildUI();
      this._autoFrame();

      requestAnimationFrame(() => { this._syncSize(); this.render(); });
      this._tick = setInterval(() => { if (document.hidden) return; this._syncSize(); this.render(); }, 1000);
      this._startLoop();
      this.render();
      this.collectHomeUpkeep();
      if (Farm.fbAuth && Farm.fbAuth.isLoggedIn && Farm.fbAuth.isLoggedIn() && Farm.coach) {
        setTimeout(() => { if (Farm.coach) Farm.coach.fire('first_neighbor'); }, 3800);
      }
    },

    // One-time UNDO of the cancelled "forward move": any save that got shifted
    // +5,+4 by the (now-removed) forward migration is shifted back -5,-4 so it
    // returns to the original start zone. Runs BEFORE _buildLayout. Bounds-checked
    // (skip if it would go off-world); idempotent via farmFwdUndoneV1. Saves that
    // were never forwarded (no farmFwdV1) are left untouched.
    _undoForwardOnce() {
      const d = Farm.state.data;
      if (!d || d.farmFwdUndoneV1) return;
      if (!d.farmFwdV1) { d.farmFwdUndoneV1 = true; return; }   // never forwarded → nothing to undo
      const dx = -5, dy = -4;   // inverse of the cancelled forward shift (origin 1,2 → 6,6)
      const objs = [];
      (d.plots || []).forEach(p => { if (Number.isInteger(p.gx) && Number.isInteger(p.gy)) objs.push(p); });
      (d.map || []).forEach(o => objs.push(o));
      (d.decorations || []).forEach(o => { if (Number.isInteger(o.gx) && Number.isInteger(o.gy)) objs.push(o); });
      const terr = d.mapTerrain || {};
      const terrKeys = Object.keys(terr);
      let ok = true;
      for (const o of objs) { if (o.gx + dx < 0 || o.gy + dy < 0 || o.gx + dx > COLS - 1 || o.gy + dy > ROWS - 1) { ok = false; break; } }
      if (ok) for (const k of terrKeys) { const a = k.split(','); const gx = +a[0] + dx, gy = +a[1] + dy; if (gx < 0 || gy < 0 || gx > COLS - 1 || gy > ROWS - 1) { ok = false; break; } }
      if (ok) {
        objs.forEach(o => { o.gx += dx; o.gy += dy; });
        if (terrKeys.length) { const nt = {}; terrKeys.forEach(k => { const a = k.split(','); nt[(+a[0] + dx) + ',' + (+a[1] + dy)] = terr[k]; }); d.mapTerrain = nt; }
      }
      d.farmFwdUndoneV1 = true;
      if (Farm.state.save) Farm.state.save();
    },

    /* 旧默认水塘搬家（一次性，flag=pondMoveV2）。只在地形**正好等于**某代默认
       形状时才搬——用户自己画过的水塘一格都不动。目标格若被占（极端情况）就放弃，
       靠 _repairPlotsOnWater 兜底把菜地挪开。
       （pondMoveV1 是 v1 位置的旧 flag，已废弃不再读——v1 自己也成了要搬走的历史形状。） */
    _migratePond() {
      const d = Farm.state.data;
      if (!d || d.pondMoveV3) return;
      d.pondMoveV3 = true;   // 先落 flag：无论搬不搬，只判一次
      const t = d.mapTerrain || {};
      const keys = Object.keys(t);
      const isLegacy = LEGACY_POND_SHAPES.some((shape) =>
        keys.length === shape.length && shape.every((k) => t[k] === 'water'));
      if (!isLegacy) { if (Farm.state.save) Farm.state.save(); return; }
      // 目标格必须全空（无菜地/建筑/装饰）
      const taken = {};
      (d.plots || []).forEach((p) => { if (Number.isInteger(p.gx)) taken[p.gx + ',' + p.gy] = 1; });
      (d.map || []).forEach((o) => {
        const b = BUILDINGS[o.type]; const w = b ? b.w : 1, h = b ? b.h : 1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) taken[(o.gx + x) + ',' + (o.gy + y)] = 1;
      });
      (d.decorations || []).forEach((o) => { if (Number.isInteger(o.gx)) taken[o.gx + ',' + o.gy] = 1; });
      if (Object.keys(DEFAULT_POND).some((k) => taken[k])) { if (Farm.state.save) Farm.state.save(); return; }
      d.mapTerrain = Object.assign({}, DEFAULT_POND);
      if (Farm.state.save) Farm.state.save();
    },

    /* 菜地落在水格上 = 数据级重叠（Chris 的第 13 块地就是：老公式把它排到 (1,6)，
       正好是旧默认水塘的一格）。每次进图都跑，幂等：有重叠才搬、没重叠零写入。
       搬到最近的可用格（欧氏距离），保证「水塘跟菜地分开」。 */
    _repairPlotsOnWater() {
      const d = Farm.state.data;
      if (!d || !Array.isArray(d.plots)) return;
      const t = this._terrain();
      let moved = false;
      for (let i = 0; i < d.plots.length; i++) {
        const p = d.plots[i];
        if (!Number.isInteger(p.gx) || t[p.gx + ',' + p.gy] !== 'water') continue;
        // 由近及远找第一个能放菜地的格子
        let best = null, bd = Infinity;
        for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
          if (!this._cellFreeForPlot(gx, gy)) continue;
          const dist = (gx - p.gx) * (gx - p.gx) + (gy - p.gy) * (gy - p.gy);
          if (dist < bd) { bd = dist; best = [gx, gy]; }
        }
        if (best) {
          delete this._cellToPlot[p.gx + ',' + p.gy];
          p.gx = best[0]; p.gy = best[1];
          this._cellToPlot[p.gx + ',' + p.gy] = i;
          moved = true;
        }
      }
      if (moved && Farm.state.save) Farm.state.save();
    },

    /* 装饰摆件落在被占格上（历史存档在互斥检查补齐之前可能已经叠了）→ 搬到最近
       空格。每次进图跑，幂等：没重叠零写入。与 _repairPlotsOnWater 同一套路。 */
    _repairDecoOverlaps() {
      const d = Farm.state.data;
      if (!d || !Array.isArray(d.decorations)) return;
      let moved = false;
      for (let i = 0; i < d.decorations.length; i++) {
        const o = d.decorations[i];
        if (!Number.isInteger(o.gx) || !Number.isInteger(o.gy)) continue;   // 未落位的交给 _decoPlacements
        const k = o.gx + ',' + o.gy;
        const clash = this._plotCellSet()[k] || this._terrain()[k] === 'water'
          || this._buildingAt(o.gx, o.gy) >= 0 || this._decoAt(o.gx, o.gy) !== i;   // ≠i = 两个摆件同格，后者搬
        if (!clash) continue;
        let best = null, bd = Infinity;
        for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
          if (!this._decoCellFree(gx, gy, i)) continue;
          const dist = (gx - o.gx) * (gx - o.gx) + (gy - o.gy) * (gy - o.gy);
          if (dist < bd) { bd = dist; best = [gx, gy]; }
        }
        if (best) { o.gx = best[0]; o.gy = best[1]; moved = true; }
      }
      if (moved && Farm.state.save) Farm.state.save();
    },

    _buildLayout() {
      this._cellToPlot = {};
      const plots = Farm.state.data.plots || [];
      let migrated = false;
      for (let i = 0; i < plots.length; i++) {
        const p = plots[i];
        // plots now carry their own cell coords (so new plots can sit anywhere on owned
        // land); migrate legacy index-derived plots once.
        if (!Number.isInteger(p.gx) || !Number.isInteger(p.gy)) {
          const org = this._plotOrigin();
          let gx = org.ox + (i % PLOT_COLS), gy = org.oy + Math.floor(i / PLOT_COLS);
          // ⚠️ 老公式落点可能撞水/撞已占格。撞了就沿列继续往下找空格。
          const terr = this._terrain();
          let guard = 0;
          while (guard++ < COLS * ROWS && (terr[gx + ',' + gy] === 'water' || this._cellToPlot[gx + ',' + gy] != null || this._buildingAt(gx, gy) >= 0)) {
            gx += 1;
            if (gx >= org.ox + PLOT_COLS) { gx = org.ox; gy += 1; }
          }
          p.gx = gx; p.gy = gy; migrated = true;
        }
        this._cellToPlot[p.gx + ',' + p.gy] = i;
      }
      if (migrated && Farm.state.save) Farm.state.save();
    },
    _plotGX(i) { const p = (Farm.state.data.plots || [])[i]; if (!p) return 0; if (Number.isInteger(p.gx)) return p.gx; const o = this._plotOrigin(); return o.ox + (i % PLOT_COLS); },
    _plotGY(i) { const p = (Farm.state.data.plots || [])[i]; if (!p) return 0; if (Number.isInteger(p.gy)) return p.gy; const o = this._plotOrigin(); return o.oy + Math.floor(i / PLOT_COLS); },
    _plotPos(i) {
      if (this._moving && this._moving.kind === 'plot' && this._moving.idx === i)
        return { gx: this._moving.gx, gy: this._moving.gy };
      return { gx: this._plotGX(i), gy: this._plotGY(i) };
    },
    _isFrontLand() { return !!(Farm.state.data && Farm.state.data.landOrigin === 'front'); },
    _plotOrigin() { return this._isFrontLand() ? PLOT_ORIGIN_FRONT : PLOT_ORIGIN_BACK; },
    _landTable() { return this._isFrontLand() ? LAND_LEVELS_FRONT : LAND_LEVELS_BACK; },
    _ensureLandOrigin() {
      const d = Farm.state.data;
      if (!d || d.landOrigin === 'front' || d.landOrigin === 'back') return;
      // 只给真正的新号打 front：还没有地图、水塘、也没有落过格的菜地。
      // 老存档缺这个字段 → back，地界一格都不动。
      const brandNew = !Array.isArray(d.map) && d.mapTerrain == null
        && !(d.plots || []).some((p) => p && Number.isInteger(p.gx));
      d.landOrigin = brandNew ? 'front' : 'back';
      if (Farm.state.save) Farm.state.save();
    },
    // 只在 map / mapTerrain 还是空的时候盖默认世界。老号已经有数组/对象 → 一格不碰。
    _stampDefaultWorld() {
      const d = Farm.state.data;
      if (!d) return;
      if (!Array.isArray(d.map)) {
        d.map = this._isFrontLand() ? this._defaultMapFront()
          : [{ type: 'house', gx: 1, gy: 7 }, { type: 'barn', gx: 5, gy: 4 }];
        if (Farm.state.save) Farm.state.save();
      }
      if (d.mapTerrain == null) {
        d.mapTerrain = Object.assign({}, this._isFrontLand() ? DEFAULT_POND_FRONT : DEFAULT_POND);
        if (Farm.state.save) Farm.state.save();
      }
    },
    _defaultMapFront() {
      const now = Date.now();
      // 油画摆场（L0 地界 0,9–8,15；田在 3–5,10–13）：
      // 鸡舍左后、水车贴溪、摊贴路、仓/温室在田右、井和灯笼在田沿。
      return [
        { type: 'house', gx: 3, gy: 14 },
        { type: 'barn', gx: 6, gy: 10 },
        { type: 'coop', gx: 0, gy: 9, eggAt: now },
        { type: 'wheel', gx: 0, gy: 11 },
        { type: 'greenhouse', gx: 6, gy: 13 },
        { type: 'well', gx: 5, gy: 14 },
        { type: 'lantern', gx: 2, gy: 13 },
        { type: 'bush', gx: 6, gy: 9 },
        { type: 'bush', gx: 7, gy: 12 },
      ];
    },

    _farmRect() {
      const f = document.getElementById('farm');
      if (f) { const r = f.getBoundingClientRect(); if (r.width > 10 && r.height > 10) return r; }
      const t = document.getElementById('topbar'), b = document.getElementById('bottombar');
      const th = t ? t.getBoundingClientRect().height : 56, bh = b ? b.getBoundingClientRect().height : 64;
      return { left: 0, top: th, width: window.innerWidth, height: Math.max(120, window.innerHeight - th - bh) };
    },
    _cssW() { return this._w; }, _cssH() { return this._h; },
    _resize() {
      const r = this._farmRect();
      this._w = r.width; this._h = r.height;
      this._ox = r.width / 2; this._oy = this._th() * 1.5;
      this._cv.style.left = r.left + 'px'; this._cv.style.top = r.top + 'px';
      this._cv.style.width = r.width + 'px'; this._cv.style.height = r.height + 'px';
      this._dpr = Math.min(2, window.devicePixelRatio || 1);
      this._cv.width = r.width * this._dpr; this._cv.height = r.height * this._dpr;
      this._ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    },
    _syncSize() { const r = this._farmRect(); if (Math.abs(r.width - this._w) > 1 || Math.abs(r.height - this._h) > 1) { this._resize(); this._clampCam(); } },
    // Frame the PLOTS (where ~all taps go), not the whole 9×11 grid. The old code
    // sized zoom off (COLS+ROWS) — but the on-screen iso width of content is only
    // its (Δgx+Δgy) diagonal, far less than COLS+ROWS, so it over-shrank to ZMIN
    // and plots became too small/cramped to tap on phones. Framing the compact plot
    // block with its REAL screen extent more than doubles tile size (50→110px on a
    // phone). Buildings sit just off the initial view; a short pan reveals them.
    _autoFrame() {
      // Frame the WHOLE farm — plots + buildings (with footprint) + decorations — so
      // nothing is cut off at the screen edges (Chris 2026-06-18: buildings were being
      // clipped because only the plot block was framed).
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      // 同时记屏幕轴（u=gx−gy 横向, v=gx+gy 纵向）的范围：镜头中心按 u/v 取，
      // 而不是按 gx/gy 包围盒的中心 —— 后者是格子坐标里的轴对齐矩形，投影到屏幕
      // 是个大菱形，物件只占其中一角时中心会整体偏到一边（2026-08-15 实测：
      // 菜摊到谷仓横跨屏幕 63→248px，取景中心却落在 155，整片农场左偏 40px，
      // 摊前路人被切在画外）。zoom 的算法不动。
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      const acc = (gx, gy) => {
        if (gx < minx) minx = gx; if (gy < miny) miny = gy; if (gx > maxx) maxx = gx; if (gy > maxy) maxy = gy;
        const u = gx - gy, v = gx + gy;
        if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
      };
      const plots = Farm.state.data.plots || [];
      for (let i = 0; i < plots.length; i++) acc(this._plotGX(i), this._plotGY(i));
      const map = Farm.state.data.map || [];
      for (const o of map) {
        const b = BUILDINGS[o.type]; const w = b ? b.w : 1, h = b ? b.h : 1; acc(o.gx, o.gy); acc(o.gx + w - 1, o.gy + h - 1);
        // 菜摊前站着等的路人（_drawBuilding 里画在 gy+2.15 的路上）也算进镜头，
        // 否则摊子贴着屏幕左缘时，路人和「×2 💰」求购气泡被切在画外（2026-08-15 截图实证）
        if (o.type === 'house') acc(o.gx + 1, o.gy + 2);
      }
      const decos = Farm.state.data.decorations || [];
      for (const d of decos) { if (Number.isInteger(d.gx) && Number.isInteger(d.gy)) acc(d.gx, d.gy); }
      // 水塘也框进开局镜头（2026-08-13 换位后它在谷仓前方，不框会切出画面外）
      const terr = this._terrain();
      for (const k of Object.keys(terr)) {
        if (terr[k] !== 'water') continue;
        const a = k.split(','); acc(+a[0], +a[1]);
      }
      if (minx === Infinity) { minx = miny = 0; maxx = maxy = 1; minU = -1; maxU = 1; minV = 0; maxV = 2; }

      const span = (maxx - minx) + (maxy - miny);   // iso screen diagonal (du === dv === Δgx+Δgy)
      const screenW = (span * TW / 2 + TW) * FARM_SCALE;            // +1 tile side padding (× farm scale)
      const screenH = (span * TH / 2 + TH * 4.5) * FARM_SCALE;      // generous headroom for tall building roofs
      // 开局镜头 fit-to-farm（2026-07-05 UX 第 1 批）：旧逻辑 cap 0.85 → 农田只占屏
      // ~15%、地块命中区 ~33px。改为「包围盒宽约占视口宽 65%」与「单块地块屏宽
      // ≥53px（可点性底线 44px + 余量）」取较大者；再用高度护栏（农场高 ≤90% 视口）
      // 防横屏小窗溢出，最后 clamp 到 ZMIN/ZMAX。相机无持久化，每次进图都 fit。
      // 竖屏开局构图（2026-07-07 audit B2 P1）：旧「宽 65%」在竖屏把农场压成
      // ~16% 屏高的细条、上方近半屏纯天空（CDP 实测 fracH 0.16 / topSky 0.48）。
      // 竖屏改为包围盒吃满视口宽并允许 ~10% 出血（Hay Day 同款「农场略大于
      // 一屏、可平移」构图）；世界锁定的背景随 zoom 同步放大 → 可见窗口滑向
      // 草地带，天空占比大幅回落。横屏/桌面保持原 65% 构图不变。
      const portrait = this._cssH() > this._cssW();
      const W = this._cssW(), H = this._cssH();
      const minTap = 53 / (TW * FARM_SCALE);                        // 地块屏宽 ≥53px（可点性底线）
      const fitH = (H * 0.90) / screenH;                            // 高度护栏
      if (portrait) {
        // 竖屏：由「树线要落在视口顶端」反解 zoom（推导见文件头 BG_TOP_TARGET 注释）。
        //   dh = BG_IMG_H · cover · zoom / BG_ZOOM_REF      （cover = 背景铺满画布的基准缩放）
        //   要求 (FARM_SCREEN_Y·H) / dh === BG_FY − BG_TOP_TARGET
        const bg = this._img.hd_bg;
        const bw = (bg && bg.width) || BG_IMG_W, bh = (bg && bg.height) || BG_IMG_H;
        const cover = Math.max(W / bw, H / bh);
        const screenY = this._isFrontLand() ? FARM_SCREEN_Y_FRONT : FARM_SCREEN_Y;
        const zComp = (screenY * H * BG_ZOOM_REF) / ((BG_FY - BG_TOP_TARGET) * bh * cover);
        // 农场再小也不能小到点不动：minTap 是硬底线，构图让位于可玩性。
        // 同时不允许比「包围盒吃满视口宽」更大 —— 否则地块被顶出屏幕两侧。
        const fitWMax = (W * 1.05) / screenW;
        this._zoom = Math.max(ZMIN, Math.min(ZMAX, fitH, Math.max(minTap, Math.min(zComp, fitWMax))));
      } else {
        // 横屏 / 桌面：维持原「包围盒宽约占视口宽 65%」构图，不动。
        const fitW = (W * 0.65) / screenW;
        this._zoom = Math.max(ZMIN, Math.min(ZMAX, Math.min(Math.max(fitW, minTap), fitH)));
      }
      const u = (minU + maxU) / 2, v = (minV + maxV) / 2;
      this._camX = u * this._tw() / 2;
      // 农场（格心）落在画布高度的 FARM_SCREEN_Y（竖屏）/ 64%（横屏）处。
      this._camY = this._oy + v * this._th() / 2 - H * (portrait ? (this._isFrontLand() ? FARM_SCREEN_Y_FRONT : FARM_SCREEN_Y) : 0.64);
      this._clampCam();
    },

    // ---- iso transforms ----
    // Rolling-terrain height (Chris 2026-06-18 #3 "农田顺着山坡起伏"). Returns a
    // UNITLESS vertical offset in tile-height units; _cell multiplies by th so it
    // scales with zoom. Long wavelength + modest amplitude → adjacent beds differ
    // only ~6px (stay near-coplanar, no staircase) while the whole field visibly
    // rolls (~30px peak-to-trough), so the farmland drapes over the hills instead
    // of sitting as a flat slab. Mean ≈ 0 so camera framing/clamping is unaffected.
    _hUnit(gx, gy) {
      const a = Math.sin((gx + gy) * 0.30 + 0.5) * 0.42;
      const b = Math.cos((gx - gy) * 0.26 - 0.4) * 0.22;
      return a + b;
    },
    _cell(gx, gy) {
      const tw = this._tw(), th = this._th();
      return { x: this._ox + (gx - gy) * tw / 2 - this._camX + FARM_DX, y: this._oy + (gx + gy) * th / 2 - this._camY + this._hUnit(gx, gy) * th + FARM_DY };
    },
    // Background anchor transform — BASE tiles, NO farm scale/offset/height, so the
    // backdrop stays put when the farm is scaled or panned via FARM_SCALE/FARM_DX/FARM_DY.
    _cellBg(gx, gy) {
      const btw = TW * this._zoom, bth = TH * this._zoom;
      return { x: this._ox + (gx - gy) * btw / 2 - this._camX, y: this._oy + (gx + gy) * bth / 2 - this._camY };
    },
    // Inverse of _cell. The flat algebraic inverse is only a first guess because
    // _cell now adds a per-cell height; refine by scanning a small window around
    // that guess and returning the FRONTMOST cell whose displaced diamond contains
    // the point (matches draw order, so taps land on what you see).
    _screenToCell(sx, sy) {
      const tw = this._tw(), th = this._th();
      // subtract FARM_DX/FARM_DY — _cell adds them, so the inverse must remove them or
      // every tap is off by the farm offset (was making build-mode selection miss badly).
      const dx = sx + this._camX - this._ox - FARM_DX, dy = sy + this._camY - this._oy - FARM_DY;
      const fu = dx / (tw / 2), fv = dy / (th / 2);
      const g0 = Math.round((fv + fu) / 2), h0 = Math.round((fv - fu) / 2);
      let best = null, bestSum = -Infinity;
      for (let gy = h0 - 3; gy <= h0 + 3; gy++) {
        for (let gx = g0 - 3; gx <= g0 + 3; gx++) {
          const c = this._cell(gx, gy);
          const d = Math.abs(sx - c.x) / (tw / 2) + Math.abs(sy - c.y) / (th / 2);
          if (d <= 1.0 && (gx + gy) > bestSum) { bestSum = gx + gy; best = { gx, gy }; }
        }
      }
      if (best) return best;
      return { gx: Math.floor((fv + fu) / 2), gy: Math.floor((fv - fu) / 2) };
    },
    _clampCam() {
      // Bound the camera so the painted backdrop ALWAYS covers the viewport — never a base
      // band (Chris 2026-06-18 spec). The bg is world-anchored to cell BG_ANCHOR; we solve
      // the cover constraints (bg edges past the viewport edges) for camX/camY. Vertically
      // it's pinned tight (at min zoom the bg height == viewport height → no vertical pan);
      // horizontally the wider image leaves room to pan left/right.
      const tw = this._tw(), th = this._th(), W = this._cssW(), H = this._cssH();
      /* 🔒 程序化世界(2026-08-14 Chris:「怎样使地形真正跟农场物件融合,
         不受画面缩放影响, 大型游戏是怎么做到的」):
         Hay Day/Township 的答案是**世界里没有"背景图"** —— 天空/远山/草地/
         道路/建筑全部活在同一套世界坐标里, 随镜头一起变换, 所以永远严丝合缝、
         任何缩放都清晰(程序化 = 每帧按设备像素重画, 天生矢量)。
         照片方案的两宗罪: 不懂格子(贴合只能"差不多")、放大就糊(1600px 位图)。
         USE_PAINTED_BG=true 可一键回滚旧照片背景(资产仍在)。 */
      const bg = USE_PAINTED_BG ? this._img.hd_bg : null;
      if (bg && bg.width) {
        const scale = Math.max(W / bg.width, H / bg.height) * Math.max(1, this._zoom / BG_ZOOM_REF);
        const dw = bg.width * scale, dh = bg.height * scale;
        // a.x = AX - camX, a.y = AY - camY (camera-independent parts of _cellBg(BG_ANCHOR) —
        // BASE tiles, no farm scale/offset, so the clamp matches the drawn backdrop)
        const btw = TW * this._zoom, bth = TH * this._zoom;
        const AX = this._ox + (BG_ANCHOR_GX - BG_ANCHOR_GY) * btw / 2;
        const AY = this._oy + (BG_ANCHOR_GX + BG_ANCHOR_GY) * bth / 2;
        const cxLo = AX - BG_FX * dw, cxHi = AX - W + (1 - BG_FX) * dw;   // dw>=W → cxLo<=cxHi
        const cyLo = AY - BG_FY * dh, cyHi = AY - H + (1 - BG_FY) * dh;   // dh>=H → cyLo<=cyHi
        this._camX = Math.max(cxLo, Math.min(cxHi, this._camX));
        this._camY = Math.max(cyLo, Math.min(cyHi, this._camY));
        return;
      }
      // Fallback before the bg image loads: keep the grid roughly on-screen.
      const minU = (0 - (ROWS - 1)), maxU = ((COLS - 1) - 0), maxV = (COLS - 1) + (ROWS - 1);
      this._camX = Math.max(minU * tw / 2 - W * 0.6, Math.min(maxU * tw / 2 + W * 0.6, this._camX));
      this._camY = Math.max(this._oy - H * 1.05, Math.min(this._oy + maxV * th / 2 - H * 0.2, this._camY));
    },
    _zoomAt(px, py, nz) {
      const z = Math.max(ZMIN, Math.min(ZMAX, nz));
      if (z === this._zoom) return;
      const u = (px + this._camX - this._ox) / (TW * this._zoom / 2), v = (py + this._camY - this._oy) / (TH * this._zoom / 2);
      this._zoom = z;
      this._camX = this._ox + u * (TW * z / 2) - px;
      this._camY = this._oy + v * (TH * z / 2) - py;
      this._clampCam(); this.render();
    },

    // ---- input ----
    _local(e) { const r = this._cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },
    _down(e) {
      // 鼠标拖拽移出画布不再失控冻结（audit B2 P2：触摸有隐式捕获，鼠标没有）
      try { this._cv.setPointerCapture(e.pointerId); } catch (err) {}
      this._glideStop();   // 手指按下即接住惯性滑行（Hay Day 手感）
      const p = this._local(e); this._pointers[e.pointerId] = p;
      const ids = Object.keys(this._pointers);
      if (ids.length === 2) { const [a, b] = ids.map(k => this._pointers[k]); this._pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this._zoom }; this._drag = null; this._moving = null; this._painting = false; this._pressCell = null; this._pressBuilding = -1; return; }
      if (this._build && this._editMode === 'terrain') { const c = this._screenToCell(p.x, p.y); this._painting = true; this._paintCell(c.gx, c.gy); return; }
      if (this._build) {
        if (this._sel >= 0) { const ch = this._delChip((Farm.state.data.map)[this._sel]); if (Math.hypot(p.x - ch.x, p.y - ch.y) <= ch.r) { const o = Farm.state.data.map[this._sel], b = BUILDINGS[o.type]; let refund = b ? Math.round((b.cost || 0) / 2) : 0; if (o.type === 'home') { const spec = this._homeSpec(o); refund = Math.round(Math.max(BUILDINGS.home.cost || 300, spec.cost || 0) / 2); } Farm.state.data.map.splice(this._sel, 1); this._sel = -1; if (refund > 0) { Farm.state.addCoins(refund); if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD(); if (Farm.ui && Farm.ui.toast) Farm.ui.toast(this._lang() === 'en' ? ('Removed — refunded ' + refund + ' coins') : ('已移除 — 退回 ' + refund + ' 农场币')); } this._refreshPaletteAfford(); Farm.state.save(); this.render(); return; } }
        // Grab by the VISIBLE sprite (generous), not the tiny footprint cell — on a
        // phone you tap the building/decoration you see, which sits above its cell.
        const phit = this._plotAtPoint(p.x, p.y);
        if (phit && phit.i != null) {
          this._sel = -1;
          this._moving = { kind: 'plot', idx: phit.i, gx: phit.gx, gy: phit.gy, valid: true, sx: p.x, sy: p.y, moved: false };
          this.render(); return;
        }
        const bidx = this._buildingAtPoint(p.x, p.y);
        if (bidx >= 0) { const o = Farm.state.data.map[bidx]; this._sel = bidx; this._moving = { kind: 'building', idx: bidx, gx: o.gx, gy: o.gy, valid: true, sx: p.x, sy: p.y, moved: false }; this.render(); return; }
        const didx = this._decoAtPoint(p.x, p.y);
        if (didx >= 0) { const d = Farm.state.data.decorations[didx]; this._sel = -1; this._moving = { kind: 'deco', idx: didx, gx: d.gx, gy: d.gy, valid: true, sx: p.x, sy: p.y, moved: false }; this.render(); return; }
      }
      // 按压高亮（2026-07-05 UX 第 1 批 #5）：非建造模式下按下即命中测试地块，
      // 命中的 cell 存 _pressCell，render() 里盖一层半透明白菱形做即时反馈。
      // 直接调 render()（不等 30fps rAF 节流）保证按下当帧可见；up/cancel/
      // 判定为拖拽/进入捏合时清除。只存 {gx,gy} 小对象，无每帧分配。
      this._pressCell = null; this._pressBuilding = -1;
      if (!this._build) {
        const hit = this._plotAtPoint(p.x, p.y);
        if (hit) { this._pressCell = { gx: hit.gx, gy: hit.gy }; this.render(); }
        else {
          // 建筑按压反馈（audit B2 P2）：按下命中建筑 → 记录索引，_drawBuilding
          // 对该建筑画 94% squash（同地块按压高亮的生命周期：up/cancel/拖拽/捏合清）。
          const pb = this._buildingAtPoint(p.x, p.y);
          if (pb >= 0) { this._pressBuilding = pb; this.render(); }
        }
      }
      this._drag = { x: p.x, y: p.y, camX: this._camX, camY: this._camY, moved: false, vx: 0, vy: 0, lastX: p.x, lastY: p.y, lastT: performance.now() };
    },
    _move(e) {
      if (!(e.pointerId in this._pointers)) return;
      this._pointers[e.pointerId] = this._local(e);
      const ids = Object.keys(this._pointers);
      if (this._pinch && ids.length >= 2) {
        const [a, b] = ids.map(k => this._pointers[k]);
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this._zoomAt(mid.x, mid.y, this._pinch.zoom * (dist / this._pinch.dist)); return;
      }
      const p = this._pointers[e.pointerId];
      if (this._painting) { const c = this._screenToCell(p.x, p.y); this._paintCell(c.gx, c.gy); return; }
      if (this._moving) {
        if (Math.abs(p.x - this._moving.sx) + Math.abs(p.y - this._moving.sy) > 4) this._moving.moved = true;
        const c = this._screenToCell(p.x, p.y);
        if (this._moving.kind === 'deco') { this._moving.gx = c.gx; this._moving.gy = c.gy; this._moving.valid = this._decoCellFree(c.gx, c.gy, this._moving.idx); }
        else if (this._moving.kind === 'plot') { this._moving.gx = c.gx; this._moving.gy = c.gy; this._moving.valid = this._cellFreeForPlotMove(c.gx, c.gy, this._moving.idx); }
        else { const o = Farm.state.data.map[this._moving.idx], b = BUILDINGS[o.type]; const gx = c.gx - (b.w >> 1), gy = c.gy - (b.h >> 1); this._moving.gx = gx; this._moving.gy = gy; this._moving.valid = this._footprintFree(gx, gy, o.type, this._moving.idx); }
        this.render(); return;
      }
      if (this._drag) {
        const dx = p.x - this._drag.x, dy = p.y - this._drag.y;
        // tap→drag 判定 6→12px（2026-07-05 UX 第 1 批 #4：手抖即判 pan →「点了没反应」）
        if (Math.abs(dx) + Math.abs(dy) > 12) { this._drag.moved = true; this._pressCell = null; this._pressBuilding = -1; }
        // 惯性采样（audit B2 P1）：EMA 平滑手指速度（px/ms），供 _up 时 glide 用
        const nowT = performance.now(), dt = nowT - this._drag.lastT;
        if (dt > 0) {
          const a = Math.min(1, dt / 40);
          this._drag.vx = this._drag.vx * (1 - a) + ((p.x - this._drag.lastX) / dt) * a;
          this._drag.vy = this._drag.vy * (1 - a) + ((p.y - this._drag.lastY) / dt) * a;
        }
        this._drag.lastX = p.x; this._drag.lastY = p.y; this._drag.lastT = nowT;
        this._camX = this._drag.camX - dx; this._camY = this._drag.camY - dy; this._clampCam(); this.render();
      }
    },
    // ===== 拖拽惯性滑行（2026-07-07 audit B2 P1：松手即停 → Hay Day 式 glide）=====
    // _move 里 EMA 采样手指速度；松手速度超阈值则按 ~0.94/16.7ms 指数衰减继续
    // 滑动，每帧过 _clampCam，撞边缘即停该轴；任何新 pointerdown 立刻接住停下。
    _glideStop() { if (this._glideRaf) { cancelAnimationFrame(this._glideRaf); this._glideRaf = null; } },
    _glideStart(drag) {
      if (!drag || !drag.moved) return;
      if (performance.now() - drag.lastT > 90) return;   // 松手前手指已停住 → 不滑
      let vx = -drag.vx, vy = -drag.vy;                  // cam 与手指位移反向
      const sp = Math.hypot(vx, vy);
      if (sp < 0.25) return;                             // 阈值：轻推不滑（防轻点误滑）
      const MAXV = 3.2;
      if (sp > MAXV) { vx *= MAXV / sp; vy *= MAXV / sp; }
      this._glideStop();
      let last = performance.now();
      const step = (now) => {
        this._glideRaf = null;
        if (!this._on) return;
        const dt = Math.min(50, now - last); last = now;
        const px = this._camX + vx * dt, py = this._camY + vy * dt;
        this._camX = px; this._camY = py; this._clampCam();
        if (Math.abs(this._camX - px) > 0.01) vx = 0;    // 撞水平边缘 → 停该轴
        if (Math.abs(this._camY - py) > 0.01) vy = 0;
        this.render();
        const decay = Math.pow(0.92, dt / 16.7);   // ~0.7s 内滑停（0.94 拖到 1.1s+，太飘）
        vx *= decay; vy *= decay;
        if (Math.hypot(vx, vy) > 0.03) this._glideRaf = requestAnimationFrame(step);
      };
      this._glideRaf = requestAnimationFrame(step);
    },
    _up(e) {
      const p = this._pointers[e.pointerId]; delete this._pointers[e.pointerId];
      if (this._pressCell || this._pressBuilding >= 0) { this._pressCell = null; this._pressBuilding = -1; this.render(); }   // 按压高亮松手即清
      const remIds = Object.keys(this._pointers);
      if (remIds.length < 2) {
        // 捏合结束还剩 1 指 → 用它当前位置重建 _drag 无缝续拖（audit B2 P2：
        // 旧逻辑只清 _pinch 不重建 _drag，剩余手指变「死指」必须全抬重按）。
        // moved 预置 true：这根手指抬起时不会被误判成 tap。直接 return——
        // 本次 up 属于旧捏合手势，后面的 tap/glide 判定都不该跑。
        if (this._pinch && remIds.length === 1) {
          const q = this._pointers[remIds[0]];
          this._pinch = null;
          this._drag = { x: q.x, y: q.y, camX: this._camX, camY: this._camY, moved: true, vx: 0, vy: 0, lastX: q.x, lastY: q.y, lastT: performance.now() };
          return;
        }
        this._pinch = null;
      }
      if (this._painting) { this._painting = false; Farm.state.save(); this._drag = null; this.render(); return; }
      if (this._moving) {
        const m = this._moving; this._moving = null;
        if (m.moved && m.valid) {
          if (m.kind === 'deco') { const d = Farm.state.data.decorations[m.idx]; if (d) { d.gx = m.gx; d.gy = m.gy; Farm.state.save(); } }
          else if (m.kind === 'plot') {
            const pl = (Farm.state.data.plots || [])[m.idx];
            if (pl) { pl.gx = m.gx; pl.gy = m.gy; this._pcs = null; this._buildLayout(); Farm.state.save(); }
          }
          else { const o = Farm.state.data.map[m.idx]; if (o) { o.gx = m.gx; o.gy = m.gy; Farm.state.save(); } }
        }
        this.render(); this._drag = null; return;
      }
      const dragEnd = this._drag, wasTap = dragEnd && !dragEnd.moved && !this._pinch; this._drag = null;
      if (!wasTap) { if (dragEnd && !this._pinch) this._glideStart(dragEnd); return; }
      if (!p) return;
      // 拜访：点成熟菜=顺，点生长中=浇水帮忙。不触发种收/建造（那些会写进伪状态）。
      if (this._visit) {
        const vhit = this._plotAtPoint(p.x, p.y);
        if (vhit) { this._visitPlotTap(vhit); return; }
        this._visitTapReact(p);
        return;
      }
      if (this._clearMode) {
        const cc = this._screenToCell(p.x, p.y);
        if (this._canClear(cc.gx, cc.gy)) { this._tryClear(cc.gx, cc.gy); return; }
        const hitPlot = this._plotAtPoint(p.x, p.y);
        if (hitPlot) { this._exitClearMode(); this._tapCell(hitPlot.gx, hitPlot.gy); return; }
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(this._lang() === 'en' ? 'Tap a glowing tile' : '点发亮的那一格开垦');
        return;
      }
      // tap the land-unlock badge → expand the farm
      if (this._landBadge && Math.hypot(p.x - this._landBadge.x, p.y - this._landBadge.y) <= this._landBadge.r) { this._tryUnlockLand(); return; }
      // 点远处邻居的小屋 → 去社区页拜访(小屋名牌是真实玩家, 2026-08-14)
      if (!this._build && this._neighborHits) {
        for (const nh of this._neighborHits) {
          if (Math.hypot(p.x - nh.x, p.y - nh.y) <= nh.r) {
            this._stickyEnd();
            // 有本尊数据的邻居 → 直接走进 TA 家(viewFarm 内部决定实景或经典面板)
            const df = this._distantFarms && this._distantFarms[this._neighborHits.indexOf(nh)];
            if (df && df._n && Farm.neighbors && Farm.neighbors.viewFarm) Farm.neighbors.viewFarm(df._n);
            else if (Farm.neighbors && Farm.neighbors.open) Farm.neighbors.open();
            return;
          }
        }
      }
      const c = this._screenToCell(p.x, p.y);
      if (this._build) { this._sel = this._buildingAt(c.gx, c.gy); this.render(); return; }
      const ps = this._petAt(p.x, p.y);   // tap a roaming pet → ❤️ + sound + hop
      if (ps != null) { this._stickyEnd(); this._pettedReact(ps, p.x, p.y); return; }
      // Depth-aware plot pick: crops are ~3 tiles TALL, so players tap the visible
      // plant (high up), not its base cell — a plain cell hit-test would land on the
      // cell BEHIND the plant. Test each plot's on-screen sprite box front-to-back
      // (frontmost = drawn last = what you actually see) so tapping a tall tomato/
      // chili harvests the right plot. Also gives empty/locked plots a forgiving box.
      const hit = this._plotAtPoint(p.x, p.y);
      if (hit) { this._tapCell(hit.gx, hit.gy); return; }
      const bidx = this._buildingAtPoint(p.x, p.y);
      if (bidx >= 0) { this._stickyEnd(); const o = Farm.state.data.map[bidx], b = BUILDINGS[o.type]; if (o.type === 'coop') { this._collectCoop(o, p); } else if (b.tap === 'home') { this._openHomePanel(bidx); } else if (b.tap === 'stall_sale' && Farm.stall) { Farm.stall.open(); } else if (b.tap === 'warehouse' && Farm.warehouse && Farm.warehouse.open) Farm.warehouse.open(); else if (b.tap === 'shop' && Farm.shop && Farm.shop.open) Farm.shop.open(); else if (Farm.ui && Farm.ui.toast) Farm.ui.toast(this._lang() === 'en' ? b.en : b.zh); return; }
      this._tapCell(c.gx, c.gy);
    },
    // Frontmost plot whose on-screen sprite box contains (px,py). Planted plots get
    // a tall box (the plant rises ~3 tiles above the base); empty/locked plots get a
    // ~1-tile box around the diamond. Front-to-back so overlapping crops pick the one
    // drawn on top.
    _plotAtPoint(px, py) {
      const plots = Farm.state.data.plots || [];
      const tw = this._tw(), th = this._th();
      const list = [];
      for (let i = 0; i < plots.length; i++) list.push({ i, gx: this._plotGX(i), gy: this._plotGY(i) });
      list.sort((a, b) => (b.gx + b.gy) - (a.gx + a.gy));   // frontmost first
      // 两段式命中（2026-07-07 audit B2 P1：成熟作物高盒吞邻格——点空地收了
      // 邻居的菜、夹在熟菜中间的空地无法点种）。
      // 第一遍：对所有地块（空/锁/已种一视同仁）做精确菱形基底测试——菱形
      // 互不重叠，点在哪块床上就是哪块，成熟邻居抢不走（0.88 缩边沿用
      // 2026-07-05 UX 第 1 批 #3；cy 下移 0.12 对齐画出的床心）。
      for (const o of list) {
        const c = this._cell(o.gx, o.gy);
        const d = Math.abs(px - c.x) / (tw / 2) + Math.abs(py - (c.y + th * 0.12)) / (th / 2);
        // 视觉床缩小后，热区略大于格子，缝里点也能点中，前排优先
        if (d <= 1.06) return o;
      }
      // 第二遍：无基底命中时才用高盒接住「点在植株上半身」的 tap（植株高出
      // 基底 ~3 格）。盒宽收窄到苗床宽（±BED_W/2，was ±0.5 满格），盒底裁到
      // 自身菱形下缘（c.y+th*0.56，was 0.65）——不再向下/向旁侵占邻格基底。
      for (const o of list) {
        const c = this._cell(o.gx, o.gy), pl = plots[o.i];
        if (!(pl && pl.unlocked && pl.crop)) continue;
        const p = Farm.crops.getProgress ? Farm.crops.getProgress(pl) : 1;
        const fr = p >= 1 ? 3 : p >= 0.6 ? 2 : p >= 0.25 ? 1 : 0;
        const top = c.y - th * (0.7 + fr * 0.6), halfW = tw * (BED_W / 2), bot = c.y + th * 0.56;
        if (px >= c.x - halfW && px <= c.x + halfW && py >= top && py <= bot) return o;
      }
      return null;
    },
    _wheel(e) { e.preventDefault(); const p = this._local(e); this._zoomAt(p.x, p.y, this._zoom * (e.deltaY < 0 ? 1.12 : 0.89)); },
    // 粘性连续种植的退出点（UX 第 2 批 #2）：tap 到任何「非空地」目标都静默退出
    _stickyEnd() { if (Farm.shop && Farm.shop.stickyEnd) Farm.shop.stickyEnd(); },
    _tapCell(gx, gy) {
      const idx = this._cellToPlot[gx + ',' + gy]; if (idx == null) { this._stickyEnd(); return; }
      const plot = Farm.state.data.plots[idx];
      if (!plot || !plot.unlocked) {
        this._stickyEnd();
        const lvl = REQUIRED_LV[idx] || 2;
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(Farm.i18n ? Farm.i18n.t('plot_locked_hint_template', { n: lvl }) : ('Lv ' + lvl + ' 解锁'));
        return;
      }
      if (!plot.crop) {
        // 粘性种子激活时直接种同款（不弹选种器）；未激活走原选种器流程
        if (Farm.shop.stickyPlant && Farm.shop.stickyPlant(idx)) { this.render(); return; }
        // 收获后 400ms 内快速连点同一格 → 忽略，不立弹选种器打断连续扫收
        // （audit B2 P2；粘性连种在上面已提前返回，不受影响）
        const jh = this._justHarvested;
        if (jh && jh.idx === idx && Date.now() - jh.t < 400) return;
        Farm.shop.openSeedPickerForPlot(idx);
        return;
      }
      this._stickyEnd();
      if (Farm.crops.isMature(plot)) { this._justHarvested = { idx, t: Date.now() }; Farm.farm.harvestPlot(idx, this._fakeEvt(gx, gy)); setTimeout(() => this.render(), 50); return; }
      Farm.farm.openPlotCare(idx, plot, Farm.crops.get(plot.crop));
    },
    _fakeEvt(gx, gy) {
      const c = this._cell(gx, gy), r = this._cv.getBoundingClientRect(), th = this._th();
      const rect = { left: r.left + c.x - 10, top: r.top + c.y - th, width: 20, height: th };
      return { target: { getBoundingClientRect: () => rect } };
    },

    // ===== spotlight 新手引导用的屏幕矩形（CSS px，含相机/缩放）=====
    // spotlight.js 在 iso 视图下用这两个 API 定位「点这块地」「点谷仓」，
    // 不再因 canvas 无 DOM 而整段跳过手把手引导（2026-07-02 移植）。
    plotScreenRect(idx) {
      if (!this._on || !this._cv) return null;
      const p = (Farm.state.data.plots || [])[idx];
      if (!p) return null;
      const c = this._cell(this._plotGX(idx), this._plotGY(idx));
      const r = this._cv.getBoundingClientRect();
      const tw = this._tw(), th = this._th();
      // 空地用贴床矮盒（audit B2 P2：旧统一高盒让聚光灯洞 60% 罩在空草地上，
      // 「点这块发光的地」指向含糊）；有作物才用罩住整棵植株的高盒。
      // 高 1.05th 正好罩住这块菱形床（2026-08-15：原 1.4th 会把前一块锁定地的 🔒 徽章
      // 也框进「点这块发光的地」的洞里，新手看着像是要点那把锁）
      if (!p.crop) return { left: r.left + c.x - tw / 2, top: r.top + c.y - th * 0.52, width: tw, height: th * 1.05 };
      return { left: r.left + c.x - tw / 2, top: r.top + c.y - th * 1.6, width: tw, height: th * 2.2 };
    },
    barnScreenRect() {
      if (!this._on || !this._cv) return null;
      const map = Farm.state.data.map || [];
      const o = map.find(m => m && m.type === 'barn');
      if (!o) return null;
      const b = BUILDINGS.barn;
      const tw = this._tw(), th = this._th();
      // 与 _drawBuilding / _blit 同一套盒子：底边 by、最大宽高按 BLD 缩、再按贴图长宽比收
      //（2026-08-15 之前用 tw*sc 的近似方盒，比真实谷仓高出一倍多，聚光灯洞大半罩着
      // 谷仓上方的空草地和锁定地块，「点谷仓」指向不清）
      const cc = this._cell(o.gx + (b.w - 1) / 2, o.gy + (b.h - 1) / 2);
      const front = this._cell(o.gx + (b.w - 1), o.gy + (b.h - 1));
      const by = front.y + th / 2 + th * 0.18;
      let w = b.w * tw * 0.92 * BLD, h = b.sc * th * 2.2 * BLD;
      const im = this._img[b.img];
      if (im && im.width && im.height) { const sc = Math.min(w / im.width, h / im.height); w = im.width * sc; h = im.height * sc; }
      const r = this._cv.getBoundingClientRect();
      const pad = th * 0.15;
      return { left: r.left + cc.x - w / 2 - pad, top: r.top + by - h - pad, width: w + pad * 2, height: h + pad * 2 };
    },

    // ===== editor (build / terrain / decoration), iso-aware =====
    _terrain() { return (Farm.state.data.mapTerrain = Farm.state.data.mapTerrain || {}); },
    _plotCellSet() {
      const plots = Farm.state.data.plots || [];
      if (this._pcs && this._pcsN === plots.length) return this._pcs;   // cache; rebuild only when a plot unlocks
      const s = {};
      for (let i = 0; i < plots.length; i++) s[this._plotGX(i) + ',' + this._plotGY(i)] = 1;
      this._pcs = s; this._pcsN = plots.length;
      return s;
    },
    _shopItem(itemId) {   // index EP-shop items once instead of .find scanning every frame
      if (!this._itemIndex && Farm.epShop && Farm.epShop.items && Farm.epShop.items.length) {
        this._itemIndex = {}; Farm.epShop.items.forEach((it) => { this._itemIndex[it.id] = it; });
      }
      return this._itemIndex ? this._itemIndex[itemId] : null;
    },
    _inBounds(gx, gy) { return gx >= 0 && gy >= 0 && gx < COLS && gy < ROWS; },
    _landLevel() { const t = this._landTable(); return Math.max(0, Math.min(t.length - 1, (Farm.state.data && Farm.state.data.landLevel) | 0)); },
    _ownedBounds() { return this._landTable()[this._landLevel()]; },
    _ownedCell(gx, gy) {
      const o = this._ownedBounds();
      if (gx >= o.x1 && gx <= o.x2 && gy >= o.y1 && gy <= o.y2) return true;
      return !!(Farm.state.data && Farm.state.data.clearedCells && Farm.state.data.clearedCells[gx + ',' + gy]);
    },
    _nextLand() { const t = this._landTable(), lv = this._landLevel(); return lv + 1 < t.length ? t[lv + 1] : null; },
    _footprintFree(gx, gy, type, exceptIdx) {
      const b = BUILDINGS[type];
      if (gx < 0 || gy < 0 || gx + b.w > COLS || gy + b.h > ROWS) return false;
      const plotCells = this._plotCellSet(), occ = {}, map = (Farm.state.data.map) || [], t = this._terrain();
      for (let i = 0; i < map.length; i++) { if (i === exceptIdx) continue; const o = map[i], ob = BUILDINGS[o.type]; if (!ob) continue; for (let y = 0; y < ob.h; y++) for (let x = 0; x < ob.w; x++) occ[(o.gx + x) + ',' + (o.gy + y)] = 1; }
      for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
        const k = (gx + x) + ',' + (gy + y);
        if (!this._ownedCell(gx + x, gy + y) || plotCells[k] || occ[k] || t[k] === 'water') return false;
        if (this._onRoad(gx + x, gy + y)) return false;
        // 🔒 全局互斥（2026-08-13 Chris:「所有建造物默认不可重叠」）——装饰摆件
        // 占的格建筑也不能压。此前四类放置里唯独漏了「别人检查装饰」这半边。
        if (this._decoAt(gx + x, gy + y) >= 0) return false;
      }
      return true;
    },
    _buildingAt(gx, gy) {
      const map = (Farm.state.data.map) || []; let best = -1, bg = -1;
      for (let i = 0; i < map.length; i++) { const o = map[i], b = BUILDINGS[o.type]; if (!b) continue; if (gx >= o.gx && gx < o.gx + b.w && gy >= o.gy && gy < o.gy + b.h && o.gy >= bg) { best = i; bg = o.gy; } }
      return best;
    },
    // Frontmost building whose ACTUAL drawn sprite box contains (px,py). Buildings
    // are very tall (roofs rise far above the footprint), so a cell hit-test misses
    // roof taps. Mirrors _drawBuilding's anchor + _blit's fit math for an exact box.
    _buildingAtPoint(px, py) {
      const map = (Farm.state.data.map) || [], tw = this._tw(), th = this._th();
      const list = [];
      for (let i = 0; i < map.length; i++) { const b = BUILDINGS[map[i].type]; if (b) list.push({ o: map[i], i, b }); }
      list.sort((a, c) => (c.o.gx + c.b.w + c.o.gy + c.b.h) - (a.o.gx + a.b.w + a.o.gy + a.b.h));   // frontmost first
      for (const { o, i, b } of list) {
        const cc = this._cell(o.gx + (b.w - 1) / 2, o.gy + (b.h - 1) / 2);
        const front = this._cell(o.gx + (b.w - 1), o.gy + (b.h - 1));
        const by = front.y + th / 2 + th * 0.18;
        const hz = o.type === 'home' ? this._homeDrawMul(o) : 1;
        const im = o.type === 'home' ? this._homeSprite(o) : this._img[b.img]; let w, h;
        if (im && im.width) { const s = Math.min(b.w * tw * 0.92 * BLD * hz / im.width, b.sc * th * 2.2 * BLD * hz / im.height); w = im.width * s; h = im.height * s; }
        else { w = b.w * tw * 1.06 * BLD * hz; h = b.sc * th * 2.0 * BLD * hz; }
        if (px >= cc.x - w / 2 && px <= cc.x + w / 2 && py >= by - h && py <= by) return i;
      }
      const cell = this._screenToCell(px, py);
      return this._buildingAt(cell.gx, cell.gy);
    },
    _decoAt(gx, gy) { const d = (Farm.state.data.decorations) || []; for (let i = 0; i < d.length; i++) if (d[i].gx === gx && d[i].gy === gy) return i; return -1; },
    // Nearest decoration to a tap, by on-screen distance (generous radius) — small
    // deco/pet sprites are hard to hit dead-center on a phone in build mode.
    _decoAtPoint(px, py) {
      const d = (Farm.state.data.decorations) || [], tw = this._tw(), th = this._th();
      let best = -1, bd = Infinity; const reach = tw * 0.85;
      for (let i = 0; i < d.length; i++) {
        if (!Number.isInteger(d[i].gx) || !Number.isInteger(d[i].gy)) continue;
        const c = this._cell(d[i].gx, d[i].gy), dist = Math.hypot(px - c.x, py - (c.y - th * 0.5));
        if (dist < bd) { bd = dist; best = i; }
      }
      return bd <= reach ? best : -1;
    },
    _decoCellFree(gx, gy, exceptIdx) {
      if (!this._inBounds(gx, gy)) return false;
      if (this._onRoad(gx, gy)) return false;
      if (this._plotCellSet()[gx + ',' + gy] || this._terrain()[gx + ',' + gy] === 'water' || this._buildingAt(gx, gy) >= 0) return false;
      const d = (Farm.state.data.decorations) || []; for (let i = 0; i < d.length; i++) if (i !== exceptIdx && d[i].gx === gx && d[i].gy === gy) return false;
      return true;
    },
    /* 🔒「这格不能建」的唯一视觉语言（2026-08-13 Chris:「不用提示文字，
       移到不可用的位置就出现红色 X 就好」）。红底 + 白叉画在格子中心，
       建筑拖动 / 摆件拖动 / 水笔刷三处共用这一个画法，别再各写各的。
       画在格子上而不是弹 toast —— 手指正按在那儿，反馈就该出现在那儿。 */
    _drawBlockedX(cx, cy) {
      const ctx = this._ctx, th = this._th();
      const r = Math.max(9, th * 0.42);
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283);
      ctx.fillStyle = 'rgba(214,48,48,0.94)'; ctx.fill();
      ctx.lineWidth = Math.max(1.5, r * 0.16); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
      const a = r * 0.46;
      ctx.beginPath();
      ctx.moveTo(cx - a, cy - a); ctx.lineTo(cx + a, cy + a);
      ctx.moveTo(cx + a, cy - a); ctx.lineTo(cx - a, cy + a);
      ctx.lineWidth = Math.max(2, r * 0.24); ctx.lineCap = 'round';
      ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.restore();
    },

    /* 我的家面板: 当前级名 + 魅力 + 下一级预览与升级按钮。
       升级 = 变美(手绘加装逐级出现) + 魅力涨, 是金币的长期出口。 */
    _homeSpec(o) {
      const n = HOME_LEVELS.length;
      const lv = Math.min(Math.max((o && o.lv) || 1, 1), n);
      return HOME_LEVELS[lv - 1];
    },
    _homes() {
      return ((Farm.state.data && Farm.state.data.map) || []).filter((m) => m && m.type === 'home');
    },
    // fromId 有值 = 改建补差价；null = 另建付全价（不低于落成价）。
    _homePay(fromId, toId) {
      const n = HOME_LEVELS.length;
      const to = HOME_LEVELS[Math.min(Math.max(toId || 1, 1), n) - 1];
      const place = BUILDINGS.home.cost || 300;
      if (fromId == null) {
        return { coins: Math.max(place, to.cost || 0), points: to.points || 0 };
      }
      const from = HOME_LEVELS[Math.min(Math.max(fromId || 1, 1), n) - 1];
      return {
        coins: Math.max(0, (to.cost || 0) - (from.cost || 0)),
        points: Math.max(0, (to.points || 0) - (from.points || 0)),
      };
    },
    _spendHomePay(pay, desc) {
      const en = this._lang() === 'en';
      const needPts = pay.points || 0;
      const loggedIn = !!(Farm.fbAuth && Farm.fbAuth.isLoggedIn && Farm.fbAuth.isLoggedIn());
      if (needPts) {
        if (!loggedIn) {
          if (Farm.ui.toast) Farm.ui.toast(en ? 'Mansions use store points. Sign in first.' : '豪宅要用超市积分，请先登录。');
          return false;
        }
        if ((Farm.state.data.eastPoints || 0) < needPts) {
          if (Farm.ui.toast) Farm.ui.toast(en ? 'Not enough store points' : '超市积分不足');
          return false;
        }
      }
      if (pay.coins > 0 && !Farm.state.spendCoins(pay.coins)) {
        if (Farm.ui.toast) Farm.ui.toast(en ? 'Not enough coins' : '农场币不足');
        return false;
      }
      if (needPts && !Farm.state.spendEastPoints(needPts, {
        source: 'ep_shop:home_mansion',
        description: desc,
      })) {
        if (pay.coins > 0) Farm.state.addCoins(pay.coins);
        if (Farm.ui.toast) Farm.ui.toast(en ? 'Not enough store points' : '超市积分不足');
        return false;
      }
      return true;
    },
    _focusHome(o) {
      const hb = BUILDINGS.home;
      const hc = this._cell(o.gx + (hb.w - 1) / 2, o.gy + (hb.h - 1) / 2);
      this._camX += hc.x - this._cssW() / 2;
      this._camY += hc.y - this._cssH() * 0.55;
      this._clampCam();
      this.render();
    },
    _homeSprite(o) {
      const spec = this._homeSpec(o);
      const im = this._img[spec.stem];
      if (im instanceof Image) return im;
      return this._lazyImg(spec.stem);
    },
    _homeDrawMul(o) {
      return (this._homeSpec(o).draw) || 1;
    },
    _homeStemUrl(stem) {
      return ASSET_DIR + (stem || 'p_house') + '.webp';
    },
    // 章节目标按造价档，不按图册序号（石墙农舍 id=9 不能算作东方庄园）。
    _homeTier(o) {
      const c = (this._homeSpec(o).cost || 0);
      if (c >= 60000) return 8;
      if (c >= 36000) return 7;
      if (c >= 20000) return 6;
      if (c >= 12000) return 5;
      if (c >= 6000) return 4;
      if (c >= 3000) return 3;
      if (c >= 1200) return 2;
      return 1;
    },
    _homeFace(stem, px) {
      return '<img src="' + this._homeStemUrl(stem)
        + '" alt="" style="width:' + px + 'px;height:' + px + 'px;object-fit:contain;'
        + 'filter:drop-shadow(0 3px 4px rgba(60,35,15,.2));"/>';
    },
    _homeIdsInCat(catId) {
      const ids = [];
      HOME_LEVELS.forEach((h, i) => { if (h.cat === catId) ids.push(i + 1); });
      ids.sort((a, b) => (HOME_LEVELS[a - 1].cost || 0) - (HOME_LEVELS[b - 1].cost || 0));
      return ids;
    },
    _homeCatCardsHtml(en, hereId) {
      const here = hereId ? HOME_LEVELS[hereId - 1] : null;
      let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
      HOME_CATS.forEach((c) => {
        const ids = this._homeIdsInCat(c.id);
        const on = !!(here && here.cat === c.id);
        let lo = Infinity, hi = 0;
        ids.forEach((id) => {
          const p = this._homePay(null, id).coins;
          if (p < lo) lo = p;
          if (p > hi) hi = p;
        });
        const range = !ids.length ? '' : (lo === hi ? lo.toLocaleString() : (lo.toLocaleString() + ' – ' + hi.toLocaleString()));
        html += '<button type="button" data-home-cat="' + c.id + '" style="border:1.5px solid '
          + (on ? 'var(--leaf-dark,#3a8c50)' : '#e8e0d4')
          + ';border-radius:14px;padding:10px 8px 12px;background:' + (on ? '#f4faf4' : '#fff')
          + ';text-align:center;cursor:pointer;font:inherit;color:inherit;">'
          + this._homeFace(c.face, 88)
          + '<div style="font-family:var(--font-display);font-size:18px;margin-top:4px;">'
          + (en ? c.en : c.zh) + '</div>'
          + '<div style="font-size:12px;color:var(--warm-text-soft);margin-top:3px;">'
          + ids.length + (en ? ' homes' : ' 款') + '</div>'
          + '<div style="font-size:12px;color:var(--warm-text-soft);margin-top:2px;">'
          + range + ' <span class="coin-icon"></span></div></button>';
      });
      return html + '</div>';
    },
    _homeGridHtml(en, fromId, catId, hereId) {
      const coins = Farm.state.data.coins || 0;
      const pts = Farm.state.data.eastPoints || 0;
      const loggedIn = !!(Farm.fbAuth && Farm.fbAuth.isLoggedIn && Farm.fbAuth.isLoggedIn());
      const ids = this._homeIdsInCat(catId);
      let html = '<div style="max-height:46vh;overflow-y:auto;display:grid;grid-template-columns:1fr 1fr;gap:8px;">';
      ids.forEach((id) => {
        const h = HOME_LEVELS[id - 1];
        const here = hereId === id;
        const payAmt = this._homePay(fromId, id);
        const rich = coins >= payAmt.coins && (!payAmt.points || (loggedIn && pts >= payAmt.points));
        const tag = h.mansion ? (en ? 'Mansion' : '豪宅') : '';
        let action;
        if (here) {
          action = '<div style="font-size:12px;color:var(--leaf-dark);">' + (en ? 'This house' : '就是这栋') + '</div>';
        } else {
          const price = (!payAmt.coins && !payAmt.points)
            ? (en ? 'Switch' : '换成这款')
            : ((payAmt.coins ? (payAmt.coins.toLocaleString() + ' <span class="coin-icon"></span>') : '')
              + (payAmt.points ? ((payAmt.coins ? ' + ' : '') + payAmt.points + ' <span class="points-icon"></span>') : ''));
          action = '<button class="btn' + (rich ? '' : ' secondary') + '" data-home-id="' + id + '" style="width:100%;padding:6px 8px;font-size:13px;"'
            + (rich ? '' : ' disabled') + '>' + price + '</button>';
        }
        html += '<div style="border:1.5px solid ' + (here ? 'var(--leaf-dark,#3a8c50)' : '#e8e0d4')
          + ';border-radius:12px;padding:8px 8px 10px;background:' + (here ? '#f4faf4' : '#fff') + ';text-align:center;">'
          + this._homeFace(h.stem, 72)
          + '<div style="font-size:13px;font-weight:600;margin-top:4px;">' + (en ? h.en : h.zh) + '</div>'
          + (tag ? '<div style="font-size:11px;color:#b45309;">' + tag + '</div>' : '')
          + '<div style="font-size:11px;color:var(--warm-text-soft);margin:2px 0 6px;">'
          + (en ? 'Charm' : '魅力') + ' +' + h.charm + '</div>'
          + action + '</div>';
      });
      return html + '</div>';
    },

    collectHomeUpkeep() {
      const d = Farm.state && Farm.state.data;
      if (!d || Farm.state._visitLock) return;
      const homes = this._homes();
      if (!homes.length) return;
      let fee = 0;
      homes.forEach((o) => { fee += (this._homeSpec(o).upkeep || 0); });
      const today = Farm.state.getDateString();
      const en = this._lang() === 'en';
      if (d.homeUpkeepOn === today && !d.homeNeglected) return;
      if (fee <= 0) {
        d.homeUpkeepOn = today;
        d.homeNeglected = false;
        Farm.state.save();
        return;
      }
      if ((d.coins || 0) >= fee && Farm.state.spendCoins(fee)) {
        d.homeUpkeepOn = today;
        d.homeNeglected = false;
        Farm.state.save();
        if (this._refreshPaletteCosts) this._refreshPaletteCosts();
        return;
      }
      if (!d.homeNeglected) {
        d.homeNeglected = true;
        Farm.state.save();
        if (Farm.ui && Farm.ui.toast) {
          Farm.ui.toast(en ? 'House upkeep skipped today.' : '今天房子先将就着。', 2200);
        }
      }
    },

    _buyHome(mapIdx, houseId) {
      const o = (Farm.state.data.map || [])[mapIdx];
      const spec = HOME_LEVELS[houseId - 1];
      if (!o || o.type !== 'home' || !spec) return;
      if ((o.lv || 1) === houseId) return;
      const pay = this._homePay(o.lv || 1, houseId);
      if (!this._spendHomePay(pay, '改建：' + spec.zh + ' / Remodel: ' + spec.en)) return;
      o.lv = houseId;
      Farm.state.data.homeUpkeepOn = Farm.state.getDateString();
      Farm.state.data.homeNeglected = false;
      if (Farm.lifeStory && Farm.lifeStory.record) {
        Farm.lifeStory.record('homeid_' + houseId,
          '家换成了：' + spec.zh + '。',
          'Moved into ' + spec.en + '.');
      }
      Farm.state.save();
      if (Farm.audio) Farm.audio.play('achievement');
      if (Farm.ui.refreshHUD) Farm.ui.refreshHUD();
      if (Farm.ui.confettiBurst) Farm.ui.confettiBurst();
      this._focusHome(o);
      this._openHomePanel(mapIdx, spec.cat);
    },

    _findHomeSpot() {
      const b = BUILDINGS.home;
      const ctr = this._screenToCell(this._cssW() / 2, this._cssH() / 2);
      const c0x = ctr.gx - (b.w >> 1), c0y = ctr.gy - (b.h >> 1);
      const tries = [[c0x, c0y]];
      for (let gy = 0; gy + b.h <= ROWS; gy++) for (let gx = 0; gx + b.w <= COLS; gx++) tries.push([gx, gy]);
      tries.sort((p1, p2) => (Math.abs(p1[0] - c0x) + Math.abs(p1[1] - c0y)) - (Math.abs(p2[0] - c0x) + Math.abs(p2[1] - c0y)));
      for (const [gx, gy] of tries) if (this._footprintFree(gx, gy, 'home', -1)) return { gx, gy };
      return null;
    },
    _placeNewHome(houseId) {
      const spec = HOME_LEVELS[houseId - 1];
      const en = this._lang() === 'en';
      if (!spec) return;
      if (this._homes().length >= HOME_CAP) {
        if (Farm.ui.toast) Farm.ui.toast(en ? 'House limit reached. Tap a house to remodel.' : '房子已经建满。点现有的房子可以改建。');
        return;
      }
      const spot = this._findHomeSpot();
      if (!spot) {
        if (Farm.ui.toast) Farm.ui.toast(en ? 'No room' : '没有空位了');
        return;
      }
      const pay = this._homePay(null, houseId);
      if (!this._spendHomePay(pay, '建房：' + spec.zh + ' / Build: ' + spec.en)) return;
      const rec = { type: 'home', gx: spot.gx, gy: spot.gy, lv: houseId };
      (Farm.state.data.map = Farm.state.data.map || []).push(rec);
      Farm.state.data.homeUpkeepOn = Farm.state.getDateString();
      Farm.state.data.homeNeglected = false;
      if (Farm.lifeStory && Farm.lifeStory.record) {
        Farm.lifeStory.record('homeid_' + houseId,
          '新盖了一座：' + spec.zh + '。',
          'Built a new ' + spec.en + '.');
      }
      Farm.state.save();
      if (Farm.audio) Farm.audio.play('achievement');
      if (Farm.ui.refreshHUD) Farm.ui.refreshHUD();
      if (Farm.ui.confettiBurst) Farm.ui.confettiBurst();
      this._refreshPaletteAfford();
      this._focusHome(rec);
      this._openHomePanel(Farm.state.data.map.indexOf(rec), spec.cat);
    },

    _openHomePanel(idx, cat) {
      const o = (Farm.state.data.map || [])[idx];
      if (!o || o.type !== 'home' || !(Farm.ui && Farm.ui.showModal)) return;
      this.collectHomeUpkeep();
      const en = this._lang() === 'en';
      const neglected = !!(Farm.state.data && Farm.state.data.homeNeglected);
      const curId = Math.min(Math.max(o.lv || 1, 1), HOME_LEVELS.length);
      const cur = HOME_LEVELS[curId - 1];
      const catDef = cat && HOME_CATS.find((c) => c.id === cat);
      let body = '<div style="text-align:center;line-height:1;">' + this._homeFace(cur.stem, 120) + '</div>'
        + '<div style="text-align:center;font-family:var(--font-display);font-size:20px;margin-top:6px;">'
        + (en ? cur.en : cur.zh) + '</div>'
        + '<div style="text-align:center;font-size:12.5px;color:var(--warm-text-soft);margin-top:4px;">'
        + (en ? 'Charm' : '魅力') + ' +' + (neglected ? Math.floor(cur.charm / 2) : cur.charm)
        + '</div>'
        + (neglected
          ? '<button class="btn secondary" id="homePayUpkeep" style="width:100%;margin-top:8px;">'
            + (en ? ('Tend house · ' + (cur.upkeep || 0)) : ('打理一下 · ' + (cur.upkeep || 0)))
            + ' <span class="coin-icon"></span></button>'
          : '');
      if (!catDef) {
        body += '<div style="margin:12px 0 8px;font-size:13px;font-weight:600;">'
          + (en ? 'Choose a type' : '选一类房子') + '</div>'
          + this._homeCatCardsHtml(en, curId);
      } else {
        body += '<div style="margin:12px 0 8px;display:flex;align-items:center;justify-content:space-between;">'
          + '<button type="button" id="homeCatBack" class="btn secondary" style="padding:4px 10px;font-size:13px;">'
          + (en ? 'Types' : '返回分类') + '</button>'
          + '<div style="font-size:13px;font-weight:600;">' + (en ? catDef.en : catDef.zh) + '</div>'
          + '<span style="width:72px;"></span></div>'
          + this._homeGridHtml(en, curId, cat, curId);
      }
      body += '<div class="btn-row" style="margin-top:12px;"><button class="btn secondary" onclick="Farm.ui.hideModal()" style="width:100%;">'
        + (en ? 'Close' : '关闭') + '</button></div>';
      Farm.ui.showModal('<h2 class="modal-title">' + (en ? 'My Home' : '我的家') + '</h2>' + body);
      const self = this;
      document.querySelectorAll('[data-home-cat]').forEach((btn) => {
        btn.onclick = () => self._openHomePanel(idx, btn.getAttribute('data-home-cat'));
      });
      document.querySelectorAll('[data-home-id]').forEach((btn) => {
        btn.onclick = () => self._buyHome(idx, parseInt(btn.getAttribute('data-home-id'), 10));
      });
      const back = document.getElementById('homeCatBack');
      if (back) back.onclick = () => self._openHomePanel(idx);
      const pay = document.getElementById('homePayUpkeep');
      if (pay) pay.onclick = () => { self.collectHomeUpkeep(); self._openHomePanel(idx, cat); };
    },

    _openNewHomePanel(cat) {
      if (!(Farm.ui && Farm.ui.showModal)) return;
      const en = this._lang() === 'en';
      const catDef = cat && HOME_CATS.find((c) => c.id === cat);
      let body = '<div style="margin:0 0 8px;font-size:13px;color:var(--warm-text-soft);">'
        + (en ? 'A new house costs the full catalog price. Remodel an existing one to pay only the difference.' : '新盖一座按图册全价。点场上已有的房子改建，只补差价。') + '</div>';
      if (!catDef) {
        body += this._homeCatCardsHtml(en, 0);
      } else {
        body += '<div style="margin:0 0 8px;display:flex;align-items:center;justify-content:space-between;">'
          + '<button type="button" id="homeCatBack" class="btn secondary" style="padding:4px 10px;font-size:13px;">'
          + (en ? 'Types' : '返回分类') + '</button>'
          + '<div style="font-size:13px;font-weight:600;">' + (en ? catDef.en : catDef.zh) + '</div>'
          + '<span style="width:72px;"></span></div>'
          + this._homeGridHtml(en, null, cat, 0).replace(/data-home-id="/g, 'data-new-home-id="');
      }
      body += '<div class="btn-row" style="margin-top:12px;"><button class="btn secondary" onclick="Farm.ui.hideModal()" style="width:100%;">'
        + (en ? 'Close' : '关闭') + '</button></div>';
      Farm.ui.showModal('<h2 class="modal-title">' + (en ? 'Build another house' : '再建一座') + '</h2>' + body);
      const self = this;
      document.querySelectorAll('[data-home-cat]').forEach((btn) => {
        btn.onclick = () => self._openNewHomePanel(btn.getAttribute('data-home-cat'));
      });
      document.querySelectorAll('[data-new-home-id]').forEach((btn) => {
        btn.onclick = () => self._placeNewHome(parseInt(btn.getAttribute('data-new-home-id'), 10));
      });
      const back = document.getElementById('homeCatBack');
      if (back) back.onclick = () => self._openNewHomePanel();
    },

    /* 我的家逐级手绘加装(2026-08-14)。只有一张房子贴图, 分级视觉全靠这里 ——
       与水塘同一套「手绘工艺」。坐标以 _blit 的实际绘制盒为基准(cx 居中, by 底边):
       Lv2 门前花坛 · Lv3 暖窗灯+炊烟(动) · Lv4 屋檐彩旗 · Lv5 金色灯串(闪)+光晕。 */
    _drawHomeExtras(cx, by, boxW, boxH, lv) {
      const ctx = this._ctx, t = Date.now() / 1000;
      const im = this._img.house;
      // _blit 的等比缩放: 实际画出的宽高
      let w = boxW, h = boxH;
      if (im && im.width) { const sc = Math.min(boxW / im.width, boxH / im.height); w = im.width * sc; h = im.height * sc; }
      ctx.save();
      if (lv >= 5) {   // 光晕垫底, 别盖过别的元素
        const g = ctx.createRadialGradient(cx, by - h * 0.42, h * 0.1, cx, by - h * 0.42, h * 0.75);
        g.addColorStop(0, 'rgba(255,214,120,0.20)'); g.addColorStop(1, 'rgba(255,214,120,0)');
        ctx.fillStyle = g; ctx.fillRect(cx - w, by - h * 1.25, w * 2, h * 1.5);
      }
      if (lv >= 2) {   // 门前花坛: 一条绿带 + 三色小花
        const fy = by - h * 0.02, fw = w * 0.34;
        ctx.fillStyle = '#5d9e46';
        ctx.beginPath(); ctx.ellipse(cx - w * 0.22, fy, fw / 2, h * 0.035, -0.18, 0, 6.283); ctx.fill();
        const cols = ['#e86aa2', '#f6c445', '#ff8a5c'];
        for (let i = 0; i < 5; i++) {
          ctx.fillStyle = cols[i % 3];
          ctx.beginPath();
          ctx.arc(cx - w * 0.22 + (i - 2) * fw * 0.17, fy - h * 0.028 - (i % 2) * h * 0.012, Math.max(1.6, w * 0.016), 0, 6.283);
          ctx.fill();
        }
      }
      if (lv >= 3) {   // 暖窗灯 + 炊烟(缓慢上升的三团)
        ctx.fillStyle = 'rgba(255,208,110,0.55)';
        ctx.beginPath(); ctx.ellipse(cx + w * 0.16, by - h * 0.30, w * 0.075, h * 0.055, 0, 0, 6.283); ctx.fill();
        for (let i = 0; i < 3; i++) {
          const ph = ((t * 0.35 + i * 0.33) % 1);
          const sx = cx - w * 0.255 + Math.sin(ph * 6.28 + i) * w * 0.03;
          const sy = by - h * (0.92 + ph * 0.30);
          ctx.fillStyle = 'rgba(240,240,238,' + (0.38 * (1 - ph)) + ')';
          ctx.beginPath(); ctx.arc(sx, sy, w * (0.022 + ph * 0.030), 0, 6.283); ctx.fill();
        }
      }
      if (lv >= 4) {   // 屋檐彩旗: 一条微垂的绳 + 小三角旗
        const x1 = cx - w * 0.36, y1 = by - h * 0.58, x2 = cx + w * 0.36, y2 = by - h * 0.63;
        ctx.strokeStyle = 'rgba(120,90,60,0.8)'; ctx.lineWidth = Math.max(0.8, w * 0.006);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, y1 + h * 0.07, x2, y2); ctx.stroke();
        const cols = ['#e85d5d', '#f6c445', '#5aa0c8', '#6ab04c'];
        for (let i = 1; i <= 6; i++) {
          const q = i / 7, mx = (1 - q) * (1 - q) * x1 + 2 * (1 - q) * q * cx + q * q * x2;
          const my = (1 - q) * (1 - q) * y1 + 2 * (1 - q) * q * (y1 + h * 0.07) + q * q * y2;
          ctx.fillStyle = cols[i % 4];
          ctx.beginPath(); ctx.moveTo(mx - w * 0.022, my); ctx.lineTo(mx + w * 0.022, my); ctx.lineTo(mx, my + h * 0.042); ctx.closePath(); ctx.fill();
        }
      }
      if (lv >= 5) {   // 金色灯串: 沿屋檐一排小灯, 相位交替微闪
        for (let i = 0; i < 7; i++) {
          const q = (i + 0.5) / 7;
          const lx = cx - w * 0.36 + q * w * 0.72;
          const ly = by - h * (0.67 - Math.abs(q - 0.5) * 0.09);
          const tw2 = 0.55 + 0.45 * Math.sin(t * 2.2 + i * 1.7);
          ctx.fillStyle = 'rgba(255,214,110,' + (0.45 + 0.4 * tw2) + ')';
          ctx.beginPath(); ctx.arc(lx, ly, Math.max(1.4, w * 0.014) * (1 + tw2 * 0.3), 0, 6.283); ctx.fill();
        }
      }
      ctx.restore();
    },

    /* 种子店招牌(2026-08-14): 摊位贴图自带一块空白招牌(雨棚下方偏左),
       把「种子」写上去 —— 招牌是最强的「这是商店」信号, 也点明卖什么。
       位置按贴图比例手调(截图校准), 字随建筑一起缩放。 */
    _drawShopSign(cx, by, boxW, boxH) {
      const ctx = this._ctx, im = this._img.stall;
      let w = boxW, h = boxH;
      if (im && im.width) { const sc = Math.min(boxW / im.width, boxH / im.height); w = im.width * sc; h = im.height * sc; }
      const fs = Math.max(6, h * 0.062);
      if (fs < 7) return;   // 缩得太小就别画了, 糊成一团反而脏
      ctx.save();
      const en = this._lang() === 'en';
      const txt = en ? 'FRESH' : '菜摊';
      // 木牌底 + 字: 贴图上那块板离菜筐太近, 裸写字会压在菜叶花色上读不清 ——
      // 自己垫一块奶油底小木牌(截图校准过位置), 任何背景下都清楚。
      ctx.translate(cx - w * 0.075, by - h * 0.487);
      ctx.transform(1, 0.055, 0, 1, 0, 0);   // 微剪切贴合等距透视
      ctx.font = '400 ' + fs + 'px "ZCOOL XiaoWei","Noto Sans SC",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw2 = ctx.measureText(txt).width;
      const pw2 = tw2 + fs * 0.9, ph2 = fs * 1.45, r2 = fs * 0.28;
      ctx.beginPath();
      ctx.moveTo(-pw2 / 2 + r2, -ph2 / 2);
      ctx.arcTo(pw2 / 2, -ph2 / 2, pw2 / 2, ph2 / 2, r2);
      ctx.arcTo(pw2 / 2, ph2 / 2, -pw2 / 2, ph2 / 2, r2);
      ctx.arcTo(-pw2 / 2, ph2 / 2, -pw2 / 2, -ph2 / 2, r2);
      ctx.arcTo(-pw2 / 2, -ph2 / 2, pw2 / 2, -ph2 / 2, r2);
      ctx.closePath();
      ctx.fillStyle = '#fbf3dd'; ctx.fill();
      ctx.lineWidth = Math.max(1, fs * 0.09); ctx.strokeStyle = '#b08a56'; ctx.stroke();
      ctx.fillStyle = '#6d4c28';
      ctx.fillText(txt, 0, fs * 0.05);
      ctx.restore();
    },

    /* ============ 拜访模式(2026-08-14 共享世界「门后是真实世界」) ============
       Chris 定案:「外壳是传送门(保活力), 门后是真实世界(保沉浸), 地址是永久的
       (保归属), 做到极致」。点邻居 → 整个渲染器切换到**TA 家的真实农场**:
       TA 的菜地长势/建筑等级/水塘小路/装饰, 全部由 worldLayout 镜像重建。

       实现是「换身术」: Farm.state.data 临时指向伪状态。三道硬闸保证真身安全:
       state.save() / fbGameSync.push() / fbQueue.flush() 在 _visitLock 期间
       全部冻结(否则邻居的农场会写进我的存档和云档)。需要以真身操作的动作
       (点赞走每日上限)用 _withRealState 短暂换回。 */
    enterVisitFarm(info) {
      if (this._visit || !this._on || !info || !info.layout) return false;
      try {
        this._exitClearMode();
        Farm.state.save();                       // 真身进度先落盘
        if (Farm.fbGameSync && Farm.fbGameSync.recordVisit && info.uid) {
          try { Farm.fbGameSync.recordVisit(info.uid); } catch (e) {}   // 足迹用真身状态记
        }
        if (Farm.neighbors && Farm.neighbors.noteVisit && info._neighbor) {
          try { Farm.neighbors.noteVisit(info._neighbor); } catch (e) {}
        }
        const real = Farm.state.data, L = info.layout;
        const vd = {
          language: real.language, level: info.level || 1,
          coins: real.coins, eastPoints: real.eastPoints,   // HUD 仍显示我的钱包
          plots: (L.plots || []).map((pp) => ({ unlocked: true, crop: pp.c || null, plantedAt: pp.p || 0, gx: pp.x, gy: pp.y, srcI: pp.i })),
          map: (L.bld || []).map((bb) => { const ob = { type: bb.t, gx: bb.x, gy: bb.y }; if (bb.lv) ob.lv = bb.lv; return ob; }),
          mapTerrain: {}, decorations: (L.deco || []).map((dd) => ({ itemId: dd.d, gx: dd.x, gy: dd.y, placedAt: 1 })),
          landLevel: L.landLevel || 0,
          landOrigin: L.o === 'front' ? 'front' : 'back',
          clearedCells: {},
          activeEffects: {}, seeds: {}, warehouse: [],
          dailyClaims: { date: '', visitFootprints: [], likesSentToday: [] },
          sessionStats: { date: '' },
          // 邻居的小动物也照画（门后是真实世界）；走动状态按 seed 缓存，进出都清掉，
          // 别让我家的鸡在邻居院子里当隐形靶子（_petAt 会命中没画出来的鬼影）
          farmFwdUndoneV1: true, pondMoveV3: true, worldStamped: true,
        };
        (L.terr || []).forEach((e) => { if (e && e.k) vd.mapTerrain[e.k] = e.t; });
        (L.cl || []).forEach((k) => { if (k) vd.clearedCells[k] = 1; });
        this._pets = {};
        this._visit = { info, savedData: real, vd };
        Farm.state._visitLock = true;
        Farm.state.data = vd;
        this._pcs = null; this._pcsN = -1;       // 地块格缓存按 plots.length 判断, 必须手动失效
        this._bgKey = null;
        this._buildLayout();
        this._sel = -1; this._moving = null; this._blockedCell = null;
        document.body.classList.add('visit-mode');
        this._buildVisitUI(info);
        this._autoFrame();
        this.render();
        if (Farm.audio) Farm.audio.play('tap');
        return true;
      } catch (err) {
        console.error('[visit] enter failed, rolling back', err);
        this.exitVisitFarm();
        return false;
      }
    },

    exitVisitFarm() {
      if (!this._visit && !Farm.state._visitLock) return;
      const v = this._visit;
      this._visit = null;
      if (v && v.savedData) Farm.state.data = v.savedData;
      Farm.state._visitLock = false;
      this._pets = {};
      this._pcs = null; this._pcsN = -1;
      this._bgKey = null;
      this._buildLayout();
      document.body.classList.remove('visit-mode');
      const bar = document.getElementById('visitBar'); if (bar) bar.remove();
      const act = document.getElementById('visitActions'); if (act) act.remove();
      this._autoFrame();
      this.render();
    },

    // 需要以真身执行的动作(每日上限/去重都记在真身 dailyClaims 里)
    async _withRealState(fn) {
      const v = this._visit;
      if (!v) return fn();
      Farm.state.data = v.savedData;
      Farm.state._visitLock = false;
      try { return await fn(); }
      finally {
        if (this._visit === v) {                 // 还在拜访 → 换回伪身
          Farm.state.data = v.vd;
          Farm.state._visitLock = true;
        }
      }
    },

    _buildVisitUI(info) {
      const en = this._lang() === 'en';
      const bar = document.createElement('div');
      bar.id = 'visitBar';
      /* 🔒 名字必须转义（2026-08-15 审阅第 5 条）：游戏内起名会剥 <>&"'，但登录用户
         可以直接往自己的 farm_players.gameStats 写任意 nickname/displayName ——
         别人一进他家，这段就会以 HTML 执行（存储型 XSS）。跨玩家字符串一律转义。 */
      const nm = (Farm.ui && Farm.ui.escapeHtml) ? Farm.ui.escapeHtml(info.name || '')
                                                 : String(info.name || '').replace(/[<>&"']/g, '');
      bar.innerHTML = '<span class="visit-face">' + (info.emoji || '🏡') + '</span>'
        + '<span class="visit-name">' + (en ? (nm + "'s Farm") : (nm + ' 家')) + '</span>'
        + '<span class="visit-addr" id="visitAddr">Lv ' + (info.level || 1) + '</span>';
      document.body.appendChild(bar);
      // 永久门牌(东方农场路 N 号)异步补上
      if (info.uid && Farm.fbGameSync && Farm.fbGameSync.fetchWorldAddress) {
        Farm.fbGameSync.fetchWorldAddress(info.uid).then((n) => {
          const el = document.getElementById('visitAddr');
          if (el && n) el.textContent = (en ? ('No.' + n + ' Eastern Farm Rd · Lv' + (info.level || 1))
                                            : ('东方农场路 ' + n + ' 号 · Lv' + (info.level || 1)));
        }).catch(() => {});
      }
      const act = document.createElement('div');
      act.id = 'visitActions';
      act.innerHTML =
        '<button class="visit-btn" id="visitLike">👍 ' + (en ? 'Like' : '点赞') + '</button>'
        + '<button class="visit-btn" id="visitWater">💧 ' + (en ? 'Water' : '浇水') + '</button>'
        + '<button class="visit-btn visit-btn--home" id="visitHome">↩️ ' + (en ? 'Go home' : '回自家') + '</button>';
      document.body.appendChild(act);
      const info2 = this._visit.info;
      document.getElementById('visitHome').onclick = () => { if (Farm.audio) Farm.audio.play('tap'); this.exitVisitFarm(); };
      document.getElementById('visitLike').onclick = async () => {
        if (Farm.audio) Farm.audio.play('tap');
        const r = await this._withRealState(() => Farm.fbGameSync.sendLike(info2.uid));
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(r && r.ok === false
          ? (en ? 'Already liked today' : '今日已赞过')
          : (en ? 'Liked! ❤️' : '已点赞 ❤️'), 2200);
      };
      document.getElementById('visitWater').onclick = async () => {
        if (Farm.audio) Farm.audio.play('tap');
        if (!(Farm.fbGameSync && Farm.fbGameSync.sendHelp) || !info2.uid) return;
        const r = await this._withRealState(() => Farm.fbGameSync.sendHelp(info2.uid));
        if (Farm.ui && Farm.ui.toast) {
          Farm.ui.toast(r && r.ok
            ? (en ? 'Watered their crops.' : '帮他们浇了水。')
            : ((r && r.message) || (en ? 'Already helped today.' : '今天已经帮过了。')), 2200);
        }
        if (r && r.ok) {
          (Farm.state.data.plots || []).forEach((pl) => {
            if (pl && pl.crop && Farm.tending && Farm.tending.applyWaterSpeedup) Farm.tending.applyWaterSpeedup(pl);
          });
          this.render();
          if (Farm.ui.refreshHUD) Farm.ui.refreshHUD();
        }
      };
    },

    async _visitPlotTap(hit) {
      const plot = (Farm.state.data.plots || [])[hit.i];
      const info = this._visit && this._visit.info;
      if (!plot || !plot.crop || !info) { this._visitTapReact({ x: 0, y: 0 }); return; }
      const en = this._lang() === 'en';
      const gs = (info._neighbor && info._neighbor._doc && info._neighbor._doc.gameStats) || {};
      if (Farm.crops.isMature(plot)) {
        if (!(Farm.steal && Farm.steal.stealFromReal)) return;
        if (!Farm.steal.isUnlocked || !Farm.steal.isUnlocked()) {
          if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en
            ? 'Harvest a crop of your own first, then you can take one here.'
            : '先收一次自己的菜，才能在这里顺。');
          return;
        }
        const r = await this._withRealState(() => Farm.steal.stealFromReal(
          { uid: info.uid, name: info.name, level: info.level || 1, hasGuardDog: !!gs.hasGuardDog },
          { plotIdx: (plot.srcI != null ? plot.srcI : hit.i), cropId: plot.crop, plantedAt: plot.plantedAt || 0 }
        ));
        if (r && r.ok) {
          plot.crop = null; plot.plantedAt = 0;
          this.render();
          if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Taken to your barn.' : '已放进自家谷仓。', 2000);
          if (Farm.audio) Farm.audio.play('coin');
          if (Farm.ui.refreshHUD) Farm.ui.refreshHUD();
        } else if (Farm.ui && Farm.ui.toast) {
          Farm.ui.toast((r && r.message) || (en ? 'Could not take that crop.' : '这棵没顺成。'), 2600);
        }
        return;
      }
      if (!(Farm.fbGameSync && Farm.fbGameSync.sendHelp)) return;
      const r = await this._withRealState(() => Farm.fbGameSync.sendHelp(info.uid));
      if (r && r.ok) {
        if (Farm.tending && Farm.tending.applyWaterSpeedup) Farm.tending.applyWaterSpeedup(plot);
        this.render();
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Watered their crops.' : '帮他们浇了水。', 2000);
        if (Farm.audio) Farm.audio.play('coin');
        if (Farm.ui.refreshHUD) Farm.ui.refreshHUD();
      } else if (Farm.ui && Farm.ui.toast) {
        Farm.ui.toast((r && r.message) || (en ? 'Already helped today.' : '今天已经帮过了。'), 2200);
      }
    },
    // 拜访中点到空地/建筑 → 轻反馈
    _visitTapReact(p) {
      const en = this._lang() === 'en';
      if (Farm.ui && Farm.ui.floatText) Farm.ui.floatText('✨', p.x, p.y - 8, '#e8a020');
      if (!this._visitHintShown) {
        this._visitHintShown = true;
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en
          ? 'Tap a ripe crop to take one. Tap a growing crop to water.'
          : '点成熟的菜可顺走一棵。点还在长的菜是帮忙浇水。', 3200);
      }
    },

    _delChip(o) { const b = BUILDINGS[o.type], c = this._cell(o.gx + b.w - 1, o.gy), th = this._th(); return { x: c.x + this._tw() / 2 * 0.5, y: c.y - th * 0.2, r: Math.max(12, th * 0.5) }; },
    _addBuilding(type) {
      const b = BUILDINGS[type], en = this._lang() === 'en', cost = b.cost || 0;
      if (type === 'home') {
        const n = this._homes().length;
        if (n >= HOME_CAP) {
          if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'House limit reached. Tap a house to remodel.' : '房子已经建满。点现有的房子可以改建。');
          return;
        }
        if (n > 0) { this._openNewHomePanel(); return; }
      }
      // unique 建筑（菜摊）全场限一座
      if (b.unique) {
        const map = Farm.state.data.map || [];
        const at = map.findIndex((m) => m && m.type === type);
        if (at >= 0) {
          if (b.tap === 'stall_sale' && Farm.stall) Farm.stall.open();
          return;
        }
      }
      // must be able to afford it (农场币) — show the shortfall, nudge to earn more.
      if (cost > 0 && Farm.state.data.coins < cost) {
        const need = cost - Farm.state.data.coins;
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? ('Need ' + need + ' more coins') : ('还差 ' + need + ' 农场币'));
        return;
      }
      const ctr = this._screenToCell(this._cssW() / 2, this._cssH() / 2);
      const c0x = ctr.gx - (b.w >> 1), c0y = ctr.gy - (b.h >> 1);
      // 候选位按「离屏幕中心多近」排（2026-08-15）：原来中心占着就从 (0,0) 逐行扫，
      // 新建筑常被丢到地图角落、半个身子在画面外，玩家还以为没建成
      const tries = [[c0x, c0y]];
      for (let gy = 0; gy + b.h <= ROWS; gy++) for (let gx = 0; gx + b.w <= COLS; gx++) tries.push([gx, gy]);
      tries.sort((p1, p2) => (Math.abs(p1[0] - c0x) + Math.abs(p1[1] - c0y)) - (Math.abs(p2[0] - c0x) + Math.abs(p2[1] - c0y)));
      for (const [gx, gy] of tries) if (this._footprintFree(gx, gy, type, -1)) {
        if (cost > 0 && !Farm.state.spendCoins(cost)) { if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Not enough coins' : '农场币不足'); return; }
        const rec = { type, gx, gy }; if (type === 'home') rec.lv = 1;
        (Farm.state.data.map = Farm.state.data.map || []).push(rec); this._sel = Farm.state.data.map.length - 1;
        Farm.state.save(); this.render();
        if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
        this._refreshPaletteAfford();
        let c = this._cell(gx + (b.w - 1) / 2, gy + (b.h - 1) / 2);
        // 落点跑出画面（或贴边）→ 镜头挪过去，让人看见自己刚花钱建的东西
        const W = this._cssW(), H = this._cssH(), m = this._tw();
        if (c.x < m || c.x > W - m || c.y < m * 1.5 || c.y > H - m) {
          this._camX += c.x - W / 2; this._camY += c.y - H * 0.55; this._clampCam(); this.render();
          c = this._cell(gx + (b.w - 1) / 2, gy + (b.h - 1) / 2);
        }
        const charm = charmOf(b), r = this._cv.getBoundingClientRect();
        if (Farm.ui && Farm.ui.floatText) Farm.ui.floatText('✨+' + charm + (en ? ' charm' : ' 魅力'), r.left + c.x - 20, r.top + c.y - this._th() * 2, '#e8a020');
        if (Farm.audio) Farm.audio.play('coin');
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? ('Placed ' + b.en + ' (-' + cost + ' coins) — drag to move') : ('已建' + b.zh + '（-' + cost + ' 农场币）拖动可移动'));
        return;
      }
      if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'No room' : '没有空位了');
    },
    _PLOT_COST: 200,
    _cellFreeForPlot(gx, gy) {
      return this._cellFreeForPlotMove(gx, gy, -1);
    },
    _cellFreeForPlotMove(gx, gy, exceptIdx) {
      if (!this._inBounds(gx, gy) || !this._ownedCell(gx, gy)) return false;
      const plots = Farm.state.data.plots || [];
      for (let i = 0; i < plots.length; i++) {
        if (i === exceptIdx || !plots[i]) continue;
        if (this._plotGX(i) === gx && this._plotGY(i) === gy) return false;
      }
      if (this._terrain()[gx + ',' + gy] === 'water') return false;
      if (this._buildingAt(gx, gy) >= 0) return false;
      if (this._decoAt(gx, gy) >= 0) return false;
      if (this._onRoad(gx, gy)) return false;
      return true;
    },
    _plotCost() {   // 单一定价源（与商城 extra_plot_coins 同价，B5 地块统一）
      return (Farm.state.extraPlotCoinCost) ? Farm.state.extraPlotCoinCost() : this._PLOT_COST;
    },
    _addPlot() {   // buy a new garden plot (菜地) on owned land → farmable anywhere you've expanded
      const en = this._lang() === 'en';
      // 统一上限：与商城 extra_plot 同一计数器 extraPlots + 同一帽 EXTRA_PLOT_CAP。
      if (Farm.state.extraPlotCapReached && Farm.state.extraPlotCapReached()) {
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Plot limit reached for now — level up to unlock more land' : '扩地已达上限 — 升级会解锁更多土地');
        return;
      }
      const cost = this._plotCost();
      if (Farm.state.data.coins < cost) { if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? ('Need ' + (cost - Farm.state.data.coins) + ' more coins') : ('还差 ' + (cost - Farm.state.data.coins) + ' 农场币')); return; }
      const ob = this._ownedBounds(), ctr = this._screenToCell(this._cssW() / 2, this._cssH() / 2);
      const tries = [[ctr.gx, ctr.gy]];
      for (let gy = ob.y1; gy <= ob.y2; gy++) for (let gx = ob.x1; gx <= ob.x2; gx++) tries.push([gx, gy]);
      Object.keys(Farm.state.data.clearedCells || {}).forEach((k) => {
        const a = k.split(',');
        tries.push([+a[0], +a[1]]);
      });
      for (const [gx, gy] of tries) if (this._cellFreeForPlot(gx, gy)) {
        if (!Farm.state.spendCoins(cost)) return;
        // 走同一计数器：extraPlots +1（同帽同价），plot 带上选好的 gx,gy。
        if (!Farm.state.addExtraPlot({ gx, gy })) { Farm.state.addCoins(cost); return; }   // 上限竞态兜底退款
        this._buildLayout(); this._pcs = null;   // refresh cell→plot map + plotCellSet cache
        Farm.state.save(); this.render();
        if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
        this._refreshPaletteAfford();
        const c = this._cell(gx, gy), r = this._cv.getBoundingClientRect();
        if (Farm.ui && Farm.ui.floatText) Farm.ui.floatText('🌱 -' + cost, r.left + c.x - 16, r.top + c.y - this._th(), '#3a8c50');
        if (Farm.audio) Farm.audio.play('coin');
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'New plot ready' : '新菜地已就绪');
        return;
      }
      if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'No free tile — expand land first' : '当前没有空位，请先扩地');
    },
    _adjacentOwned(gx, gy) {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let i = 0; i < dirs.length; i++) {
        if (this._ownedCell(gx + dirs[i][0], gy + dirs[i][1])) return true;
      }
      return false;
    },
    _canClear(gx, gy, road) {
      if (!this._inBounds(gx, gy)) return false;
      const k = gx + ',' + gy;
      const t = this._terrain()[k];
      if (t === 'water' || t === 'path') return false;
      if (this._cellToPlot[k] != null) return false;
      if (this._buildingAt(gx, gy) >= 0) return false;
      if (this._decoAt(gx, gy) >= 0) return false;
      // 只挡路心，不挡路旁一格（那条缓冲是给树留的）。否则乡路正好贴着
      // 地界南沿，开垦目标全被挤到镜头外的后山。
      if ((road || this._roadSet())[k]) return false;
      if (this._ownedCell(gx, gy)) return true;
      return this._adjacentOwned(gx, gy);
    },
    _eachClearTarget(fn) {
      const ob = this._ownedBounds();
      const road = this._roadSet();
      const seen = {};
      const consider = (gx, gy) => {
        const k = gx + ',' + gy;
        if (seen[k]) return;
        seen[k] = 1;
        if (this._canClear(gx, gy, road)) fn(gx, gy);
      };
      for (let gy = ob.y1 - 1; gy <= ob.y2 + 1; gy++) {
        for (let gx = ob.x1 - 1; gx <= ob.x2 + 1; gx++) consider(gx, gy);
      }
      const extra = Farm.state.data.clearedCells || {};
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]];
      Object.keys(extra).forEach((k) => {
        const a = k.split(','), gx = +a[0], gy = +a[1];
        for (let i = 0; i < dirs.length; i++) consider(gx + dirs[i][0], gy + dirs[i][1]);
      });
    },
    _enterClearMode() {
      const en = this._lang() === 'en';
      if (this._visit || (Farm.state && Farm.state._visitLock)) return;
      if (Farm.state.extraPlotCapReached && Farm.state.extraPlotCapReached()) {
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Plot limit reached for now' : '开垦已达上限，升级后再来');
        return;
      }
      if (Farm.ui && Farm.ui.hideModal) Farm.ui.hideModal();
      this._clearMode = true;
      this._showClearHint();
      this._frameClearTargets();
      this.render();
    },
    _frameClearTargets() {
      const W = this._cssW(), H = this._cssH();
      let visible = 0, nearest = null, nd = Infinity;
      this._eachClearTarget((gx, gy) => {
        if (this._ownedCell(gx, gy)) return;
        const c = this._cell(gx, gy);
        if (c.x > 48 && c.x < W - 48 && c.y > 90 && c.y < H - 160) visible++;
        const d = Math.hypot(c.x - W * 0.55, c.y - H * 0.62);
        if (d < nd) { nd = d; nearest = c; }
      });
      if (visible > 0 || !nearest) return;
      this._camX += nearest.x - W * 0.55;
      this._camY += nearest.y - H * 0.62;
      this._clampCam();
      this._bgKey = null;
    },
    _exitClearMode() {
      if (!this._clearMode) return;
      this._clearMode = false;
      if (this._clearHint) this._clearHint.style.display = 'none';
      this.render();
    },
    _showClearHint() {
      const en = this._lang() === 'en';
      let el = this._clearHint;
      if (!el) {
        el = document.createElement('div');
        el.id = 'isoClearHint';
        el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:88px;z-index:22;display:flex;align-items:center;gap:10px;background:rgba(42,92,52,.94);color:#fff;padding:8px 12px 8px 14px;border-radius:18px;font:500 13px/1.35 "Noto Sans SC",system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.18);';
        document.body.appendChild(el);
        this._clearHint = el;
      }
      const cost = this._plotCost();
      el.innerHTML = '<span>🪓 ' + (en ? 'Tap a glowing tile to clear a field' : '点发亮的林子或草地，开成农田') +
        ' · <span class="coin-icon"></span>' + cost + '</span>' +
        '<button type="button" style="border:none;background:rgba(255,255,255,.2);color:#fff;border-radius:12px;padding:4px 9px;cursor:pointer;font:600 13px sans-serif">✕</button>';
      el.style.display = 'flex';
      el.lastChild.onclick = (ev) => { ev.stopPropagation(); this._exitClearMode(); };
    },
    _tryClear(gx, gy) {
      const en = this._lang() === 'en';
      if (this._visit || (Farm.state && Farm.state._visitLock)) return;
      if (!this._canClear(gx, gy)) {
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Clear a tile next to your farm' : '要贴着自家地开垦');
        return;
      }
      if (Farm.state.extraPlotCapReached && Farm.state.extraPlotCapReached()) {
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Plot limit reached for now' : '开垦已达上限，升级后再来');
        this._exitClearMode();
        return;
      }
      const cost = this._plotCost();
      if (Farm.state.data.coins < cost) {
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? ('Need ' + (cost - Farm.state.data.coins) + ' more coins') : ('还差 ' + (cost - Farm.state.data.coins) + ' 农场币'));
        return;
      }
      const wasOwned = this._ownedCell(gx, gy);
      if (!Farm.state.spendCoins(cost)) return;
      if (!wasOwned) {
        const cc = Farm.state.data.clearedCells = Farm.state.data.clearedCells || {};
        cc[gx + ',' + gy] = 1;
      }
      if (!Farm.state.addExtraPlot({ gx: gx, gy: gy })) {
        Farm.state.addCoins(cost);
        if (!wasOwned && Farm.state.data.clearedCells) delete Farm.state.data.clearedCells[gx + ',' + gy];
        return;
      }
      this._buildLayout();
      this._pcs = null;
      this._bgKey = null;
      Farm.state.save();
      this._showClearHint();
      this.render();
      if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
      let c = this._cell(gx, gy);
      const W = this._cssW(), H = this._cssH(), m = this._tw();
      if (c.x < m || c.x > W - m || c.y < m * 1.5 || c.y > H - m) {
        this._camX += c.x - W / 2; this._camY += c.y - H * 0.55; this._clampCam(); this.render();
        c = this._cell(gx, gy);
      }
      const r = this._cv.getBoundingClientRect();
      if (Farm.ui && Farm.ui.floatText) Farm.ui.floatText('🪓 -' + cost, r.left + c.x - 16, r.top + c.y - this._th(), '#3a8c50');
      if (Farm.audio) Farm.audio.play('coin');
      if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Land cleared' : '开垦完成');
    },
    _coopReady(o) { return Date.now() - (o && o.eggAt || 0) >= COOP_INTERVAL; },
    _collectCoop(o, p) {
      const en = this._lang() === 'en';
      if (this._coopReady(o)) {
        o.eggAt = Date.now(); Farm.state.addCoins(COOP_REWARD); Farm.state.save();
        if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
        if (Farm.audio) Farm.audio.play('coin');
        if (p && Farm.ui && Farm.ui.floatText) { const r = this._cv.getBoundingClientRect(); Farm.ui.floatText('🥚 +' + COOP_REWARD, r.left + p.x - 16, r.top + p.y - 20, '#e8a020'); }
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? ('Eggs collected · +' + COOP_REWARD + ' coins') : ('已收取鸡蛋 · +' + COOP_REWARD + ' 农场币'));
        this.render();
      } else {
        const left = Math.ceil((COOP_INTERVAL - (Date.now() - (o.eggAt || 0))) / 60000);
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? ('Eggs ready in ~' + left + ' min') : ('鸡蛋还需约 ' + left + ' 分钟'));
      }
    },
    _refreshPaletteAfford() {
      if (!this._palBuild) return;
      const coins = (Farm.state.data && Farm.state.data.coins) || 0;
      const en = this._lang() === 'en';
      this._palBuild.querySelectorAll('button[data-type]').forEach((btn) => {
        const isPlot = btn.dataset.type === '__plot';
        const b = BUILDINGS[btn.dataset.type], cost = b ? (b.cost || 0) : (isPlot ? this._plotCost() : 0);
        if (!b && !isPlot) return;
        // 菜地：随 extraPlots 递增价 + 达上限显示「已满」并置灰（与商城同步）。
        if (isPlot) {
          const capped = Farm.state.extraPlotCapReached && Farm.state.extraPlotCapReached();
          const cs = btn.querySelector('.palCost');
          if (cs) {
            cs.innerHTML = capped
              ? (en ? '✓ MAX' : '✓ 已满')
              : '<span class="coin-icon"></span> ' + cost;
            cs.style.color = capped ? '#9a8f7d' : (coins >= cost ? '#3a8c50' : '#e8522a');
          }
          btn.style.opacity = capped ? '0.5' : (coins >= cost ? '1' : '0.55');
          return;
        }
        if (btn.dataset.type === 'home') {
          const n = this._homes().length;
          const cs = btn.querySelector('.palCost');
          if (n >= HOME_CAP) {
            if (cs) { cs.textContent = en ? '✓ MAX' : '✓ 已满'; cs.style.color = '#9a8f7d'; }
            btn.style.opacity = '0.5';
            return;
          }
          if (n > 0) {
            if (cs) { cs.textContent = en ? 'Build another' : '再建一座'; cs.style.color = '#3a8c50'; }
            btn.style.opacity = '1';
            return;
          }
        }
        const afford = coins >= cost;
        btn.style.opacity = afford ? '1' : '0.55';
        const cs = btn.querySelector('.palCost'); if (cs) cs.style.color = afford ? '#3a8c50' : '#e8522a';
      });
      if (this._refreshModeUI) this._refreshModeUI();   // refresh the charm count in the hint
    },
    _farmCharm() {
      let s = 0; (Farm.state.data.map || []).forEach((o) => {
        const b = BUILDINGS[o.type]; if (!b) return;
        // 我的家按等级计魅力(HOME_LEVELS.charm), 升级=美化, 魅力跟着涨
        if (o.type === 'home') {
          const ch = (HOME_LEVELS[Math.min((o.lv || 1), HOME_LEVELS.length) - 1] || {}).charm || 40;
          s += (Farm.state.data && Farm.state.data.homeNeglected) ? Math.floor(ch / 2) : ch;
          return;
        }
        s += charmOf(b);
      }); return s;
    },
    _paintCell(gx, gy) {
      if (!this._inBounds(gx, gy)) return;
      const t = this._terrain(), k = gx + ',' + gy;
      if (this._brush === 'grass') { if (t[k] != null) { delete t[k]; this.render(); } return; }
      // 🔒 水不能刷在菜地/建筑上（2026-08-13）——否则又造出「水塘压着菜地」，
      // 而 _cellFreeForPlot/_canPlace 只挡得住「后放的一方」，挡不住后刷的水。
      // 乡路同样禁刷（2026-08-16 Chris:「马路应该不允许建造」）。
      const blocked = this._cellToPlot[k] != null || this._buildingAt(gx, gy) >= 0
        || this._decoAt(gx, gy) >= 0 || this._onRoad(gx, gy);
      if ((this._brush === 'water' || this._brush === 'path') && blocked) {
        this._blockedCell = { gx, gy, t: Date.now() };
        this.render();
        return;
      }
      if (t[k] !== this._brush) { t[k] = this._brush; this.render(); }
    },

    // ---- build-mode DOM UI (mirrors the top-down view) ----
    _buildUI() {
      const en = this._lang() === 'en';
      const btn = document.createElement('button');
      btn.id = 'isoBuildBtn';
      btn.style.cssText = 'position:fixed;right:14px;z-index:20;border:none;border-radius:24px;padding:11px 16px;min-height:44px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;font:600 15px/1 "Noto Sans SC",system-ui,sans-serif;color:#fff;background:#4CAF50;box-shadow:0 3px 10px rgba(0,0,0,.22);cursor:pointer;';
      btn.onclick = () => this.toggleBuild();
      document.body.appendChild(btn); this._buildBtn = btn;
      if (!(Farm.state.data && Farm.state.data.mapBuildSeen) && btn.animate) this._buildPulse = btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.09)' }, { transform: 'scale(1)' }], { duration: 1300, iterations: Infinity, easing: 'ease-in-out' });
      const nbBtn = document.createElement('button');
      nbBtn.id = 'isoCommunityBtn';
      nbBtn.style.cssText = 'position:fixed;left:14px;z-index:20;border:none;border-radius:24px;padding:11px 16px;min-height:44px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;font:600 15px/1 "Noto Sans SC",system-ui,sans-serif;color:#fff;background:#3a8c50;box-shadow:0 3px 10px rgba(0,0,0,.22);cursor:pointer;';
      nbBtn.onclick = () => { if (Farm.audio) Farm.audio.play('tap'); if (Farm.neighbors) Farm.neighbors.open(); };
      document.body.appendChild(nbBtn); this._communityBtn = nbBtn;

      const tray = document.createElement('div'); tray.id = 'isoPalette';
      tray.style.cssText = 'position:fixed;left:0;right:0;z-index:20;display:none;flex-direction:column;gap:8px;padding:9px 10px;background:rgba(255,255,255,.94);box-shadow:0 -3px 12px rgba(0,0,0,.12);';
      const tabs = document.createElement('div'); tabs.style.cssText = 'display:flex;gap:6px;justify-content:center;';
      [['build', en ? '🏠 Build' : '🏠 建筑'], ['terrain', en ? '🖌 Terrain' : '🖌 地形']].forEach(([m, label]) => { const t = document.createElement('button'); t.dataset.mode = m; t.textContent = label; t.style.cssText = 'border:none;border-radius:13px;padding:6px 16px;cursor:pointer;font:600 13px/1 "Noto Sans SC",system-ui,sans-serif;'; t.onclick = () => this.setEditMode(m); tabs.appendChild(t); });
      this._modeTabs = tabs; tray.appendChild(tabs);
      // single horizontal SCROLLING row (no wrap) → compact, takes minimal height
      const rowCss = 'display:flex;flex-wrap:nowrap;gap:8px;align-items:flex-end;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;padding-bottom:2px;scrollbar-width:none;';
      const pb = document.createElement('div'); pb.style.cssText = rowCss;
      // 菜地 (new farmable plot) — first item so it's front-and-centre
      const pit = document.createElement('button'); pit.dataset.type = '__plot';
      pit.style.cssText = 'border:1px solid #cdebc9;border-radius:14px;background:#f3fbef;padding:8px 10px 6px;min-width:64px;flex:0 0 auto;cursor:pointer;font:500 12px/1.3 "Noto Sans SC",system-ui,sans-serif;color:#444;';
      pit.innerHTML = '<div style="font-size:11px;color:#3a8c50;margin-top:4px;font-weight:600">🪓 ' + (en ? 'Clear' : '开垦') + '</div><div class="palCost" style="font-size:12px;font-weight:600;color:#3a8c50;margin-top:1px"><span class="coin-icon"></span> ' + this._plotCost() + '</div>';
      const pic = document.createElement('div'); pic.style.cssText = 'width:44px;height:38px;margin:0 auto;background-size:contain;background-repeat:no-repeat;background-position:center;'; pic.style.backgroundImage = "url('" + ASSET_DIR + "hd_soil.webp')"; pit.insertBefore(pic, pit.firstChild);
      pit.onclick = () => this._enterClearMode(); pb.appendChild(pit);
      PALETTE.forEach((type) => { const b = BUILDINGS[type]; const item = document.createElement('button'); item.dataset.type = type; item.style.cssText = 'border:1px solid #e0e0e0;border-radius:14px;background:#fff;padding:8px 10px 6px;min-width:64px;flex:0 0 auto;cursor:pointer;font:500 12px/1.3 "Noto Sans SC",system-ui,sans-serif;color:#444;'; item.innerHTML = '<div style="font-size:11px;color:#888;margin-top:4px">' + (en ? b.en : b.zh) + '</div><div class="palCost" style="font-size:12px;font-weight:600;color:#3a8c50;margin-top:1px"><span class="coin-icon"></span> ' + (b.cost || 0) + '</div>'; const ic = document.createElement('div'); ic.style.cssText = 'width:44px;height:38px;margin:0 auto;background-size:contain;background-repeat:no-repeat;background-position:center;'; ic.style.backgroundImage = "url('" + ASSET_DIR + ASSET_SRC[b.img] + "')"; item.insertBefore(ic, item.firstChild); item.onclick = () => this._addBuilding(type); pb.appendChild(item); });
      this._palBuild = pb; tray.appendChild(pb);
      const pt = document.createElement('div'); pt.style.cssText = rowCss;
      BRUSHES.forEach((br) => { const item = document.createElement('button'); item.dataset.brush = br.key; item.style.cssText = 'border:1px solid #e0e0e0;border-radius:14px;background:#fff;padding:8px 10px 6px;min-width:64px;flex:0 0 auto;cursor:pointer;font:500 12px/1.3 "Noto Sans SC",system-ui,sans-serif;color:#444;'; item.innerHTML = '<div style="width:40px;height:30px;margin:0 auto;border-radius:8px;background:' + br.color + '"></div><div style="font-size:11px;color:#888;margin-top:4px">' + (en ? br.en : br.zh) + '</div>'; item.onclick = () => this.setBrush(br.key); pt.appendChild(item); });
      this._palTerrain = pt; tray.appendChild(pt);
      document.body.appendChild(tray); this._palette = tray;

      const hint = document.createElement('div'); hint.id = 'isoBuildHint';
      hint.style.cssText = 'position:fixed;left:0;right:0;z-index:19;text-align:center;display:none;pointer-events:none;font:500 13px/1.4 "Noto Sans SC",system-ui,sans-serif;color:#fff;';
      hint.innerHTML = '<span style="background:rgba(0,0,0,.45);padding:6px 14px;border-radius:16px"></span>';
      document.body.appendChild(hint); this._hint = hint;

      // Always-visible on-screen zoom buttons (＋ / −) — one-tap zoom, easy on phones
      // (in addition to pinch / wheel). Big tap targets.
      const zwrap = document.createElement('div'); zwrap.id = 'isoZoom';
      zwrap.style.cssText = 'position:fixed;z-index:20;display:flex;flex-direction:column;gap:10px;';
      // 44×44 触控热区（was 32，低于可用性底线；2026-07-05 UX 第 1 批 #8）
      const mkZ = (label, f) => { const z = document.createElement('button'); z.textContent = label; z.setAttribute('aria-label', label === '＋' ? 'zoom in' : 'zoom out'); z.style.cssText = 'width:36px;height:36px;border:1px solid rgba(255,255,255,0.42);border-radius:50%;background:rgba(255,248,230,0.34);color:rgba(48,72,36,0.72);font:600 17px/1 system-ui,sans-serif;box-shadow:0 1px 4px rgba(40,32,16,.10);cursor:pointer;touch-action:manipulation;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);'; z.onclick = (e) => { e.preventDefault(); this._zoomBy(f); }; return z; };
      zwrap.appendChild(mkZ('＋', 1.3)); zwrap.appendChild(mkZ('－', 0.77));
      document.body.appendChild(zwrap); this._zoomUI = zwrap;

      this._refreshModeUI(); this._layoutUI();
    },
    _zoomBy(f) { this._zoomAt(this._cssW() / 2, this._cssH() / 2, this._zoom * f); },
    // Re-render all language-dependent map UI in the CURRENT language. The map
    // is a canvas overlay, so the DOM-grid renderGrid() that the settings
    // language toggle calls never reaches it — without this, the Build button,
    // palette labels and mode tabs stay in the old language until a reload.
    // _buildUI() appends (not idempotent), so tear down its elements first;
    // mode/zoom/camera state lives on `this` and survives the rebuild.
    relang() {
      if (!this._on) return;   // map inactive → next init() builds it fresh in the right language
      [this._buildBtn, this._communityBtn, this._palette, this._hint, this._zoomUI].forEach((el) => { if (el && el.remove) el.remove(); });
      if (this._buildPulse && this._buildPulse.cancel) { try { this._buildPulse.cancel(); } catch (e) {} }
      this._buildBtn = this._communityBtn = this._palette = this._hint = this._zoomUI = null;
      this._modeTabs = this._palBuild = this._palTerrain = null;
      this._buildUI();   // rebuilds in current language; _refreshModeUI()+_layoutUI() restore the mode
      this.render();
    },
    _layoutUI() {
      const r = this._farmRect(), fromBottom = Math.max(0, window.innerHeight - (r.top + r.height)), en = this._lang() === 'en';
      if (this._zoomUI) {
        // top-right corner of the farm; clamp below the topbar (it stays
        // visible even in fullscreen build mode) so it never overlaps the coins.
        const tb = document.getElementById('topbar');
        const tbBottom = tb ? tb.getBoundingClientRect().bottom : 0;
        this._zoomUI.style.left = (r.left + r.width - 46) + 'px';   // 36px 玻璃钮 + 10px 右边距
        this._zoomUI.style.top = Math.max(r.top + 10, tbBottom + 8) + 'px';
      }
      if (this._palette) { this._palette.style.display = this._build ? 'flex' : 'none'; this._palette.style.left = r.left + 'px'; this._palette.style.right = Math.max(0, window.innerWidth - (r.left + r.width)) + 'px'; this._palette.style.bottom = fromBottom + 'px'; }
      if (this._buildBtn) { const ph = (this._build && this._palette) ? (this._palette.getBoundingClientRect().height || 74) : 0; this._buildBtn.style.right = (Math.max(0, window.innerWidth - (r.left + r.width)) + 14) + 'px'; this._buildBtn.style.bottom = (fromBottom + (this._build ? ph + 10 : 14)) + 'px'; this._buildBtn.textContent = this._build ? (en ? '✓ Done' : '✓ 完成') : (en ? '🔨 Build' : '🔨 建造'); this._buildBtn.style.background = this._build ? '#FF9800' : '#4CAF50'; }
      if (this._communityBtn) {
        const ph = (this._build && this._palette) ? (this._palette.getBoundingClientRect().height || 74) : 0;
        this._communityBtn.style.left = 'auto';
        this._communityBtn.style.right = (Math.max(0, window.innerWidth - (r.left + r.width)) + 14) + 'px';
        this._communityBtn.style.bottom = (fromBottom + (this._build ? ph + 10 : 14) + 52) + 'px';
        this._communityBtn.textContent = en ? '🏘 Neighbors' : '🏘 邻居';
        this._communityBtn.style.display = (this._build || this._visit) ? 'none' : 'inline-flex';
      }
      if (this._hint) { this._hint.style.display = this._build ? 'block' : 'none'; this._hint.style.left = r.left + 'px'; this._hint.style.right = Math.max(0, window.innerWidth - (r.left + r.width)) + 'px'; this._hint.style.top = (r.top + 8) + 'px'; }
    },
    _refreshModeUI() {
      const terr = this._editMode === 'terrain', en = this._lang() === 'en';
      if (this._palBuild) this._palBuild.style.display = terr ? 'none' : 'flex';
      if (this._palTerrain) this._palTerrain.style.display = terr ? 'flex' : 'none';
      if (this._modeTabs) Array.from(this._modeTabs.children).forEach((t) => { const on = t.dataset.mode === this._editMode; t.style.background = on ? '#FF9800' : '#eee'; t.style.color = on ? '#fff' : '#777'; });
      if (this._palTerrain) Array.from(this._palTerrain.children).forEach((it) => { it.style.outline = (it.dataset.brush === this._brush) ? '3px solid #FF9800' : 'none'; });
      if (this._hint) { const s = this._hint.querySelector('span'); if (s) s.textContent = terr ? (en ? 'Tap / drag to paint terrain' : '点按或拖动涂刷地形（草地=擦除）') : (en ? ('✨ Charm ' + this._farmCharm() + ' · drag house, plot or deco · ✕ remove building (50% back)') : ('✨ 农场魅力 ' + this._farmCharm() + ' · 拖房子、菜地或装饰 · ✕ 拆除建筑退一半')); }
      this._layoutUI();
    },
    setEditMode(m) { this._editMode = m; this._sel = -1; this._moving = null; this._refreshModeUI(); this.render(); },
    setBrush(b) { this._brush = b; this._refreshModeUI(); },
    toggleBuild() {
      this._stickyEnd();   // 进出建造模式都算「打开面板」→ 退出粘性连续种植
      this._build = !this._build;
      if (this._build && Farm.state.data && !Farm.state.data.mapBuildSeen) { Farm.state.data.mapBuildSeen = true; Farm.state.save(); if (this._buildPulse) { this._buildPulse.cancel(); this._buildPulse = null; } }
      if (this._build && Farm.state.data && !Farm.state.data.mapMoveHintSeen) {
        Farm.state.data.mapMoveHintSeen = true;
        Farm.state.save();
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(this._lang() === 'en' ? 'Drag a building or plot to move it' : '拖动建筑或菜地即可调整位置', 3200);
      }
      if (this._build) {
        // Build mode goes FULLSCREEN: hide the bottom bars (Lv/XP, nav, install banner)
        // for max room; keep the top bar so the coin balance stays visible. Then zoom
        // out to show the whole farm + empty-land margin to drag into.
        this._savedView = { zoom: this._zoom, camX: this._camX, camY: this._camY };
        this._setChromeHidden(true); this._resize();
        this._buildFrame(); this._refreshPaletteAfford();
      } else {
        this._sel = -1; this._moving = null; this._painting = false; this._editMode = 'build'; Farm.state.save();
        this._setChromeHidden(false); this._resize();
        if (this._savedView) { this._zoom = this._savedView.zoom; this._camX = this._savedView.camX; this._camY = this._savedView.camY; this._savedView = null; this._clampCam(); }
      }
      this._refreshModeUI(); this._layoutUI(); this.render();
    },
    _setChromeHidden(hide) {
      ['statusbar', 'bottombar', 'pwaInstallBanner', 'harvestStatusBar', 'storekeeper'].forEach((id) => { const e = document.getElementById(id); if (e) e.style.display = hide ? 'none' : ''; });
      document.body.classList.toggle('iso-build-fullscreen', hide);
    },
    // Frame the whole farm (plots + buildings) with a generous empty margin → room to
    // move things around on a phone. Lower zoom than the tight play view.
    _buildFrame() {
      const plots = Farm.state.data.plots || []; let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;   // 屏幕轴范围（同 _autoFrame）
      const add = (gx, gy) => {
        minx = Math.min(minx, gx); miny = Math.min(miny, gy); maxx = Math.max(maxx, gx); maxy = Math.max(maxy, gy);
        const u = gx - gy, v = gx + gy;
        minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v);
      };
      for (let i = 0; i < plots.length; i++) add(this._plotGX(i), this._plotGY(i));
      (Farm.state.data.map || []).forEach((o) => { const b = BUILDINGS[o.type]; if (b) { add(o.gx, o.gy); add(o.gx + b.w - 1, o.gy + b.h - 1); } });
      if (minx === Infinity) { minx = 0; miny = 0; maxx = COLS - 1; maxy = ROWS - 1; add(0, 0); add(COLS - 1, ROWS - 1); add(COLS - 1, 0); add(0, ROWS - 1); }
      minx -= 2; miny -= 2; maxx += 2; maxy += 2;   // empty-land margin to drop things into
      const span = (maxx - minx) + (maxy - miny);
      const screenW = span * TW / 2, screenH = span * TH / 2 + TH * 3;
      // reserve ~38% of height for the palette tray so content frames into the top area
      this._zoom = Math.max(ZMIN, Math.min(this._cssW() / (screenW * 1.08), (this._cssH() * 0.62) / (screenH * 1.0)));
      const u = (minU + maxU) / 2, v = (minV + maxV) / 2;
      this._camX = u * this._tw() / 2;
      this._camY = this._oy + v * this._th() / 2 - this._cssH() * 0.34;   // push content up, above the palette
      this._clampCam();
    },

    // ---- render ----
    _blit(im, cx, by, maxW, maxH) { if (!im) return false; const s = Math.min(maxW / im.width, maxH / im.height), w = im.width * s, h = im.height * s; this._ctx.drawImage(im, cx - w / 2, by - h, w, h); return true; },
    _cropSprite(id) { return this._cropArtImg(id, 2); },
    _cropArtImg(id, stage) {
      const key = id + '_s' + stage;
      const c = this._cropImg[key]; if (c instanceof Image) return c; if (c === true || c === false) return null;
      let url = null;
      // 田里不用商店目录 PNG（整根萝卜/花盆栽），那种是贴纸。成熟也走 SVG，好埋进垄里。
      if (Farm.cropArt && Farm.cropArt.svg) {
        const svg = Farm.cropArt.svg(id, stage, 256, { bare: true, inBed: true });
        if (svg && svg.indexOf('<img') === -1) {
          url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        } else if (svg) {
          const m = svg.match(/src="([^"]+)"/);
          url = m ? m[1] : null;
        }
      }
      if (!url && stage >= 2 && Farm.cropArt && Farm.cropArt.spriteUrl) url = Farm.cropArt.spriteUrl(id);
      if (!url) { this._cropImg[key] = true; return null; }
      this._cropImg[key] = false;
      const im = new Image();
      im.onload = () => { this._cropImg[key] = im; if (this._on) this.render(); };
      im.onerror = () => { this._cropImg[key] = true; };
      im.src = url;
      return null;
    },
    // Lazy-load any map asset by file stem (e.g. 'crop_eggplant_2', 'animal_cat').
    _lazyImg(name) {
      const k = 'L_' + name, c = this._img[k];
      if (c instanceof Image) return c;
      if (c === 'loading' || c === 'failed') return null;   // 'failed' is sticky → no per-frame retry storm on a 404
      this._img[k] = 'loading';
      // WebP first (B4 perf). If a stem somehow lacks a .webp, fall back to the
      // retained .png once (not sticky-fail) so no crop/animal sprite vanishes.
      const im = new Image();
      im.onload = () => { this._img[k] = im; if (this._on) this.render(); };
      im.onerror = () => {
        if (!im._triedPng) { im._triedPng = true; im.src = ASSET_DIR + name + '.png'; return; }
        this._img[k] = 'failed';
      };
      im.src = ASSET_DIR + name + '.webp';
      return null;
    },
    _diamond(x, y, tw, th) { const c = this._ctx; c.beginPath(); this._diamondPath(x, y, tw, th); },
    _diamondPath(x, y, tw, th) { const c = this._ctx; c.moveTo(x, y - th / 2); c.lineTo(x + tw / 2, y); c.lineTo(x, y + th / 2); c.lineTo(x - tw / 2, y); c.closePath(); },
    // 宣传图里摊前站着的人：手绘小人，不用 emoji 头
    _drawVillager(x, y, th, opts) {
      const ctx = this._ctx, s = th * ((opts && opts.scale) || 1);
      const shirt = (opts && opts.shirt) || '#e07030';
      const pants = (opts && opts.pants) || '#3d4a6a';
      ctx.save();
      this._shadow(x, y + s * 0.06, s * 0.62, 0.16);
      ctx.fillStyle = pants;
      ctx.fillRect(x - s * 0.14, y - s * 0.40, s * 0.11, s * 0.40);
      ctx.fillRect(x + s * 0.03, y - s * 0.40, s * 0.11, s * 0.40);
      ctx.fillStyle = '#4a3420';
      ctx.beginPath(); ctx.ellipse(x - s * 0.09, y + s * 0.02, s * 0.09, s * 0.035, 0, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + s * 0.09, y + s * 0.02, s * 0.09, s * 0.035, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = shirt;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - s * 0.19, y - s * 0.86, s * 0.38, s * 0.50, s * 0.08);
      else ctx.rect(x - s * 0.19, y - s * 0.86, s * 0.38, s * 0.50);
      ctx.fill();
      ctx.fillStyle = '#f0c4a0';
      ctx.beginPath(); ctx.arc(x, y - s * 1.02, s * 0.155, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#3a2a1c';
      ctx.beginPath(); ctx.arc(x, y - s * 1.10, s * 0.155, Math.PI, 0); ctx.fill();
      ctx.restore();
    },
    // soft contact shadow under an object → grounds it (Hay-Day depth)
    _shadow(cx, cy, w, alpha) {
      const ctx = this._ctx; ctx.save(); ctx.beginPath();
      // 光从左上（与宣传图一致）→ 影子往右下拉长一点
      ctx.ellipse(cx + w * 0.16, cy + w * 0.05, w * 0.52, w * 0.20, 0.55, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(42,48,22,' + (alpha || 0.18) + ')'; ctx.fill(); ctx.restore();
    },
    // ---- world-anchored landscape backdrop (cx,cy are camera-adjusted, so it pans) ----
    _drawHills(cx, cy, span) {
      const ctx = this._ctx;
      // 3 layered soft humps, far→near (lighter/bluer = farther for haze depth)
      const layers = [
        { dy: -span * 0.06, h: span * 0.30, col: '#bcd9a8' },
        { dy: span * 0.02, h: span * 0.34, col: '#a6cf86' },
        { dy: span * 0.10, h: span * 0.40, col: '#8ec46a' },
      ];
      layers.forEach((L) => {
        ctx.fillStyle = L.col; ctx.beginPath();
        const left = cx - span * 1.1, right = cx + span * 1.1, base = cy + L.dy + L.h;
        ctx.moveTo(left, base);
        // a few rolling bumps via quadratic curves
        const bumps = 5, step = (right - left) / bumps;
        for (let i = 0; i < bumps; i++) {
          const x0 = left + i * step, peakY = cy + L.dy - (i % 2 ? L.h * 0.12 : 0);
          ctx.quadraticCurveTo(x0 + step * 0.5, peakY, x0 + step, base - (i % 2 ? 0 : L.h * 0.08));
        }
        ctx.lineTo(right, base + span); ctx.lineTo(left, base + span); ctx.closePath(); ctx.fill();
      });
    },
    _tree(x, y, s, flip) {
      const ctx = this._ctx;
      const im = this._img && this._img.tree;
      if (im && im.width) {
        const h = s * 1.85, w = h * (im.width / im.height);
        this._shadow(x + (flip ? -1 : 1) * s * 0.14, y + s * 0.05, s * 0.58, 0.16);
        if (flip) {
          ctx.save();
          ctx.translate(x, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(im, -w / 2, y - h + s * 0.08, w, h);
          ctx.restore();
        } else {
          ctx.drawImage(im, x - w / 2, y - h + s * 0.08, w, h);
        }
        return;
      }
      ctx.fillStyle = '#5a3a22';
      ctx.beginPath();
      ctx.moveTo(x - s * 0.07, y + s * 0.04);
      ctx.lineTo(x + s * 0.07, y + s * 0.04);
      ctx.lineTo(x + s * 0.045, y - s * 0.48);
      ctx.lineTo(x - s * 0.045, y - s * 0.48);
      ctx.closePath();
      ctx.fill();
      const blob = (dx, dy, rx, ry, col) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(x + dx, y - s * 0.72 + dy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      };
      blob(0, s * 0.08, s * 0.54, s * 0.48, '#3d7340');
      blob(-s * 0.26, s * 0.02, s * 0.38, s * 0.36, '#52964a');
      blob(s * 0.26, s * 0.04, s * 0.36, s * 0.34, '#4a8a42');
      blob(-s * 0.02, -s * 0.20, s * 0.34, s * 0.30, '#6aad52');
      blob(s * 0.12, -s * 0.12, s * 0.18, s * 0.16, 'rgba(255,220,140,0.28)');
    },
    _cypress(x, y, s) {
      const ctx = this._ctx;
      ctx.fillStyle = '#3d5c38';
      ctx.beginPath();
      ctx.ellipse(x, y - s * 0.95, s * 0.16, s * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a7a40';
      ctx.beginPath();
      ctx.ellipse(x - s * 0.04, y - s * 1.15, s * 0.10, s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
    },
    _tuft(x, y, s) {
      const ctx = this._ctx; ctx.fillStyle = '#74b252';
      for (let i = 0; i < 4; i++) { const dx = (i - 1.5) * s * 0.4; ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.lineTo(x + dx + s * 0.13, y - s); ctx.lineTo(x + dx - s * 0.13, y); ctx.closePath(); ctx.fill(); }
    },
    _flower(x, y, s) {
      this._tuft(x, y, s * 0.8); const ctx = this._ctx;
      const cols = ['#f6c945', '#ef7a7a', '#e88ad0', '#ffffff'], col = cols[Math.abs(Math.round(x * 0.7 + y)) % 4];
      ctx.fillStyle = col; for (let a = 0; a < 5; a++) { const an = a / 5 * 6.283; ctx.beginPath(); ctx.arc(x + Math.cos(an) * s * 0.2, y - s * 0.95 + Math.sin(an) * s * 0.2, s * 0.15, 0, 6.283); ctx.fill(); }
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(x, y - s * 0.95, s * 0.13, 0, 6.283); ctx.fill();
    },
    // 未开发农地 + 场外：油画树连成林。扩地后这片格变草地，树从缓存里消失。
    _drawWildWoods() {
      const tw = this._tw(), th = this._th(), W = this._cssW(), H = this._cssH();
      const ob = this._ownedBounds();
      const terr = this._terrain();
      const road = this._roadClearSet();
      const hl = this._cell(0, -3).y;
      const spots = this.NEIGHBOR_SPOTS || [];
      const corners = [this._screenToCell(0, 0), this._screenToCell(W, 0),
                       this._screenToCell(0, H), this._screenToCell(W, H)];
      let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
      for (const c of corners) {
        gx0 = Math.min(gx0, c.gx); gx1 = Math.max(gx1, c.gx);
        gy0 = Math.min(gy0, c.gy); gy1 = Math.max(gy1, c.gy);
      }
      gx0 = Math.max(-6, Math.floor(gx0) - 1); gy0 = Math.max(-4, Math.floor(gy0) - 1);
      gx1 = Math.min(COLS + 6, Math.ceil(gx1) + 1); gy1 = Math.min(ROWS + 8, Math.ceil(gy1) + 1);
      const list = [];
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          if (gx + gy < -2) continue;
          const inWorld = gx >= 0 && gy >= 0 && gx < COLS && gy < ROWS;
          const k = gx + ',' + gy;
          // 矩形地界 + 开垦格 + 已有菜地都不种树（否则新开的田还压着林子）
          if (inWorld && this._ownedCell(gx, gy)) continue;
          if (inWorld && this._cellToPlot && this._cellToPlot[k] != null) continue;
          // 油画构图：农场坐在开阔草甸上。地界外 2 格是草地；
          // 再往镜头前的围裙中央也不种树，两侧极疏留边角圆树。
          const apron = gy > ob.y2;
          const midX = (ob.x1 + ob.x2) / 2;
          const inRing = gx >= ob.x1 - 2 && gx <= ob.x2 + 2 && gy >= ob.y1 - 2 && gy <= ob.y2 + 2;
          if (inRing) continue;
          if (apron && Math.abs(gx - midX) < 6) continue;
          if (terr[k] === 'water' || terr[k] === 'path' || road[k]) continue;
          let nearNb = false;
          for (let i = 0; i < spots.length; i++) {
            const dx = gx - spots[i].gx, dy = gy - spots[i].gy;
            if (dx * dx + dy * dy < 2.6) { nearNb = true; break; }
          }
          if (nearNb) continue;
          const c = this._cell(gx, gy);
          if (c.x + tw * 2 < 0 || c.x - tw * 2 > W || c.y + th * 3 < 0 || c.y - th * 4 > H) continue;
          const dHl = (c.y - hl) / (th * 4.4);
          // 油画后山有疏树。原先 0.85 把中景整片裁掉，只剩地平线上三棵。
          if (dHl < 0.50) continue;
          const hsh = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
          const r1 = (hsh % 997) / 997, r2 = ((hsh >> 8) % 991) / 991;
          const clump = ((Math.floor(gx / 2) * 2654435761) ^ (Math.floor(gy / 2) * 1597334677)) >>> 0;
          if (!apron && (clump % 5) === 0) continue;
          const uphill = gy < ob.y1 - 1;
          const dens = apron ? 0.16 : (uphill ? 0.64 : (inWorld ? 0.55 : 0.78));
          if (r1 > dens) continue;
          list.push({ gx: gx, gy: gy, r1: r1, r2: r2, flip: (hsh & 1) === 0 });
        }
      }
      list.sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const c = this._cell(t.gx + (t.r1 - 0.5) * 0.62, t.gy + (t.r2 - 0.5) * 0.62);
        try { this._tree(c.x, c.y, tw * (0.62 + t.r2 * 0.95), t.flip); } catch (e) { /* 单棵失败不毁整场 */ }
      }
    },
    // scattered grass tufts + flowers around the farm (NOT on the plot block), world-anchored
    _drawMeadowTrees() {
      const tw = this._tw(), th = this._th();
      // 油画中景：田后山坡疏落圆树，尺寸不一。不进镜头前围裙中央。
      const spots = [
        { gx: -1.6, gy: 4.8, s: 0.72 },
        { gx: 15.2, gy: 2.4, s: 0.64 },
        { gx: 17.2, gy: 8.6, s: 0.78 },
        { gx: 13.6, gy: 13.4, s: 0.60 },
        { gx: 8.4, gy: -0.6, s: 0.50 },
        { gx: 2.2, gy: -1.1, s: 0.44 },
        { gx: 11.6, gy: 0.4, s: 0.42 },
        { gx: 0.6, gy: 3.4, s: 0.70 },
        { gx: 3.4, gy: 2.2, s: 0.52 },
        { gx: 6.0, gy: 3.8, s: 0.76 },
        { gx: 8.8, gy: 2.8, s: 0.46 },
        { gx: 11.4, gy: 4.4, s: 0.66 },
        { gx: 14.2, gy: 3.0, s: 0.58 },
        { gx: 16.8, gy: 4.6, s: 0.72 },
        { gx: -2.2, gy: 6.0, s: 0.54 },
        { gx: 1.8, gy: 6.2, s: 0.48 },
        { gx: 13.6, gy: 6.6, s: 0.50 },
        { gx: 4.6, gy: 5.2, s: 0.42 },
      ];
      for (const s of spots) {
        const igx = Math.round(s.gx), igy = Math.round(s.gy);
        if (igx >= 0 && igy >= 0 && this._ownedCell(igx, igy)) continue;
        const c = this._cell(s.gx, s.gy);
        this._shadow(c.x + tw * 0.18, c.y + th * 0.12, tw * 0.7 * s.s, 0.16);
        this._tree(c.x, c.y, tw * 1.2 * s.s);
      }
    },
    _drawMeadowDetail(cx, cy) {
      const tw = this._tw(), th = this._th();
      const P = [[-3.6, 2.5], [-3.1, 4.6], [-4.1, 0.8], [-2.2, 6.3], [-1.4, 7.4], [3.5, 1.8], [4.2, 3.6], [4.6, 0.4], [3.0, 6.0], [1.2, 7.3], [2.6, 7.6], [-3.0, 7.0]];
      P.forEach((o, i) => { const x = cx + o[0] * tw, y = cy + o[1] * th; if (i % 3 === 0) this._flower(x, y, tw * 0.22); else this._tuft(x, y, tw * 0.24); });
    },
    _drawTreeRow(cx, y, span) {
      // a row of trees along the horizon behind the farm (world-anchored → pans),
      // with a gentle up/down sway so it reads as a treeline, not a fence.
      const n = 11, tw = this._tw();
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = cx - span / 2 + span * t;
        const dy = Math.sin(t * 7.1) * this._th() * 0.5;        // stable wobble
        this._tree(x, y + dy, tw * (1.25 + (i % 3) * 0.3));
      }
    },
    // Clean procedural tilled-soil bed (replaces the muddy p_soil cube tile, which
    // tiled with dark seams). A flat inset diamond + furrows + a soft raised rim →
    // neat, distinct Hay-Day plots that tessellate seamlessly.
    // Empty-plot soil bed: a painted soil cube EXTRACTED from a crop sprite, so it
    // matches the crops' own baked soil exactly → every plot (empty or planted) is a
    // consistent raised tilled bed. Bottom-anchored like the crops so heights line up.
    _drawFurrowBed(c, gx, gy, kind) {
      // 独立木框苗床。kind: open | empty | locked
      // 锁地只留淡描边，不挖暗洞；可种的床是抬起的木箱+垄土。
      const ctx = this._ctx, tw = this._tw(), th = this._th();
      const locked = kind === 'locked';
      const empty = kind === 'empty';
      const scale = locked ? 0.58 : BED_W;
      const w = tw * scale, h = th * scale;
      const cy = c.y + th * 0.06;
      const hsh = ((((gx || 0) * 73856093) ^ ((gy || 0) * 19349663)) >>> 0);
      const tint = ((hsh % 17) - 8) / 8;
      const dz = th * (locked ? 0.08 : 0.28);
      const Lx = c.x - w / 2, Rx = c.x + w / 2, By = cy + h / 2;
      if (locked) {
        ctx.save();
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = 'rgba(150,118,70,0.70)';
        ctx.lineWidth = Math.max(0.9, th * 0.038);
        this._diamond(c.x, cy, w, h);
        ctx.stroke();
        ctx.restore();
        return;
      }
      ctx.save();
      ctx.globalAlpha = 0.24;
      ctx.fillStyle = '#2a180c';
      this._diamond(c.x + tw * 0.05, cy + th * 0.14 + dz * 0.35, w * 1.08, h * 1.12);
      ctx.fill();
      ctx.restore();
      // 前左木帮（暗）
      ctx.beginPath();
      ctx.moveTo(Lx, cy); ctx.lineTo(c.x, By); ctx.lineTo(c.x, By + dz); ctx.lineTo(Lx, cy + dz);
      ctx.closePath();
      const lg = ctx.createLinearGradient(Lx, cy, c.x, By + dz);
      lg.addColorStop(0, '#8a5628');
      lg.addColorStop(1, '#4e2e12');
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,20,8,0.38)';
      ctx.lineWidth = Math.max(0.7, th * 0.024);
      for (let i = 1; i <= 2; i++) {
        const t = i / 3;
        const x1 = Lx + (c.x - Lx) * t, y1 = cy + (By - cy) * t;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1, y1 + dz); ctx.stroke();
      }
      // 前右木帮（亮）
      ctx.beginPath();
      ctx.moveTo(Rx, cy); ctx.lineTo(c.x, By); ctx.lineTo(c.x, By + dz); ctx.lineTo(Rx, cy + dz);
      ctx.closePath();
      const rg = ctx.createLinearGradient(Rx, cy, c.x, By + dz);
      rg.addColorStop(0, '#d2a45e');
      rg.addColorStop(1, '#8a5524');
      ctx.fillStyle = rg;
      ctx.fill();
      ctx.strokeStyle = 'rgba(70,40,14,0.32)';
      for (let i = 1; i <= 2; i++) {
        const t = i / 3;
        const x1 = Rx + (c.x - Rx) * t, y1 = cy + (By - cy) * t;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1, y1 + dz); ctx.stroke();
      }
      // 木框顶沿
      this._diamond(c.x, cy, w, h);
      const wood = ctx.createLinearGradient(c.x - w * 0.4, cy - h * 0.4, c.x + w * 0.25, cy + h * 0.4);
      wood.addColorStop(0, '#e0bc7a');
      wood.addColorStop(0.5, '#c08a48');
      wood.addColorStop(1, '#8d5726');
      ctx.fillStyle = wood;
      ctx.fill();
      ctx.strokeStyle = 'rgba(70,40,14,0.45)';
      ctx.lineWidth = Math.max(0.8, th * 0.03);
      this._diamond(c.x, cy, w, h);
      ctx.stroke();
      // 框内垄土（略内收，露出一圈木沿）
      const iw = w * 0.78, ih = h * 0.76;
      this._diamond(c.x, cy + th * 0.01, iw, ih);
      const r0 = Math.round((empty ? 176 : 164) + tint * 10);
      const g0 = Math.round((empty ? 112 : 100) + tint * 6);
      const b0 = Math.round(56 + tint * 4);
      const r1 = Math.round(86 + tint * 6), g1 = Math.round(50 + tint * 4), b1 = 22;
      const soil = ctx.createLinearGradient(c.x - iw * 0.4, cy - ih * 0.3, c.x + iw * 0.25, cy + ih * 0.4);
      soil.addColorStop(0, 'rgb(' + r0 + ',' + g0 + ',' + b0 + ')');
      soil.addColorStop(0.5, 'rgb(' + Math.round((r0 + r1) / 2) + ',' + Math.round((g0 + g1) / 2) + ',' + Math.round((b0 + b1) / 2) + ')');
      soil.addColorStop(1, 'rgb(' + r1 + ',' + g1 + ',' + b1 + ')');
      ctx.fillStyle = soil;
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      this._diamond(c.x, cy + th * 0.01, iw * 0.96, ih * 0.94);
      ctx.clip();
      ctx.strokeStyle = 'rgba(48,24,10,0.36)';
      ctx.lineWidth = Math.max(1, th * 0.058);
      ctx.lineCap = 'round';
      const slope = th / tw;
      const spacing = th * (0.17 + (hsh % 5) * 0.01);
      const phase = ((hsh >> 6) % 7) * th * 0.02;
      const bBase = Math.round((cy - slope * c.x + phase) / spacing) * spacing;
      for (let k = -5; k <= 5; k++) {
        const b = bBase + k * spacing;
        const x1 = c.x - iw * 0.55, x2 = c.x + iw * 0.55;
        const wob = Math.sin(k * 1.4 + (gx || 0) * 0.7) * th * 0.018;
        ctx.beginPath();
        ctx.moveTo(x1, slope * x1 + b);
        ctx.quadraticCurveTo(c.x, slope * c.x + b + wob, x2, slope * x2 + b);
        ctx.stroke();
      }
      if (empty) {
        ctx.fillStyle = 'rgba(48, 28, 12, 0.28)';
        ctx.beginPath();
        ctx.ellipse(c.x, cy + th * 0.02, iw * 0.16, ih * 0.14, 0, 0, 6.283);
        ctx.fill();
        ctx.strokeStyle = 'rgba(74,108,42,0.42)';
        ctx.lineWidth = Math.max(0.7, tw * 0.015);
        for (let i = 0; i < 3; i++) {
          const a = (c.x * 0.11 + c.y * 0.07 + i * 1.9 + (gx || 0));
          const bx = c.x + Math.cos(a) * iw * 0.18;
          const by = cy + Math.sin(a * 1.2) * ih * 0.16;
          ctx.beginPath();
          ctx.moveTo(bx, by + th * 0.03);
          ctx.quadraticCurveTo(bx + tw * 0.02, by - th * 0.05, bx + tw * 0.03, by - th * 0.10);
          ctx.stroke();
        }
      }
      ctx.restore();
    },
    // 可种的床坐在一小片暖土草甸上，箱子不像扔在高尔夫草坪。
    // 只用已解锁地块的外包，锁地不扩这片土，避免又连成整田。
    _drawGardenPatch() {
      const plots = Farm.state.data.plots || [];
      const pts = [];
      for (let i = 0; i < plots.length; i++) {
        if (!plots[i] || !plots[i].unlocked) continue;
        const pp = this._plotPos(i);
        pts.push(this._cell(pp.gx, pp.gy));
      }
      if (!pts.length) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const tw = this._tw(), th = this._th(), ctx = this._ctx;
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2 + th * 0.08;
      const rx = (maxX - minX) / 2 + tw * 0.92;
      const ry = (maxY - minY) / 2 + th * 0.95;
      ctx.save();
      ctx.fillStyle = 'rgba(62, 42, 16, 0.12)';
      ctx.beginPath();
      ctx.ellipse(cx + tw * 0.06, cy + th * 0.22, rx * 1.04, ry * 1.08, -0.12, 0, 6.283);
      ctx.fill();
      const g = ctx.createRadialGradient(cx - rx * 0.2, cy - ry * 0.25, th * 0.2, cx, cy, Math.max(rx, ry) * 1.15);
      g.addColorStop(0, 'rgba(154, 118, 48, 0.44)');
      g.addColorStop(0.48, 'rgba(138, 122, 46, 0.22)');
      g.addColorStop(1, 'rgba(132, 128, 48, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, -0.12, 0, 6.283);
      ctx.fill();
      ctx.strokeStyle = 'rgba(196, 154, 78, 0.32)';
      ctx.lineWidth = Math.max(0.6, th * 0.026);
      ctx.lineCap = 'round';
      const nStraw = 10 + pts.length * 2;
      for (let i = 0; i < nStraw; i++) {
        const a = i * 2.31 + 0.4;
        const r = 0.22 + (i % 7) * 0.09;
        const x = cx + Math.cos(a) * rx * r;
        const y = cy + Math.sin(a * 1.15) * ry * r;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + tw * (0.05 + (i % 3) * 0.02), y + th * 0.035);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(150, 132, 96, 0.45)';
      for (let i = 0; i < 5; i++) {
        const a = i * 1.7 + 0.8;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * rx * 0.62, cy + Math.sin(a) * ry * 0.55, tw * 0.035, th * 0.022, a, 0, 6.283);
        ctx.fill();
      }
      const edge = [
        [cx - rx * 0.82, cy + ry * 0.15],
        [cx + rx * 0.78, cy + ry * 0.22],
        [cx - rx * 0.15, cy + ry * 0.88],
        [cx + rx * 0.28, cy - ry * 0.72],
      ];
      for (let i = 0; i < edge.length; i++) {
        if (i % 2 === 0) this._flower(edge[i][0], edge[i][1], tw * 0.18);
        else this._tuft(edge[i][0], edge[i][1], tw * 0.22);
      }
      ctx.restore();
    },
    // 每块菜地单独一张床，中间露草。不再合成一整片土。
    _drawUnifiedField() {
      const plots = Farm.state.data.plots || [];
      if (!plots.length) return;
      const list = [];
      for (let i = 0; i < plots.length; i++) {
        if (!plots[i]) continue;
        const pp = this._plotPos(i);
        list.push({ i: i, gx: pp.gx, gy: pp.gy, p: plots[i] });
      }
      list.sort((a, b) => (a.gx + a.gy) - (b.gx + b.gy));
      for (let n = 0; n < list.length; n++) {
        const o = list[n];
        const kind = !o.p.unlocked ? 'locked' : (o.p.crop ? 'open' : 'empty');
        this._drawFurrowBed(this._cell(o.gx, o.gy), o.gx, o.gy, kind);
      }
    },
    _tilledDiamond(cx, cy) {
      const im = this._img.plot_bed, ctx = this._ctx, tw = this._tw(), th = this._th();
      if (im && im.width) { const w = tw * 1.04, s = w / im.width, hh = im.height * s; ctx.drawImage(im, cx - w / 2, cy + th * 0.6 - hh, w, hh); return; }
      this._diamond(cx, cy, tw, th); ctx.fillStyle = '#a9743f'; ctx.fill();
    },
    // Draw a painted cube ground tile centered on cell c (diamond width = TW,
    // ~2% overlap to hide seams), or a flat-diamond fallback while it loads.
    _tileImg(key, c) {
      const ctx = this._ctx, tw = this._tw(), th = this._th();
      // grass & soil = flat 1:1 diamond images, squished to the 2:1 cell and centered
      // → they tessellate edge-to-edge into a clean continuous field (no cube skirts /
      // black "boards" / quilt). overlap a hair to hide anti-aliased seams.
      if (key === 'grass') return;   // grass = the smooth solid base fill (drawn in render); no per-tile quilt
      if (key === 'soil') {
        this._drawFurrowBed(c);
        return;
      }
      // path / water = FLAT diamonds matching the flat ground (no raised cube → no
      // clash with the green field). Subtle detail keeps them readable.
      if (key === 'water' || key === 'path') {
        const w = tw * 1.04, h = th * 1.04;
        this._diamond(c.x, c.y, w, h);
        if (key === 'water') {
          const g = ctx.createLinearGradient(c.x, c.y - h / 2, c.x, c.y + h / 2); g.addColorStop(0, '#86c8e8'); g.addColorStop(1, '#4f9fc9');
          ctx.fillStyle = g; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = Math.max(1, th * 0.05);
          ctx.beginPath(); ctx.moveTo(c.x - w * 0.16, c.y - th * 0.05); ctx.quadraticCurveTo(c.x, c.y - th * 0.12, c.x + w * 0.16, c.y - th * 0.05); ctx.stroke();
        } else {
          ctx.fillStyle = '#c08e54'; ctx.fill();
          ctx.fillStyle = 'rgba(110,78,42,0.45)';
          for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283; ctx.beginPath(); ctx.arc(c.x + Math.cos(a) * w * 0.22, c.y + Math.sin(a) * h * 0.22, Math.max(1.2, th * 0.06), 0, 6.283); ctx.fill(); }
        }
        return;
      }
      this._diamond(c.x, c.y, tw, th);
      ctx.fillStyle = GRASS_A; ctx.fill();
    },
    // 所有水格合成一汪溪/塘。只 fill 重叠椭圆，绝不 stroke 每格轮廓
    // （描边会在融合处画出白线圈，截图实证）。
    _drawPond(cells) {
      if (!cells || !cells.length) return;
      const ctx = this._ctx, tw = this._tw(), th = this._th();
      const oy = th * 0.10, t = Date.now() / 1000;
      let cxp = 0, cyp = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      let minGx = Infinity;
      for (const c of cells) {
        cxp += c.x; cyp += c.y;
        if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y; if (c.y > maxY) maxY = c.y;
        if (c.gx != null && c.gx < minGx) minGx = c.gx;
      }
      cxp /= cells.length; cyp /= cells.length;
      const leftCreek = minGx <= 1;
      const body = (sx, sy) => {
        ctx.beginPath();
        if (leftCreek) {
          for (const c of cells) {
            ctx.ellipse(c.x, c.y + oy, tw * 0.92 * sx, th * 0.76 * sy, -0.38, 0, 6.283);
          }
          ctx.ellipse(minX - tw * 0.50, cyp + oy + th * 0.16, tw * 1.08 * sx, th * 0.66 * sy, -0.5, 0, 6.283);
        } else {
          // 场中塘：一块微起伏的湖，避免五格叠成三叶草、漫到谷仓
          const rx = ((maxX - minX) / 2 + tw * 0.62) * sx;
          const ry = ((maxY - minY) / 2 + th * 0.42) * sy;
          const cyb = cyp + oy;
          const N = 20;
          for (let i = 0; i <= N; i++) {
            const a = (i / N) * 6.283 - 0.32;
            const wob = 0.94 + 0.06 * Math.sin(a * 2.4 + 0.8);
            const x = cxp + Math.cos(a) * rx * wob;
            const y = cyb + Math.sin(a) * ry * wob;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
      };
      ctx.save();
      // 暖土岸：比水面略大的填色，不描边
      ctx.save();
      ctx.shadowColor = 'rgba(40,52,22,0.28)'; ctx.shadowBlur = th * 0.45; ctx.shadowOffsetY = th * 0.12;
      ctx.fillStyle = '#6e7a3c';
      body(1.08, 1.12); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#8a7a48';
      ctx.globalAlpha = 0.28;
      body(1.04, 1.06); ctx.fill();
      ctx.globalAlpha = 1;
      // 青蓝水面（整汪同一渐变，倒映暖天）
      ctx.save();
      body(1, 1); ctx.clip();
      const g = ctx.createLinearGradient(0, minY - th, 0, maxY + th);
      g.addColorStop(0, '#b8dce8');
      g.addColorStop(0.28, '#5aa8c4');
      g.addColorStop(0.68, '#2d7a94');
      g.addColorStop(1, '#1d5468');
      ctx.fillStyle = g;
      ctx.fillRect(minX - tw * 1.4, minY - th * 1.4, (maxX - minX) + tw * 2.8, (maxY - minY) + th * 2.8);
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#e8f4dc';
      ctx.beginPath();
      ctx.ellipse(cxp - tw * 0.12, cyp + oy - th * 0.06, tw * 0.38, th * 0.12, -0.45, 0, 6.283);
      ctx.fill();
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = '#eef8f2';
      ctx.lineWidth = Math.max(1, th * 0.035);
      ctx.lineCap = 'round';
      const wob = Math.sin(t * 1.3) * th * 0.03;
      ctx.beginPath();
      ctx.moveTo(cxp - tw * 0.28, cyp + oy + wob);
      ctx.quadraticCurveTo(cxp, cyp + oy - th * 0.06 + wob, cxp + tw * 0.26, cyp + oy + wob * 0.5);
      ctx.stroke();
      const spark = 0.5 + 0.5 * Math.sin(t * 1.7);
      if (spark > 0.72) {
        ctx.globalAlpha = (spark - 0.72) / 0.28 * 0.45;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(cxp + tw * 0.08, cyp + oy - th * 0.03, tw * 0.028, th * 0.016, 0.4, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();
      ctx.restore();
    },
    _startLoop() {
      const loop = () => {
        this._raf = requestAnimationFrame(loop);
        if (!this._on || document.hidden) return;
        const modal = document.getElementById('modal'); if (modal && !modal.classList.contains('hidden')) return;
        const now = Date.now(); if (now - this._lastFrame < 33) return; this._lastFrame = now; this.render();  // ~30fps for smooth pet walking
      };
      this._raf = requestAnimationFrame(loop);
    },
    // Render the static landscape backdrop into `this._ctx` (which _blitBackdrop
    // temporarily points at the offscreen cache canvas).
    _drawBackdrop(W, H) {
      const ctx = this._ctx, tw = this._tw(), th = this._th();
      // 金色黄昏天空（对齐 2026-08-15 宣传插画）：上暖下金，草地再盖住下半。
      const base = ctx.createLinearGradient(0, 0, 0, H);
      base.addColorStop(0, '#f4a888');
      base.addColorStop(0.20, '#f6b890');
      base.addColorStop(0.42, '#f3c89a');
      base.addColorStop(0.64, '#d4c878');
      base.addColorStop(1, '#9ab04a');
      ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
      // 左上太阳：柔光晕，不画硬边日轮（避免像贴纸）
      const sun = ctx.createRadialGradient(W * 0.16, H * 0.07, 0, W * 0.16, H * 0.07, Math.max(W, H) * 0.55);
      sun.addColorStop(0, 'rgba(255,236,190,0.72)');
      sun.addColorStop(0.18, 'rgba(255,206,130,0.28)');
      sun.addColorStop(1, 'rgba(255,180,90,0)');
      ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,242,210,0.95)';
      ctx.beginPath();
      ctx.arc(W * 0.16, H * 0.075, Math.max(7, this._th() * 0.48), 0, 6.283);
      ctx.fill();
      this._drawSkyClouds(W, H);

      /* 🔒 程序化世界(2026-08-14 Chris:「怎样使地形真正跟农场物件融合,
         不受画面缩放影响, 大型游戏是怎么做到的」):
         Hay Day/Township 的答案是**世界里没有"背景图"** —— 天空/远山/草地/
         道路/建筑全部活在同一套世界坐标里, 随镜头一起变换, 所以永远严丝合缝、
         任何缩放都清晰(程序化 = 每帧按设备像素重画, 天生矢量)。
         照片方案的两宗罪: 不懂格子(贴合只能"差不多")、放大就糊(1600px 位图)。
         USE_PAINTED_BG=true 可一键回滚旧照片背景(资产仍在)。 */
      const bg = USE_PAINTED_BG ? this._img.hd_bg : null;
      if (bg && bg.width) {
        // WORLD-LOCKED backdrop (Chris 2026-06-18: "先把背景图定好坐标-对应农场坐标和
        // 尺寸"). Anchored to a fixed WORLD cell via _cell() (which carries pan + zoom),
        // so it pans AND zooms 1:1 with the farm — the farm always sits on the same patch
        // of meadow, and it never "floats to the sky" on zoom-out (scale tracks _zoom with
        // NO floor). Base size = cover-the-canvas at the reference zoom, so at normal zoom
        // the photo fully covers (no flat base band at the edges); clamped to the canvas
        // while it's ≥ canvas, centred (base shows around) only when zoomed far out.
        // PURE world-anchor — NO clamp. The image's meadow focal (BG_FX,BG_FY) is pinned
        // to world cell (BG_ANCHOR) which moves with pan+zoom, so the farm ALWAYS sits on
        // the meadow (a clamp here was decoupling them → farm floated off the meadow). At
        // the default framed zoom dh≈1.2×H with the meadow at the farm (~64% screen), so it
        // fully covers; zooming out lets it shrink with the farm → reveals the panorama.
        const a = this._cellBg(BG_ANCHOR_GX, BG_ANCHOR_GY);
        const scale = Math.max(W / bg.width, H / bg.height) * Math.max(1, this._zoom / BG_ZOOM_REF);
        const dw = bg.width * scale, dh = bg.height * scale;
        ctx.drawImage(bg, a.x - BG_FX * dw, a.y - BG_FY * dh, dw, dh);
      } else {
        // 程序化地平线: 远山两叠 + 云杉林剪影 + 薄雾, 世界锚定(随缩放/平移一致)
        this._drawHorizon(W, H);
      }
      // 🔒 矢量地面层(2026-08-14 Chris:「农场农地跟地图需要完美贴合适配」):
      // 背景画是固定视角的手绘风景, 没有格子概念 —— 农地跟它贴合永远是
      // 「差不多」。这一层用**与农地同一套 _cell()/_tw() 坐标**把整个
      // 16×16 可开发世界画成半透明草格(条带+色斑+草簇), 贴合是构造上
      // 保证的; 扩地解锁的远处土地也由它呈现(_bgKey 在解锁时已置空重画)。
      const fit = this._drawGroundPlane(W, H);
      this._drawWildWoods();
      this._drawMeadowTrees();
      this._drawHorizonMist(W, H);
      /* 人烟三件套(2026-08-14 Chris:「农场看起来像荒山野岭, 路人的出现
         会有点奇怪」)—— 给路人一个来处, 给农场一个社区:
         ① 乡间土路: 从世界东南边缘蜿蜒通到农场路口(路人就是沿它走来的)
         ② 路口道具: 木指路牌 + 红邮箱(有地址 = 有人住)
         ③ 远处邻居: 两户带炊烟的小屋剪影(不是独居荒野)
         全部画进相机缓存, 30fps 帧零成本; 位置世界锚定, 跟地形采样联动。 */
      this._drawCountryRoad(fit);
      this._drawFarNeighbors(fit);
    },
    /* 乡路锚点(格子坐标, 世界锚定) —— 2026-08-14 动态化:
       Chris:「土路要从菜摊前面过; 我移动物件后你根据我的摆放来布置设施」。
       A = 东南场外入口(固定) → B = **菜摊正前方**(跟着摊走) → C = 向左前
       延伸收尾。玩家在建造模式把摊拖到哪, 路/邮箱/指路牌/行人就跟到哪
       (_blitBackdrop 缓存键含摊位坐标, 挪完即重画)。 */
    _roadAnchors() {
      const map = Farm.state.data.map || [];
      const st = map.find((m) => m && m.type === 'house');
      const B = st ? { x: st.gx + 0.7, y: st.gy + 2.5 } : { x: 5.7, y: 4.6 };
      // 2026-08-15 Chris:「菜摊前的路应该一直延伸, 不能断了」——
      // 两端都伸到世界之外(A 东端 24 格外, C 西端 B-15 格), 任何摊位位置/
      // 缩放下路都是「从远方来、往远方去」的过路道, 不会断在草地里。
      const A = { x: COLS + 4, y: 9.8 };
      const C = { x: B.x - 15.0, y: B.y + 3.4 };
      return { A, B, C };
    },
    _roadWorld(t) {
      const { A, B, C } = this._roadAnchors();
      const q = (P, Q, ctl, tt) => {
        const u = 1 - tt;
        return { gx: u * u * P.x + 2 * u * tt * ctl.x + tt * tt * Q.x,
                 gy: u * u * P.y + 2 * u * tt * ctl.y + tt * tt * Q.y };
      };
      if (t < 0.72) {
        const ctl = { x: (A.x + B.x) / 2 + 0.8, y: Math.max(A.y, B.y) + 1.0 };
        return q(A, B, ctl, t / 0.72);
      }
      const ctl = { x: (B.x + C.x) / 2, y: B.y + 0.7 };
      return q(B, C, ctl, (t - 0.72) / 0.28);
    },
    _roadPoint(t) {
      const g = this._roadWorld(t);
      return this._cell(g.gx, g.gy);
    },
    _roadClearSet() {
      // 路两侧各约 1 格不种树，乡路从林子里穿出来
      const s = {};
      for (let i = 0; i <= 48; i++) {
        const p = this._roadWorld(i / 48);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx * dx + dy * dy > 1.2) continue;
            s[Math.round(p.gx + dx) + ',' + Math.round(p.gy + dy)] = 1;
          }
        }
      }
      return s;
    },
    _roadCenterSet() {
      const s = {};
      for (let i = 0; i <= 48; i++) {
        const p = this._roadWorld(i / 48);
        s[Math.round(p.gx) + ',' + Math.round(p.gy)] = 1;
      }
      return s;
    },
    // 乡路路心：建筑/水塘/菜地/装饰都不能占。缓存跟摊位走。
    _roadSet() {
      const st = (Farm.state.data.map || []).find((m) => m && m.type === 'house');
      const key = st ? (st.gx + ',' + st.gy) : '-';
      if (this._roadSetKey === key && this._roadSetCache) return this._roadSetCache;
      this._roadSetKey = key;
      this._roadSetCache = this._roadCenterSet();
      return this._roadSetCache;
    },
    _onRoad(gx, gy) { return !!this._roadSet()[gx + ',' + gy]; },
    _drawRoadSurface(fit) {
      const ctx = this._ctx, tw = this._tw();
      const N = 46;
      const passes = [
        { w: tw * 0.82, col: 'rgba(86,122,48,0.28)', off: 0 },
        { w: tw * 0.58, col: 'rgba(168,128,78,0.86)', off: 0 },
        { w: tw * 0.42, col: 'rgba(214,176,118,0.94)', off: 0 },
        { w: tw * 0.05, col: 'rgba(110,82,48,0.55)', off: tw * 0.10 },
        { w: tw * 0.05, col: 'rgba(110,82,48,0.55)', off: -tw * 0.10 },
      ];
      for (const ps of passes) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = ps.col; ctx.lineWidth = ps.w;
        let prev = null;
        for (let i = 0; i <= N; i++) {
          const t = i / N, pt = this._roadPoint(t);
          const a = Math.min(1, t / 0.10) * (fit ? Math.max(0, Math.min(1, fit(pt.x, pt.y) * 1.6)) : 1);
          const p2 = { x: pt.x, y: pt.y + ps.off };
          if (prev && a > 0.04) {
            ctx.globalAlpha = a;
            ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          }
          prev = p2;
        }
      }
      ctx.globalAlpha = 1;
    },
    _drawCountryRoad(fit) {
      const tw = this._tw(), th = this._th();
      this._drawRoadSurface(fit);
      // 路口道具: 指路牌立在路中段的路边(路尽头会被菜摊挡住——截图实证);
      // 红邮箱挂在摊正前偏右(跟着摊走)。
      const mid = this._roadPoint(0.50);
      this._drawSignpost(mid.x + tw * 0.42, mid.y - th * 0.10);
      const map2 = Farm.state.data.map || [];
      const st2 = map2.find((m) => m && m.type === 'house');
      if (st2) {
        const mb = this._cell(st2.gx + 2.35, st2.gy + 1.7);
        this._drawMailbox(mb.x, mb.y);
      }
    },
    /* 天上偶尔飞过一对鸟(2026-08-14 打磨): 每 1.5-4 分钟一对, 约 18 秒横穿
       天际线上方。两道小弧线 + 翅膀扑闪(scaleY 振荡), 纯手绘, 活帧才画。 */
    _drawBirds() {
      if (this._build || this._visit) return;
      const now = Date.now();
      if (!this._birdsNextAt) this._birdsNextAt = now + 45e3;
      if (!this._birds && now >= this._birdsNextAt) {
        this._birds = { start: now, dur: 18e3, dir: Math.random() < 0.5 ? 1 : -1,
                        yFrac: 0.10 + Math.random() * 0.14 };
      }
      if (!this._birds) return;
      const p = (now - this._birds.start) / this._birds.dur;
      if (p >= 1) { this._birds = null; this._birdsNextAt = now + (90 + Math.random() * 150) * 1e3; return; }
      const W = this._cssW(), H = this._cssH(), th = this._th(), ctx = this._ctx;
      const x0 = this._birds.dir > 0 ? -30 : W + 30;
      const x1 = this._birds.dir > 0 ? W + 30 : -30;
      const bx = x0 + (x1 - x0) * p;
      const byy = H * this._birds.yFrac + Math.sin(p * 6.28 * 2) * th * 0.5;
      const flap = Math.sin(now / 110) * 0.55 + 0.75;   // 0.2..1.3 翅膀开合
      ctx.save();
      ctx.strokeStyle = 'rgba(70,90,75,0.75)';
      ctx.lineWidth = Math.max(1, th * 0.06);
      ctx.lineCap = 'round';
      const bird = (cx, cy, sc) => {
        ctx.beginPath();
        ctx.moveTo(cx - th * 0.28 * sc, cy - th * 0.16 * sc * flap);
        ctx.quadraticCurveTo(cx - th * 0.10 * sc, cy + th * 0.06 * sc, cx, cy);
        ctx.quadraticCurveTo(cx + th * 0.10 * sc, cy + th * 0.06 * sc, cx + th * 0.28 * sc, cy - th * 0.16 * sc * flap);
        ctx.stroke();
      };
      bird(bx, byy, 1);
      bird(bx - th * 0.9 * this._birds.dir, byy + th * 0.35, 0.75);
      ctx.restore();
    },

    /* 沿路散步的邻居: 每 2-5 分钟一位, 花约 26 秒沿乡路走完(方向随机)。
       不落存档、不进缓存 —— 活的帧才画, 一个 emoji 的成本。
       它回答的是「路人从哪来」: 你先看见有人沿路走, 之后摊前才有人买菜。 */
    _drawRoadWalker() {
      if (this._build || this._visit) return;
      const now = Date.now();
      if (!this._walkerNextAt) this._walkerNextAt = now + 30e3;   // 进图 30 秒后来第一位
      if (!this._walker && now >= this._walkerNextAt) {
        const shirts = ['#e07030', '#4a8c5c', '#c45a4a', '#d4a04a'];
        this._walker = { start: now, dur: 26e3, dir: Math.random() < 0.5 ? 1 : -1,
                         shirt: shirts[Math.floor(Math.random() * shirts.length)] };
      }
      if (!this._walker) return;
      let p = (now - this._walker.start) / this._walker.dur;
      if (p >= 1) { this._walker = null; this._walkerNextAt = now + (120 + Math.random() * 180) * 1e3; return; }
      if (this._walker.dir < 0) p = 1 - p;
      const pt = this._roadPoint(0.30 + p * 0.50);
      const th = this._th(), bob = Math.abs(Math.sin(now / 160)) * th * 0.06;
      const ctx = this._ctx;
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.min(p, 1 - p) * 12 + 0.15);
      this._drawVillager(pt.x, pt.y + th * 0.08 - bob, th, { scale: 0.82, shirt: this._walker.shirt });
      ctx.restore();
    },

    _drawSignpost(x, y) {
      const ctx = this._ctx, th = this._th(), h = th * 1.7;
      if (h < 12) return;
      ctx.save();
      ctx.strokeStyle = '#7a5a34'; ctx.lineWidth = Math.max(1.4, th * 0.09); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
      const bw = th * 1.15, bh = th * 0.34;
      const board = (yy, col) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.moveTo(x - bw * 0.62, yy - bh / 2); ctx.lineTo(x + bw * 0.30, yy - bh / 2);
        ctx.lineTo(x + bw * 0.30, yy + bh / 2); ctx.lineTo(x - bw * 0.62, yy + bh / 2);
        ctx.lineTo(x - bw * 0.80, yy); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(90,64,34,0.75)'; ctx.lineWidth = Math.max(0.8, th * 0.035); ctx.stroke();
      };
      board(y - h * 0.82, '#5f9e50');
      board(y - h * 0.52, '#c9a76b');
      ctx.restore();
    },
    _drawMailbox(x, y) {
      const ctx = this._ctx, th = this._th();
      if (th < 9) return;
      ctx.save();
      ctx.strokeStyle = '#7a5a34'; ctx.lineWidth = Math.max(1.2, th * 0.075); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - th * 0.85); ctx.stroke();
      const bw = th * 0.62, bh = th * 0.42, by2 = y - th * 0.85;
      ctx.fillStyle = '#c44536';
      ctx.beginPath();
      ctx.moveTo(x - bw / 2, by2); ctx.lineTo(x - bw / 2, by2 - bh * 0.55);
      ctx.arc(x - bw / 2 + bw * 0.5, by2 - bh * 0.55, bw / 2, Math.PI, 0);
      ctx.lineTo(x + bw / 2, by2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(90,40,30,0.7)'; ctx.lineWidth = Math.max(0.7, th * 0.03); ctx.stroke();
      ctx.fillStyle = '#f2c34a';
      ctx.fillRect(x + bw * 0.32, by2 - bh * 1.35, th * 0.09, th * 0.42);
      ctx.restore();
    },
    /* 远处的邻居农场(2026-08-14 升级为真实玩家):
       Chris:「能否各玩家的农场都有独立空间物理上不重叠, 从一个农场看到远处
       其他农场?」—— 第一阶段: 把**真实邻居**(farm_players, 与社区页同一数据源)
       摆在你世界的地平线上, 各占一个固定方位(uid 决定, 稳定不跳), 屋下挂
       名牌+等级, 点小屋 → 打开社区页拜访。真正的共享世界坐标(物理不重叠的
       区域地图)是第二阶段, 需要服务端坐标注册表, 见 roadmap。 */
    NEIGHBOR_SPOTS: [
      { gx: 6, gy: 24 }, { gx: 12, gy: 23 }, { gx: 18, gy: 24 },
      { gx: 3, gy: 23 }, { gx: 22, gy: 23 }, { gx: 9, gy: 25 },
      { gx: 15, gy: 25 }, { gx: 24, gy: 24 },
    ],
    _loadDistantFarms() {
      const now = Date.now();
      if (this._distantAt && now - this._distantAt < 60000) return;
      this._distantAt = now;
      const tryFetch = () => {
        if (!(Farm.neighbors && Farm.neighbors._fetchToday)) { setTimeout(tryFetch, 4000); return; }
        Farm.neighbors._fetchToday().then((list) => {
          this._distantFarms = (list || []).slice(0, this.NEIGHBOR_SPOTS.length)
            .map((n) => ({
              name: n.name || null,
              level: n.level || 1, emoji: n.emoji, _n: n,
            }));
          this._bgKey = null;
          if (this._on) this.render();
        }).catch(() => {});
      };
      tryFetch();
    },
    _drawFarNeighbors(fit) {
      if (this._visit) { this._neighborHits = []; return; }
      this._loadDistantFarms();
      const farms = this._distantFarms;
      const th = this._th(), ctx = this._ctx;
      this._neighborHits = [];
      for (let i = 0; i < this.NEIGHBOR_SPOTS.length; i++) {
        const sp = this.NEIGHBOR_SPOTS[i];
        const nb = farms && farms[i];
        if (!nb) continue;
        const c = this._cell(sp.gx, sp.gy);
        this._drawTinyCottage(c.x, c.y);
        this._neighborHits.push({ x: c.x, y: c.y - th * 0.5, r: th * 1.5 });
        if (nb && nb.name && th > 10) {            // 名牌: 只挂有昵称的; 太小不挤
          const label = nb.emoji + ' ' + nb.name + ' · Lv' + nb.level;
          const fs3 = Math.max(8, th * 0.42);
          ctx.save();
          ctx.font = '600 ' + fs3 + 'px "Noto Sans SC",sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const wl = ctx.measureText(label).width + fs3 * 1.1;
          const ly = c.y + th * 0.55;
          ctx.globalAlpha = 0.88;
          ctx.fillStyle = 'rgba(255,252,242,0.92)';
          ctx.beginPath();
          const rr3 = fs3 * 0.65;
          ctx.moveTo(c.x - wl / 2 + rr3, ly - fs3 * 0.75);
          ctx.arcTo(c.x + wl / 2, ly - fs3 * 0.75, c.x + wl / 2, ly + fs3 * 0.75, rr3);
          ctx.arcTo(c.x + wl / 2, ly + fs3 * 0.75, c.x - wl / 2, ly + fs3 * 0.75, rr3);
          ctx.arcTo(c.x - wl / 2, ly + fs3 * 0.75, c.x - wl / 2, ly - fs3 * 0.75, rr3);
          ctx.arcTo(c.x - wl / 2, ly - fs3 * 0.75, c.x + wl / 2, ly - fs3 * 0.75, rr3);
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(150,130,95,0.55)'; ctx.lineWidth = 1; ctx.stroke();
          ctx.fillStyle = '#5a4a34';
          ctx.fillText(label, c.x, ly + fs3 * 0.03);
          ctx.restore();
        }
      }
    },
    _drawTinyCottage(x, y) {
      const ctx = this._ctx, th = this._th(), im = this._img.house;
      if (im && im.width && th > 8) {
        const h = th * 1.85, s = h / im.height, w = im.width * s;
        ctx.save(); ctx.globalAlpha = 0.78;
        ctx.drawImage(im, x - w / 2, y - h + th * 0.12, w, h);
        ctx.restore();
        return;
      }
      const sc2 = th * 1.05;
      if (sc2 < 8) return;
      ctx.save();
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(x - sc2 * 0.55, y - sc2 * 0.52, sc2 * 1.1, sc2 * 0.52);
      ctx.fillStyle = '#b06a42';
      ctx.beginPath();
      ctx.moveTo(x - sc2 * 0.68, y - sc2 * 0.50); ctx.lineTo(x, y - sc2 * 1.0);
      ctx.lineTo(x + sc2 * 0.68, y - sc2 * 0.50); ctx.closePath(); ctx.fill();
      ctx.restore();
    },
    /* 矢量地面层: 半透明叠在背景画的草甸上, 让画的笔触透出来、色调自动融合。
       - 每格确定性色斑(哈希取 3 档草绿) + (gx+gy) 奇偶的斜向割草条带
       - 世界边缘 2 格羽化(alpha 渐隐), 不出现生硬的绿色菱形岛边
       - 已拥有的地亮、未解锁的地暗淡稀疏 → 「扩地 = 点亮远处的土地」看得见
       - 零散草簇/小花(确定性哈希, 不闪烁), 手绘感与背景画统一 */
    _drawGroundPlane(W, H) {
      const ctx = this._ctx, tw = this._tw(), th = this._th();
      const ob = this._ownedBounds();
      /* 🔒 不透明世界地面(2026-08-14 程序化世界): 视口里每一格都真实绘制 ——
         农场内(0..COLS/ROWS)是耕作草甸(割草条带+已拥有更亮), 世界外是野草甸
         (色噪更野、微微偏黄), 靠近地平线渐入薄雾。没有照片, 就没有"贴不贴合":
         地面本身就是格子。缩放只是换个比例重画 —— 程序化天生矢量, 永不发糊。 */
      const HAZE = { r: 228, g: 206, b: 158 };
      // 视口能看到的格子范围(反解四角 + 余量)
      const corners = [this._screenToCell(0, 0), this._screenToCell(W, 0),
                       this._screenToCell(0, H), this._screenToCell(W, H)];
      let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
      for (const c of corners) {
        gx0 = Math.min(gx0, c.gx); gx1 = Math.max(gx1, c.gx);
        gy0 = Math.min(gy0, c.gy); gy1 = Math.max(gy1, c.gy);
      }
      gx0 -= 2; gy0 -= 2; gx1 += 2; gy1 += 2;
      const hl = this._cell(0, -3).y;   // 林线 y(与 _drawHorizon 同一条对角线)
      // 整面铺草甸底色: 菱形之间的反锯齿细缝不再漏出天空色(亮格线的元凶)。
      // 从林脚以下起铺(hl+0.8th), 树脚由菱形格自然探上去咬合, 不再一刀切。
      const gTop = Math.max(0, hl + th * 2.4);
      const meadow = ctx.createLinearGradient(0, gTop, 0, H);
      meadow.addColorStop(0, 'rgb(178,180,72)');
      meadow.addColorStop(0.38, 'rgb(156,170,60)');
      meadow.addColorStop(1, 'rgb(124,150,50)');
      ctx.fillStyle = meadow;
      ctx.fillRect(0, gTop, W, H - gTop);
      const shade = ctx.createLinearGradient(0, gTop, W * 0.85, H);
      shade.addColorStop(0, 'rgba(255,214,120,0.16)');
      shade.addColorStop(0.55, 'rgba(255,200,100,0.04)');
      shade.addColorStop(1, 'rgba(48,62,28,0.10)');
      ctx.fillStyle = shade;
      ctx.fillRect(0, gTop, W, H - gTop);
      for (let gy = gy0; gy <= gy1; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          if (gx + gy < -3) continue;                    // 林线以北是地平线的事
          const c = this._cell(gx, gy);
          if (c.x + tw < 0 || c.x - tw > W || c.y + th < 0 || c.y - th > H) continue;
          const hsh = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
          const r1 = (hsh % 997) / 997, r2 = ((hsh >> 8) % 991) / 991;
          const inWorld = gx >= 0 && gy >= 0 && gx < COLS && gy < ROWS;
          const owned = inWorld && gx >= ob.x1 && gx <= ob.x2 && gy >= ob.y1 && gy <= ob.y2;
          const apron = gy > ob.y2;
          // 基色: 农场内亮耕作金绿, 镜头前围裙同色（油画是一整片草甸）
          let rr, gg, bb2;
          const patch = Math.sin(gx * 0.52 + gy * 0.37) * 7 + Math.sin(gx * 0.19 - gy * 0.24) * 5;
          const stripe = ((gx + gy) & 1) ? -0.35 : 0;
          const nzIn = (r1 - 0.5) * 6;
          let fr = 170 + patch + stripe + nzIn, fg = 172 + patch * 0.7 + stripe + nzIn * 0.6, fb = 54 + patch * 0.3 + stripe * 0.45 + nzIn * 0.35;
          if (inWorld && !owned && !apron) { fr = 96 + nzIn; fg = 122 + nzIn * 0.6; fb = 52 + nzIn * 0.3; }
          // 场外林下：更深的荫地，不是亮黄野草
          const nzOut = (r1 - 0.5) * 8;
          const wr = 78 + nzOut, wg = 104 + nzOut * 0.7, wb = 50 + (r2 - 0.5) * 6;
          // 农场↔野地按「出界距离」渐变(6 格内过渡), 不出现生硬色阶边框
          const dOut = Math.max(0, Math.max(-gx, -gy, gx - (COLS - 1), gy - (ROWS - 1)));
          const wMix = Math.max(0, Math.min(1, dOut / 6));
          rr = fr * (1 - wMix) + wr * wMix; gg = fg * (1 - wMix) + wg * wMix; bb2 = fb * (1 - wMix) + wb * wMix;
          // 地平：近山脚不画菱形格（宣传图远坡是一整片），再往前才淡入草地格
          const dHl = (c.y - hl) / (th * 4.4);
          if (dHl < 0.7) continue;
          if (dHl < 1) {
            const k = Math.max(0, Math.min(1, dHl));
            rr = rr * k + HAZE.r * (1 - k); gg = gg * k + HAZE.g * (1 - k); bb2 = bb2 * k + HAZE.b * (1 - k);
          }
          if (dHl < 1.8) {
            const fade = Math.max(0, Math.min(1, 1 - dHl / 1.8));
            rr = rr * (1 - fade) + 127 * fade;
            gg = gg * (1 - fade) + 160 * fade;
            bb2 = bb2 * (1 - fade) + 80 * fade;
          }
          ctx.fillStyle = 'rgb(' + (rr | 0) + ',' + (gg | 0) + ',' + (bb2 | 0) + ')';
          ctx.globalAlpha = dHl < 1.15 ? Math.max(0.12, (dHl - 0.7) / 0.45) : 0.55;
          ctx.beginPath();
          ctx.ellipse(c.x, c.y, tw * 0.78, th * 0.68, 0, 0, 6.283);
          ctx.fill();
          ctx.globalAlpha = 1;
          // 点缀: 草簇(内外都有, 外面更密) / 小花(只在农场内)
          const tuftP = inWorld ? 0.82 : 0.72;
          if (r2 > tuftP && dHl > 1.15) {
            ctx.strokeStyle = inWorld ? '#5e8a38' : '#6d8840';
            ctx.lineWidth = Math.max(0.8, tw * 0.018); ctx.lineCap = 'round';
            const bx = c.x + (r1 - 0.5) * tw * 0.4, byy = c.y + (r2 - 0.5) * th * 0.4;
            for (let i = -1; i <= 1; i++) {
              ctx.beginPath();
              ctx.moveTo(bx + i * tw * 0.03, byy + th * 0.06);
              ctx.quadraticCurveTo(bx + i * tw * 0.05, byy - th * 0.05, bx + i * tw * 0.075, byy - th * 0.13);
              ctx.stroke();
            }
          } else if ((owned || apron) && r2 < 0.22) {
            const fx = c.x + (r1 - 0.5) * tw * 0.5, fy = c.y + (r2 * 8 - 0.4) * th * 0.4;
            ctx.fillStyle = '#fdf6e8';
            for (let i = 0; i < 5; i++) { const an = i / 5 * 6.283; ctx.beginPath(); ctx.arc(fx + Math.cos(an) * tw * 0.032, fy + Math.sin(an) * th * 0.042, Math.max(1.0, tw * 0.020), 0, 6.283); ctx.fill(); }
            ctx.fillStyle = '#f2c34a';
            ctx.beginPath(); ctx.arc(fx, fy, Math.max(0.9, tw * 0.015), 0, 6.283); ctx.fill();
          }
        }
      }
      this._drawTreeShadows(W, H, hl);
      const mid = this._cell((ob.x1 + ob.x2) / 2, ob.y2 + 0.4);
      this._drawMeadowDetail(mid.x, mid.y);
      // 程序化世界没有照片可采样 —— 地面到处都是草, 乡路/小屋永远可画
      return () => 1;
    },
    /* 云杉林的长影子：光从左上打来，影子往右下铺在草甸上。
       跟宣传图同一套光方向；画进相机缓存，30fps 零成本。 */
    _drawTreeShadows() {
      // 云杉墙已经改成坡上散树，旧的林脚长影子会变成半山腰脏斑，不再画。
    },
    /* 整幅暖光罩：让作物/建筑贴图也沾上宣传图的金色侧光，很淡，不把菜染黄。 */
    _drawGoldenHour(W, H) {
      const ctx = this._ctx;
      const g = ctx.createRadialGradient(W * 0.14, H * 0.06, 0, W * 0.14, H * 0.06, Math.max(W, H) * 1.15);
      g.addColorStop(0, 'rgba(255,208,130,0.38)');
      g.addColorStop(0.34, 'rgba(255,176,96,0.16)');
      g.addColorStop(1, 'rgba(48,42,22,0.07)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    },
    /* 程序化地平线: 一切以世界坐标锚定 —— 林线沿着世界北缘的等 gx+gy 对角线,
       跟着缩放/平移走(和农场同一套变换), 所以农场永远贴着自己的地平线。
       树冠鼓包用世界 x 相位取哈希, 平移时树是"世界里的树"而不是贴在屏幕上的。 */
    _drawSkyClouds(W, H) {
      const ctx = this._ctx, th = this._th();
      const hl = this._cell(0, -3).y;
      if (hl > H + th * 8) return;
      ctx.save();
      const clouds = [
        { f: 0.16, lift: 5.1, s: 1.05 },
        { f: 0.42, lift: 6.0, s: 0.72 },
        { f: 0.68, lift: 4.7, s: 0.92 },
        { f: 0.88, lift: 5.6, s: 0.58 },
      ];
      for (const cl of clouds) {
        const x = ((cl.f * W - this._camX * 0.10) % (W + 120) + (W + 120)) % (W + 120) - 60;
        const y = hl - th * cl.lift;
        if (y < -th * 2 || y > H * 0.55) continue;
        const s = th * 1.7 * cl.s;
        ctx.fillStyle = 'rgba(255,246,228,0.48)';
        ctx.beginPath();
        ctx.ellipse(x, y, s * 1.65, s * 0.50, -0.08, 0, 6.283);
        ctx.ellipse(x - s * 0.72, y + s * 0.06, s * 0.88, s * 0.38, 0.1, 0, 6.283);
        ctx.ellipse(x + s * 0.78, y + s * 0.04, s * 1.02, s * 0.40, -0.12, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();
    },
    _drawSpruce(x, baseY, h) {
      const ctx = this._ctx;
      if (h < 6) return;
      const tip = x + h * (Math.sin(x * 0.07) * 0.08);
      ctx.fillStyle = '#2a3f2c';
      ctx.beginPath();
      ctx.moveTo(tip, baseY - h);
      ctx.lineTo(x + h * 0.34, baseY - h * 0.06);
      ctx.lineTo(x - h * 0.40, baseY - h * 0.10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#3a5c42';
      ctx.beginPath();
      ctx.moveTo(tip, baseY - h * 0.80);
      ctx.lineTo(x + h * 0.24, baseY - h * 0.26);
      ctx.lineTo(x - h * 0.26, baseY - h * 0.30);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,214,150,0.16)';
      ctx.beginPath();
      ctx.moveTo(tip, baseY - h);
      ctx.lineTo(tip - h * 0.12, baseY - h * 0.46);
      ctx.lineTo(tip, baseY - h * 0.40);
      ctx.closePath();
      ctx.fill();
    },
    _drawHorizon(W, H) {
      const ctx = this._ctx, tw = this._tw(), th = this._th();
      const hl = this._cell(0, -3).y;
      if (hl > H + th * 6) return;
      // 对齐宣传图 8.jpg：远景是金绿滚圆草坡 + 零星圆树，没有锯齿云杉墙
      const hill = (yOff, amp, col, phase) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        const n = 32;
        for (let i = 0; i <= n; i++) {
          const x = (i / n) * W;
          const wx = (x + this._camX * 0.28) / (W / 2.4);
          const ph = Math.sin(wx + phase) * amp + Math.sin(wx * 1.7 + phase * 1.4) * amp * 0.4;
          if (i === 0) ctx.moveTo(x, hl - yOff + ph); else ctx.lineTo(x, hl - yOff + ph);
        }
        ctx.lineTo(W, hl + th * 3); ctx.lineTo(0, hl + th * 3); ctx.closePath(); ctx.fill();
      };
      hill(th * 7.4, th * 1.15, '#e8c99a', 0.3);
      hill(th * 5.6, th * 1.05, '#d2c07a', 1.4);
      hill(th * 4.0, th * 1.20, '#a8b86a', 2.6);
      hill(th * 2.5, th * 0.95, '#7fa050', 0.9);
      // 远坡一小圈、近坡稍大：油画后山是疏林，不是三棵孤树
      const bands = [
        { step: tw * 1.18, y0: 3.6, ySpan: 3.4, s0: 0.28, sSpan: 0.38, skip: 0.10, cam: 0.42 },
        { step: tw * 1.42, y0: 1.1, ySpan: 2.2, s0: 0.40, sSpan: 0.48, skip: 0.18, cam: 0.55 },
      ];
      for (const B of bands) {
        const x0 = -((this._camX * B.cam) % B.step) - B.step;
        for (let x = x0; x < W + B.step; x += B.step) {
          const seed = Math.abs(Math.round((x + this._camX * B.cam) / B.step));
          const hsh = ((seed * 2654435761) >>> 0) % 1000 / 1000;
          if (hsh < B.skip) continue;
          const tx = x + (hsh - 0.5) * tw * 0.8;
          const ty = hl - th * (B.y0 + hsh * B.ySpan);
          const ts = tw * (B.s0 + hsh * B.sSpan);
          this._tree(tx, ty, ts, (seed & 1) === 0);
        }
      }
    },
    /* 地平薄雾: 必须画在**地面之后**(第一版画在 _drawHorizon 里, 随即被地面
       整面底色盖掉, 林脚剩一条生硬横线 —— 截图实证的顺序 bug)。 */
    _drawHorizonMist(W, H) {
      const ctx = this._ctx, th = this._th();
      const hl = this._cell(0, -3).y;
      if (hl > H + th * 4 || hl < -th * 6) return;
      const mist = ctx.createLinearGradient(0, hl - th * 0.8, 0, hl + th * 2.8);
      mist.addColorStop(0, 'rgba(232,201,154,0.18)');
      mist.addColorStop(0.45, 'rgba(220,190,130,0.08)');
      mist.addColorStop(1, 'rgba(220,190,130,0)');
      ctx.fillStyle = mist; ctx.fillRect(0, hl - th * 0.8, W, th * 3.6);
    },

    _blitBackdrop(ctx, W, H) {
      const stl = (Farm.state.data.map || []).find((m) => m && m.type === 'house');
      const cc = Farm.state.data && Farm.state.data.clearedCells;
      const ob = this._ownedBounds();
      const key = Math.round(this._camX) + ',' + Math.round(this._camY) + ',' + this._zoom.toFixed(3) + ',' + W + ',' + H
        + ',' + (stl ? stl.gx + '_' + stl.gy : '-')
        + ',L' + this._landLevel() + (this._isFrontLand() ? 'F' : 'B')
        + ',R' + ob.x1 + '_' + ob.y1 + '_' + ob.x2 + '_' + ob.y2
        + ',C' + (cc ? Object.keys(cc).sort().join('_') : '');
      if (this._bgKey !== key || !this._bgCache) {
        if (!this._bgCache) this._bgCache = document.createElement('canvas');
        const cv = this._bgCache, dpr = this._dpr, pw = Math.round(W * dpr), ph = Math.round(H * dpr);
        if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
        const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
        const real = this._ctx; this._ctx = g; this._drawBackdrop(W, H); this._ctx = real;
        this._bgKey = key;
      }
      ctx.drawImage(this._bgCache, 0, 0, W, H);
    },
    render() {
      if (!this._on) return;
      const ctx = this._ctx, tw = this._tw(), th = this._th(), W = this._cssW(), H = this._cssH();
      const terrain = Farm.state.data.mapTerrain || {};
      ctx.clearRect(0, 0, W, H);
      // Landscape backdrop (sky/hills/trees/meadow/tufts) — only changes when the
      // camera pans/zooms, so it's rendered once into an offscreen canvas and reused
      // on the ~30fps animation frames (pets/bubbles). Saves CPU/battery on phones.
      this._blitBackdrop(ctx, W, H);

      // 成熟数预统计: 徽章 LOD 用(<=3 块熟画白圈气泡, 多了改光晕+弹跳, 见 _drawPlot)
      this._matureCount = 0;
      try {
        const ps = Farm.state.data.plots || [];
        for (const pl of ps) if (pl && pl.unlocked && pl.crop && Farm.crops.isMature(pl)) this._matureCount++;
      } catch (e) { this._matureCount = 0; }
      const waterCells = [], groundTiles = [];
      for (let s = 0; s <= (COLS - 1) + (ROWS - 1); s++) {
        for (let gx = 0; gx < COLS; gx++) {
          const gy = s - gx; if (gy < 0 || gy >= ROWS) continue;
          const c = this._cell(gx, gy);
          if (c.x + tw < 0 || c.x - tw > W || c.y + th * 4 < 0 || c.y - th * 2 > H) continue;
          const k = gx + ',' + gy;
          // Water cells are collected and drawn as ONE merged organic pond (below) rather
          // than per-tile diamonds (Chris 2026-06-19: looked like a grid). Water overrides
          // soil/path on a cell.
          if (terrain[k] === 'water') {
            if (this._onRoad(gx, gy)) continue;   // 乡路上的旧水格不画，路权更高
            waterCells.push({ x: c.x, y: c.y, s: gx * 7.3 + gy * 13.7, gx: gx, gy: gy });
            continue;
          }
          if (terrain[k] === 'path') groundTiles.push({ key: 'path', c });
        }
      }
      // 🔒 水塘画在田土/小路**之下**（2026-08-13 Chris:「水塘跟菜地分开」）。
      // 有机水塘的波浪轮廓天然会溢出水格边界一点；先画水塘再画地块，溢出的
      // 水沿被土床盖住 = 岸线自然贴着田边，绝不会出现「水漫到菜地上」。
      this._drawPond(waterCells);
      this._drawRoadSurface();   // 路面盖住水塘溢出，乡路永远在水上面
      this._drawGardenPatch();
      this._drawUnifiedField();
      for (const tI of groundTiles) this._tileImg(tI.key, tI.c);
      this._drawRoadWalker();
      this._drawBirds();

      // 水笔刷刷到占用格 → 那一格显红叉（0.9 秒后自动消失，不留残影）
      if (this._blockedCell) {
        const age = Date.now() - this._blockedCell.t;
        if (age > 900) { this._blockedCell = null; }
        else {
          const bc = this._cell(this._blockedCell.gx, this._blockedCell.gy);
          ctx.save();
          ctx.globalAlpha = age > 600 ? (1 - (age - 600) / 300) : 1;   // 末尾 0.3s 淡出
          this._diamond(bc.x, bc.y, tw, th); ctx.fillStyle = 'rgba(220,60,60,0.30)'; ctx.fill();
          this._drawBlockedX(bc.x, bc.y);
          ctx.restore();
        }
      }

      // build-mode grid overlay
      if (this._build) {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
        for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) { const c = this._cell(gx, gy); this._diamond(c.x, c.y, tw, th); ctx.stroke(); }
      }

      // depth-sorted objects: plots + buildings
      const draws = [];
      const plots = Farm.state.data.plots || [];
      if (this._cellToPlotN !== plots.length) { this._buildLayout(); this._cellToPlotN = plots.length; }
      // 锁定地块徽章 LOD（audit B2 P1：9 枚 🔒+Lv 互相压盖成噪点）：算出「下一档
      // 可解锁」的最低等级，只有该档地块画完整徽章，其余锁定格淡化为小锁点。
      let nextLv = Infinity;
      for (let i = 0; i < plots.length; i++) { if (plots[i] && !plots[i].unlocked) { const rv = REQUIRED_LV[i] || 2; if (rv < nextLv) nextLv = rv; } }
      this._nextLockLv = nextLv;
      for (let i = 0; i < plots.length; i++) {
        const pp = this._plotPos(i);
        draws.push({ d: pp.gx + pp.gy, fn: () => this._drawPlot(plots[i], pp.gx, pp.gy, i) });
      }
      const map = (Farm.state.data.map) || [];
      for (let i = 0; i < map.length; i++) {
        const o = map[i], b = BUILDINGS[o.type]; if (!b) continue;
        const mv = this._moving && this._moving.kind === 'building' && this._moving.idx === i;
        const gx = mv ? this._moving.gx : o.gx, gy = mv ? this._moving.gy : o.gy;
        // 必须带 lv：_homeSprite / _homeDrawMul 靠它换图换尺寸。只传 type+坐标会永远画 1 级。
        draws.push({ d: (gx + gy) + (b.w - 1) + (b.h - 1) + 0.5, fn: () => this._drawBuilding({ type: o.type, gx, gy, lv: o.lv }, b, mv, i) });
      }
      const nowW = Date.now();
      const wdt = this._lastWalkT ? Math.min(0.25, (nowW - this._lastWalkT) / 1000) : 0;
      this._lastWalkT = nowW;
      this._decoPlacements().forEach((d) => {
        const mv = this._moving && this._moving.kind === 'deco' && this._moving.idx === d.seed;
        if (d.itemId && ANIMALS[d.itemId] && !mv) {           // walking pet
          const p = this._updatePet(d.seed, d.gx, d.gy, wdt);
          draws.push({ d: p.fx + p.fy + 0.25, fn: () => this._drawAnimal(d, p.fx, p.fy, p.face) });
        } else {                                              // static deco (or pet being dragged)
          const gx = mv ? this._moving.gx : d.gx, gy = mv ? this._moving.gy : d.gy;
          draws.push({ d: gx + gy + 0.2, fn: () => this._drawDeco({ emoji: d.emoji, itemId: d.itemId, gx, gy, pet: d.pet, seed: d.seed }, mv) });
        }
      });
      draws.sort((a, c) => a.d - c.d); draws.forEach(x => x.fn());

      /* 🔒 红叉必须画在深度排序**之后**（2026-08-13）——它是「这里不能放」的
         唯一提示，不能被任何东西遮住。放进 draws 里试过：拖到菜地上时红叉被
         排序更靠后的菜地土床整个盖掉，正好在最需要它的场景里失效。 */
      if (this._moving && !this._moving.valid) {
        const m = this._moving;
        let mx, my;
        if (m.kind === 'building') {
          const bb = BUILDINGS[(Farm.state.data.map[m.idx] || {}).type];
          const mid = this._cell(m.gx + (bb ? (bb.w - 1) / 2 : 0), m.gy + (bb ? (bb.h - 1) / 2 : 0));
          mx = mid.x; my = mid.y;
        } else { const c2 = this._cell(m.gx, m.gy); mx = c2.x; my = c2.y; }
        this._drawBlockedX(mx, my);
      }

      // 按压反馈：被按住的地块盖半透明白菱形（_down 设 _pressCell，up/cancel/拖拽清）。
      // cy 偏移 th*0.12 与空地命中测试的视觉床中心一致。
      if (this._pressCell) {
        const pc = this._cell(this._pressCell.gx, this._pressCell.gy);
        this._diamond(pc.x, pc.y + th * 0.12, tw, th);
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
      }

      // 开垦模式：贴边未占地发金光，点它砍树成田
      if (this._clearMode) {
        const pulse = 0.55 + 0.35 * (0.5 + 0.5 * Math.sin(Date.now() / 260));
        this._eachClearTarget((gx, gy) => {
          if (this._ownedCell(gx, gy)) return;   // 只亮林子/新草地，院子里空地不铺金
          const c = this._cell(gx, gy);
          const cy = c.y + th * 0.06;
          ctx.save();
          ctx.globalAlpha = pulse * 0.35;
          this._diamond(c.x, cy, tw * 1.18, th * 1.18);
          ctx.fillStyle = '#ffe566';
          ctx.fill();
          ctx.globalAlpha = pulse;
          this._diamond(c.x, cy, tw * 0.96, th * 0.96);
          ctx.fillStyle = 'rgba(255,196,40,0.62)';
          ctx.fill();
          ctx.strokeStyle = '#fff4b0';
          ctx.lineWidth = Math.max(2, th * 0.11);
          ctx.stroke();
          ctx.restore();
        });
      }

      this._drawLockedLand();
      this._drawGoldenHour(W, H);
      this._drawParticles(tw); this._drawFestival();
    },
    _rectPath(x1, y1, x2, y2) {   // cell-rect → screen parallelogram path
      const ctx = this._ctx, a = this._cell(x1, y1), b = this._cell(x2 + 1, y1), c = this._cell(x2 + 1, y2 + 1), d = this._cell(x1, y2 + 1);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath();
    },
    // The on-map pulsing unlock circle was removed (Chris 2026-06-19) — land expansion
    // now lives in the ☰ menu ("扩建农场"). _landBadge stays null so the on-map tap-to-
    // expand is disabled.
    _drawLockedLand() { this._landBadge = null; },
    _tryUnlockLand() {
      const next = this._nextLand();
      if (!next) { if (Farm.ui && Farm.ui.toast) Farm.ui.toast(this._lang() === 'en' ? 'Land is fully unlocked' : '土地已全部解锁'); return; }
      /* 🔒 余额字段是 eastPoints（2026-08-15 审阅第 3 条）：存档里从来没有 totalPoints
         这个字段（那是 members 文档上的服务端缓存名），读它恒为 0 →
         L3(3000币+30点) / L4(6000币+50点) 永远提示「积分不够」，扩地后期整个是坏的。 */
      const en = this._lang() === 'en', haveC = Farm.state.data.coins, haveP = (Farm.state.data.eastPoints || 0);
      if (haveC < next.coins || (next.points && haveP < next.points)) {
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'Not enough coins or points to expand' : '农场币或积分不足，暂无法扩地');
        return;
      }
      const go = () => {
        if (!Farm.state.spendCoins(next.coins)) return;
        /* 🔒 来源必须在服务端白名单里（2026-08-15 审阅第 4 条）
           StockWise 的 ALLOWED_GAME_SOURCES 没有 'land_expand' → 服务端 422 拒收，
           而 spendEastPoints 不像 addEastPoints 那样回滚，于是「地解锁了、下次登录
           积分又回来了」＝白拿一块地。白名单本来就留了 `ep_shop:` 前缀口子给这类
           购买行为（见 ALLOWED_GAME_SOURCE_PREFIXES），扩地就是买地，走它最干净，
           不用动店铺后端。 */
        if (next.points) { if (!Farm.state.spendEastPoints(next.points, { source: 'ep_shop:land_expand', description: 'Farm land expansion' })) { Farm.state.addCoins(next.coins); return; } }
        Farm.state.data.landLevel = this._landLevel() + 1; Farm.state.save();
        this._bgKey = null; if (Farm.ui && Farm.ui.refreshHUD) Farm.ui.refreshHUD();
        if (Farm.audio) Farm.audio.play('levelUp'); if (Farm.ui && Farm.ui.showConfetti) Farm.ui.showConfetti(30, 1800);
        if (Farm.ui && Farm.ui.toast) Farm.ui.toast(en ? 'New land unlocked' : '新土地已解锁');
        this.render();
      };
      const cost = next.coins + ' <span class="coin-icon"></span>' + (next.points ? (' + ' + next.points + ' <span class="points-icon"></span>') : '');
      const html = '<div style="text-align:center;padding:4px;">' +
        '<div style="font-size:40px;margin-bottom:4px;">🌄</div><h2 class="modal-title">' + (en ? 'Expand your farm?' : '扩大农场？') + '</h2>' +
        '<div style="color:#666;margin:8px 0 14px;font-size:14px;line-height:1.5;">' + (en ? 'Clear this woodland — build and plant on it.' : '把这片林子开成你的农场，可建造和种菜。') + '</div>' +
        '<div style="font-weight:600;font-size:16px;margin-bottom:16px;">' + (en ? 'Cost: ' : '花费：') + cost + '</div>' +
        '<div class="btn-row"><button class="btn secondary" id="landNo">' + (en ? 'Later' : '稍后') + '</button><button class="btn primary" id="landYes">🌱 ' + (en ? 'Unlock' : '解锁') + '</button></div></div>';
      Farm.ui.showModal(html);
      const y = document.getElementById('landYes'), n = document.getElementById('landNo');
      if (y) y.onclick = () => { Farm.ui.hideModal(); go(); };
      if (n) n.onclick = () => Farm.ui.hideModal();
    },
    // 贴纸风矢量锁（视觉第2批）：替换 canvas fillText('🔒') —— emoji 在不同平台
    // 渲染彩色/黑白不一，矢量锁与 ui-icon sprite 同一套可可描边+金色语言。
    // (x,y)=锁整体中心，s=整体尺寸，alpha=透明度。
    cropStem(id) { return ISO_CROPS[id] || null; },
    _drawEgg(x, y, r) {
      const ctx = this._ctx;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.72, r, 0, 0, 6.283);
      ctx.fillStyle = '#f6efe0'; ctx.fill();
      ctx.strokeStyle = '#d4a04a'; ctx.lineWidth = Math.max(1, r * 0.12); ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x - r * 0.18, y - r * 0.22, r * 0.22, r * 0.14, -0.5, 0, 6.283);
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
    },
    _drawCoinMark(x, y, r) {
      const ctx = this._ctx;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
      ctx.fillStyle = '#f6c945'; ctx.fill();
      ctx.strokeStyle = '#c48a1a'; ctx.lineWidth = Math.max(1, r * 0.14); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, 6.283);
      ctx.strokeStyle = 'rgba(255,248,220,0.7)'; ctx.lineWidth = Math.max(1, r * 0.08); ctx.stroke();
    },
    _drawLock(x, y, s, alpha) {
      const ctx = this._ctx;
      ctx.save();
      ctx.globalAlpha = alpha == null ? 1 : alpha;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#4a3629';
      // 锁环（上半圆弧）
      ctx.lineWidth = Math.max(1, s * 0.13);
      ctx.beginPath(); ctx.arc(x, y - s * 0.05, s * 0.27, Math.PI, 2 * Math.PI); ctx.stroke();
      // 锁身（圆角矩形，金色）
      const w = s * 0.95, h = s * 0.62, r = s * 0.16, bx = x - w / 2, by = y - s * 0.05;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, w, h, r);
      else ctx.rect(bx, by, w, h);
      ctx.fillStyle = '#f7c948'; ctx.fill();
      ctx.lineWidth = Math.max(1, s * 0.09); ctx.stroke();
      // 锁孔
      ctx.fillStyle = '#4a3629';
      ctx.beginPath(); ctx.arc(x, by + h * 0.42, s * 0.09, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    },
    // 油画植株：优先用对应生长帧，缺 _0/_1/_2 时用成熟图缩小冒出。
    // 下缘埋进木床土面并裁掉，看起来是从土里长，不是摆在箱子上。
    _drawIsoPlant(stem, fr, progress, c, tw, th, ripe) {
      const exactKey = 'L_' + stem + '_' + fr;
      const exact = this._img[exactKey];
      let im = exact instanceof Image ? exact : null;
      if (!im && exact !== 'failed') im = this._lazyImg(stem + '_' + fr);
      let synth = false;
      if (!im && fr < 3) {
        if (exact === 'failed') {
          // 没幼苗帧：用通用幼苗/小苗，不要把带果的成树缩小当幼苗
          const sprout = this._lazyImg(fr <= 0 ? 'crop_sprout_0' : 'crop_sprout_1');
          if (sprout) { im = sprout; synth = true; }
        } else {
          this._lazyImg(fr <= 0 ? 'crop_sprout_0' : 'crop_sprout_1');
        }
      }
      if (!im) return null;
      const ctx = this._ctx;
      const grow = synth ? (fr <= 0 ? 0.28 : 0.52) : (0.55 + fr * 0.15);
      const s = (th * (0.70 + grow * 0.62)) / 260;
      const w = im.width * s, h = im.height * s;
      const soilY = c.y + th * 0.10 - (ripe || 0);
      const extra = ({ crop_carrot: 0.22, crop_daikon: 0.20, crop_yam: 0.24, crop_garlic: 0.10, crop_cucumber: 0.08, crop_ginger: 0.18, crop_taro: 0.08, crop_bamboo: 0.10, crop_wawa: 0.14, crop_cong: 0.16, crop_jiuhuang: 0.16 })[stem] || 0;
      const bury = h * ((synth ? (0.28 - grow * 0.08) : 0.20) + extra);
      const topY = soilY - h + bury;
      ctx.save();
      ctx.beginPath();
      ctx.rect(c.x - tw * 1.25, c.y - th * 5.2, tw * 2.5, th * 5.2 + th * 0.14);
      ctx.clip();
      if (synth && grow < 0.85) {
        ctx.filter = 'saturate(1.15) brightness(1.04)';
      }
      ctx.drawImage(im, c.x - w / 2, topY, w, h);
      ctx.restore();
      return topY;
    },
    // 没有油画立方体贴图的菜：用 SVG 放大铺满土床，下缘埋进垄，绝不回退 emoji。
    _drawBedCropArt(cropId, progress, c, tw, th, ripe) {
      const st = progress >= 1 ? 2 : progress >= 0.4 ? 1 : 0;
      const im = this._cropArtImg(cropId, st);
      if (!im) return;
      const ctx = this._ctx;
      const s = (th * (1.18 + st * 0.22)) / 220;
      const w = im.width * s, h = im.height * s;
      const bury = h * 0.30;
      const topY = (c.y + th * 0.20 - (ripe || 0)) - h + bury;
      ctx.save();
      ctx.beginPath();
      ctx.rect(c.x - tw * 1.15, c.y - th * 4.2, tw * 2.3, th * 4.2 + th * 0.20);
      ctx.clip();
      ctx.drawImage(im, c.x - w / 2, topY, w, h);
      ctx.restore();
    },
    _drawPlot(plot, gx, gy, idx) {
      const ctx = this._ctx, tw = this._tw(), th = this._th(), c = this._cell(gx, gy);
      if (!plot.unlocked) {
        // 田已由 _drawUnifiedField 画成一块；只在「下一档」留一枚淡锁
        const reqLv = REQUIRED_LV[idx] || 2;
        if (reqLv === this._nextLockLv) this._drawLock(c.x, c.y + th * 0.02, th * 0.24, 0.40);
        return;
      }
      if (!plot.crop) return;
      const p = Farm.crops.getProgress ? Farm.crops.getProgress(plot) : 1, mature = Farm.crops.isMature(plot);
      const tNow = Date.now() / 1000;
      /* 成熟的菜自己会「跃跃欲收」: 本体轻弹跳(旧版只有气泡动, 菜是死的)。
         相位按 gx+gy 错开, 整片田是波浪不是齐步走。 */
      const ripe = mature ? Math.abs(Math.sin(tNow * 2.2 + (gx * 1.7 + gy) * 0.9)) * th * 0.10 : 0;
      const by = c.y + th * 0.2 - ripe;   // sprite stands on the diamond
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const fr = p >= 1 ? 3 : p >= 0.6 ? 2 : p >= 0.25 ? 1 : 0;
      // soft contact shadow so the plant sits IN the bed (not floating)
      this._shadow(c.x, c.y + th * 0.42, tw * (0.4 + fr * 0.12));
      if (mature) {
        const pulse = 0.5 + 0.5 * Math.sin(tNow * 2.2 + gx + gy);
        const gl = ctx.createRadialGradient(c.x, c.y + th * 0.30, th * 0.04, c.x, c.y + th * 0.30, tw * 0.38);
        gl.addColorStop(0, 'rgba(255,214,110,' + (0.10 + pulse * 0.08) + ')');
        gl.addColorStop(1, 'rgba(255,214,110,0)');
        ctx.fillStyle = gl;
        ctx.beginPath(); ctx.ellipse(c.x, c.y + th * 0.30, tw * 0.38, th * 0.28, 0, 0, 6.283); ctx.fill();
      }
      let plantTopY = c.y - th * 1.3;   // fallback bubble anchor
      const isoStem = ISO_CROPS[plot.crop];
      if (isoStem) {
        const drawn = this._drawIsoPlant(isoStem, fr, p, c, tw, th, ripe);
        if (drawn != null) plantTopY = drawn;
        // 有油画株的菜：加载中留空一帧，绝不闪 SVG 菜篮
      } else {
        this._drawBedCropArt(plot.crop, p, c, tw, th, ripe);
        plantTopY = c.y - th * 1.05 - ripe;
      }
      if (mature) {
        /* 徽章 LOD(2026-08-14 打磨): <=3 块熟 → 白圈气泡(新手期指认清晰);
           更多 → 不画气泡 —— 12 个白圈叠成墙是全场最丑的画面(截图实证),
           改由本体弹跳+金色光晕承担指认, 顶部「N 棵已熟可收」负责总量。 */
        if ((this._matureCount || 0) <= 3) {
          const bob = Math.sin(tNow * 2.5 + gx + gy) * th * 0.12;
          const r = th * 0.42, bx = c.x, byy = plantTopY - th * 0.42 + bob;
          ctx.beginPath(); ctx.arc(bx, byy, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,252,240,0.94)'; ctx.fill();
          ctx.strokeStyle = 'rgba(90,140,55,0.88)'; ctx.lineWidth = Math.max(1.4, th * 0.055); ctx.stroke();
          ctx.strokeStyle = '#3a8c50'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(1.8, th * 0.08);
          ctx.beginPath();
          ctx.moveTo(bx - r * 0.34, byy + r * 0.04);
          ctx.lineTo(bx - r * 0.06, byy + r * 0.30);
          ctx.lineTo(bx + r * 0.38, byy - r * 0.26);
          ctx.stroke();
        } else {
          // 偶发闪光: 每块地按自己的相位隔几秒闪一下, 全田任意时刻只有零星几颗
          const ph = (tNow * 0.4 + (gx * 7 + gy * 13) * 0.37) % 1;
          if (ph < 0.12) {
            ctx.globalAlpha = Math.sin(ph / 0.12 * Math.PI);
            const sx = c.x + tw * 0.22, sy = plantTopY + th * 0.2, r = th * 0.16;
            ctx.fillStyle = 'rgba(255,214,110,0.95)';
            ctx.beginPath();
            ctx.moveTo(sx, sy - r);
            ctx.lineTo(sx + r * 0.28, sy - r * 0.28);
            ctx.lineTo(sx + r, sy);
            ctx.lineTo(sx + r * 0.28, sy + r * 0.28);
            ctx.lineTo(sx, sy + r);
            ctx.lineTo(sx - r * 0.28, sy + r * 0.28);
            ctx.lineTo(sx - r, sy);
            ctx.lineTo(sx - r * 0.28, sy - r * 0.28);
            ctx.closePath();
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
      } else {
        const bw = tw * 0.40, bx = c.x - bw / 2, ybar = c.y + th * 0.34, bh = Math.max(2, th * 0.07), r2 = bh / 2;
        const bar = (x, w, col) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(x, ybar, Math.max(w, bh), bh, r2);
          else ctx.rect(x, ybar, Math.max(w, bh), bh);
          ctx.fill();
        };
        bar(bx, bw, 'rgba(40,30,16,0.20)');
        bar(bx, bw * Math.max(0.06, p), 'rgba(123,192,67,0.78)');
      }
    },
    _drawBuilding(o, b, moving, idx) {
      const ctx = this._ctx, tw = this._tw(), th = this._th();
      if (moving || (this._build && this._sel === idx && idx != null)) {   // footprint highlight diamonds
        const ok = moving ? this._moving.valid : true;
        ctx.fillStyle = moving ? (ok ? 'rgba(76,175,80,0.34)' : 'rgba(220,60,60,0.36)') : 'rgba(255,152,0,0.22)';
        for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { const cc2 = this._cell(o.gx + x, o.gy + y); this._diamond(cc2.x, cc2.y, tw, th); ctx.fill(); }
      }
      const cc = this._cell(o.gx + (b.w - 1) / 2, o.gy + (b.h - 1) / 2);
      const front = this._cell(o.gx + (b.w - 1), o.gy + (b.h - 1));
      const by = front.y + th / 2 + th * 0.18;
      if (!moving) {
        this._shadow(cc.x + tw * 0.28, by - th * 0.14, b.w * tw * 0.88, 0.20);
        const ctxS = this._ctx;
        ctxS.save();
        ctxS.fillStyle = 'rgba(40,52,18,0.14)';
        ctxS.beginPath();
        ctxS.ellipse(cc.x + tw * 0.62, by + th * 0.08, b.w * tw * 0.68, th * 0.38, 0.55, 0, 6.283);
        ctxS.fill();
        ctxS.restore();
      }
      ctx.globalAlpha = moving ? 0.82 : 1;
      // 按压反馈（audit B2 P2）：被按住的建筑以底边为锚缩到 94%（Hay Day 式
      // squash），与地块按压高亮同一套 _down/_up 生命周期。
      const pk = (!this._build && idx != null && idx === this._pressBuilding) ? 0.94 : 1;
      // 我的家：每级换图 + 明显放大（碰撞仍 2×2）。等级读场上那条记录，不信克隆。
      const rec = (idx != null && Farm.state.data && Farm.state.data.map) ? Farm.state.data.map[idx] : null;
      const homeO = (o.type === 'home' && rec) ? rec : o;
      const hz = o.type === 'home' ? this._homeDrawMul(homeO) : 1;
      const him = o.type === 'home' ? this._homeSprite(homeO) : this._img[b.img];
      if (!this._blit(him, cc.x, by, b.w * tw * 0.92 * BLD * pk * hz, b.sc * th * 2.2 * BLD * pk * hz)) { ctx.fillStyle = '#c0392b'; ctx.fillRect(cc.x - tw * 0.4, by - th, tw * 0.8, th); }
      if (o.type === 'house' && !moving) {
        this._drawShopSign(cc.x, by, b.w * tw * 0.92 * BLD, b.sc * th * 2.2 * BLD);
        /* 摊前的路人(2026-08-15 两轮定稿): 瘆人的是悬空的**头**(emoji 脸),
           站着的**全身**人影是对的 —— Chris:「有路人要买菜就放一个路人在
           菜摊前不好吗?」。全身 🧍 站在摊前路边 + 接地影 + 头顶求购气泡。 */
        if (!this._build && Farm.stall) {
          const cu = Farm.stall.customer();
          if (cu) {
            const t2 = Date.now() / 1000, bob = Math.sin(t2 * 2) * th * 0.04;
            // 站在**路上**(路正好从摊前过; 用格子锚点, 不会掉进水塘 —— 截图实证)
            const rp2 = this._cell(o.gx + 0.7, o.gy + 2.15);
            const sx2 = rp2.x, sy2 = rp2.y;
            this._drawVillager(sx2, sy2 + bob * 0.4, th, { scale: 1.05, shirt: '#e07030' });
            // 气泡绘制内部还会再上抬 th*1.62(历史锚点), 这里只留一点余量 → 恰好悬在头顶
            const px2 = sx2, py2 = sy2 - th * 0.15;
            ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
            /* 对话气泡(2026-08-14 Chris:「人头上那朵花什么意思?」——旧版白圈
               和作物成熟徽章撞脸, 读不出「TA 想买菜」。改成带尾巴的奶油气泡:
               菜 ×数量 + 小金币 = 一眼是「顾客想买」不是「地里熟了」)。 */
            const def2 = Farm.crops.get(cu.crop);
            const fs2 = th * 0.52;
            ctx.font = '600 ' + (fs2 * 0.72) + 'px "Plus Jakarta Sans","Noto Sans SC",sans-serif';
            const label2 = '×' + cu.qty;
            const wTxt = ctx.measureText(label2).width;
            const bw2 = fs2 * 1.15 + wTxt + fs2 * 1.05, bh2 = fs2 * 1.35;
            const bx2 = px2, byy2 = py2 - th * 1.62 + bob;
            const rr2 = bh2 * 0.42;
            ctx.beginPath();
            ctx.moveTo(bx2 - bw2 / 2 + rr2, byy2 - bh2 / 2);
            ctx.arcTo(bx2 + bw2 / 2, byy2 - bh2 / 2, bx2 + bw2 / 2, byy2 + bh2 / 2, rr2);
            ctx.arcTo(bx2 + bw2 / 2, byy2 + bh2 / 2, bx2 - bw2 / 2, byy2 + bh2 / 2, rr2);
            ctx.arcTo(bx2 - bw2 / 2, byy2 + bh2 / 2, bx2 - bw2 / 2, byy2 - bh2 / 2, rr2);
            ctx.arcTo(bx2 - bw2 / 2, byy2 - bh2 / 2, bx2 + bw2 / 2, byy2 - bh2 / 2, rr2);
            ctx.closePath();
            ctx.fillStyle = 'rgba(255,252,240,0.97)'; ctx.fill();
            ctx.strokeStyle = 'rgba(150,120,80,0.8)'; ctx.lineWidth = Math.max(1, th * 0.04); ctx.stroke();
            // 气泡尾巴指向路人
            ctx.beginPath();
            ctx.moveTo(bx2 - fs2 * 0.3, byy2 + bh2 / 2 - 1);
            ctx.lineTo(bx2, byy2 + bh2 / 2 + fs2 * 0.42);
            ctx.lineTo(bx2 + fs2 * 0.3, byy2 + bh2 / 2 - 1);
            ctx.closePath(); ctx.fillStyle = 'rgba(255,252,240,0.97)'; ctx.fill();
            ctx.textBaseline = 'middle';
            const stem2 = ISO_CROPS[cu.crop];
            const im2 = stem2 && this._lazyImg(stem2 + '_3');
            const ix2 = bx2 - bw2 / 2 + fs2 * 0.18;
            if (im2) ctx.drawImage(im2, ix2, byy2 - fs2 * 0.48, fs2 * 0.96, fs2 * 0.96);
            else {
              ctx.fillStyle = '#5aa04a';
              ctx.beginPath(); ctx.ellipse(ix2 + fs2 * 0.42, byy2, fs2 * 0.32, fs2 * 0.38, 0, 0, 6.283); ctx.fill();
            }
            ctx.font = '700 ' + (fs2 * 0.72) + 'px "Plus Jakarta Sans","Noto Sans SC",sans-serif';
            ctx.fillStyle = '#6d4c28';
            ctx.fillText(label2, bx2 - bw2 / 2 + fs2 * 1.2 + wTxt / 2, byy2 + fs2 * 0.05);
            this._drawCoinMark(bx2 + bw2 / 2 - fs2 * 0.42, byy2, fs2 * 0.30);
            ctx.textBaseline = 'alphabetic';
          }
        }
      }
      ctx.globalAlpha = 1;
      // coop ready-to-collect egg bubble (read the real map entry for eggAt)
      // coop ready-to-collect indicator: a SMALL egg bubble nestled just above the
      // coop roof (was a big white orb floating high above → looked like a stray ball,
      // Chris 2026-06-18). Smaller + closer + gentle bob so it clearly belongs to the coop.
      if (o.type === 'coop' && !this._build) {
        const real = Farm.state.data.map[idx];
        if (real && this._coopReady(real)) {
          const t = Date.now() / 1000, bob = Math.sin(t * 2.5) * th * 0.05, r = th * 0.28;
          const byy = by - b.sc * th * 1.05 * BLD + bob;
          ctx.beginPath(); ctx.arc(cc.x, byy, r * 1.15, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,252,240,0.94)'; ctx.fill();
          ctx.strokeStyle = 'rgba(230,160,32,0.9)'; ctx.lineWidth = Math.max(1.2, th * 0.05); ctx.stroke();
          this._drawEgg(cc.x, byy, r * 0.72);
        }
      }
      // 谷仓将满提示点（UX 第 2 批 #5）：仓储 ≥80% 时谷仓头顶一个黄色小圆点
      // （细白边），满仓变红。手法与鸡舍蛋泡一致（roof 上方锚点），数据直读
      // warehouse/warehouseCapacity（与 state.isWarehouseFull 同一口径，不另算）。
      if (o.type === 'barn' && !this._build) {
        const whN = (Farm.state.data.warehouse || []).length, cap = Farm.state.data.warehouseCapacity || 20;
        if (cap > 0 && whN >= cap * 0.8) {
          const r = Math.max(5, th * 0.22), byy = by - b.sc * th * 1.08 * BLD;
          ctx.beginPath(); ctx.arc(cc.x, byy, r, 0, Math.PI * 2);
          ctx.fillStyle = whN >= cap ? '#e8522a' : '#f6c945'; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(1.2, th * 0.05); ctx.stroke();
        }
      }
      if (this._build && this._sel === idx && idx != null && !moving) {   // delete chip
        const ch = this._delChip(o);
        ctx.beginPath(); ctx.arc(ch.x, ch.y, ch.r, 0, Math.PI * 2); ctx.fillStyle = '#e8522a'; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold ' + (ch.r * 1.1) + 'px sans-serif'; ctx.fillText('✕', ch.x, ch.y + 0.5);
      }
    },
    // Owned EP-shop decorations (shared state with the top-down view). Auto-place
    // any without a cell, then render upright; pets wander a little.
    _decoCells() {
      const occ = {}, plots = Farm.state.data.plots || [];
      for (let i = 0; i < plots.length; i++) occ[this._plotGX(i) + ',' + this._plotGY(i)] = 1;
      (Farm.state.data.map || []).forEach((o) => { const b = BUILDINGS[o.type]; if (!b) return; for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) occ[(o.gx + x) + ',' + (o.gy + y)] = 1; });
      const t = Farm.state.data.mapTerrain || {}; Object.keys(t).forEach((k) => { if (t[k] === 'water') occ[k] = 1; });
      const road = this._roadSet();
      Object.keys(road).forEach((k) => { occ[k] = 1; });
      return occ;
    },
    _decoPlacements() {
      const decos = (Farm.state.data && Farm.state.data.decorations) || [];
      if (!decos.length || !Farm.epShop || !Farm.epShop.items || !Farm.epShop.items.length) return [];
      const hp = (d) => Number.isInteger(d.gx) && Number.isInteger(d.gy) && d.gx >= 0 && d.gy >= 0 && d.gx < COLS && d.gy < ROWS;
      if (decos.some((d) => !hp(d))) {
        const occ = this._decoCells(), taken = {};
        decos.forEach((d) => { if (hp(d) && !occ[d.gx + ',' + d.gy]) taken[d.gx + ',' + d.gy] = 1; });
        // Prefer the front-center "yard": rows front→back, columns center→out, so
        // pets/decorations land in the open middle, not the awkward island corners.
        const colOrder = []; const c0 = Math.floor(COLS / 2);
        for (let dd = 0; colOrder.length < COLS; dd++) { if (c0 - dd >= 0) colOrder.push(c0 - dd); if (dd > 0 && c0 + dd < COLS) colOrder.push(c0 + dd); }
        const free = []; for (let gy = ROWS - 1; gy >= 0; gy--) for (const gx of colOrder) { const k = gx + ',' + gy; if (!occ[k] && !taken[k]) free.push(k); }
        // 2026-08-15：新装饰/宠物落在**菜地旁边**而不是最前排的空地 —— 地扩过几阶后前排
        // 离菜地十几格，刚买的小鸡孤零零站在荒地上，还只在自己家附近转，永远走不到菜地。
        // 只在自家地界内挑（_ownedCell），按到菜地几何中心的距离排序（原顺序作次序稳定兜底）。
        const plots2 = Farm.state.data.plots || [];
        if (plots2.length) {
          let sx = 0, sy = 0, n = 0;
          for (let i = 0; i < plots2.length; i++) { if (plots2[i] && plots2[i].unlocked) { sx += this._plotGX(i); sy += this._plotGY(i); n++; } }
          if (n) {
            const cx2 = sx / n, cy2 = sy / n;
            const own = (k) => { const a = k.split(','); return this._ownedCell ? this._ownedCell(+a[0], +a[1]) : true; };
            const dist = (k) => { const a = k.split(','); return Math.abs(+a[0] - cx2) + Math.abs(+a[1] - cy2); };
            free.sort((a, b2) => (own(b2) - own(a)) || (dist(a) - dist(b2)));
          }
        }
        let fi = 0, ch = false;
        decos.forEach((d) => { const it = this._shopItem(d.itemId); if (!it || !it.decoration_emoji) return; if (hp(d) && !occ[d.gx + ',' + d.gy]) return; while (fi < free.length && taken[free[fi]]) fi++; if (fi < free.length) { const k = free[fi++].split(','); d.gx = +k[0]; d.gy = +k[1]; taken[k[0] + ',' + k[1]] = 1; ch = true; } });
        if (ch) Farm.state.save();
      }
      // 走动小动物：只有玩家在「怎么玩」里**明确关掉**（=== false）才藏。
      // 2026-06-18 Chris 定的「默认关闭」针对的是当时白送的两只走路小动物；
      // 现在小动物全是玩家花钱买的（且第四章目标就是「养一只小动物」），
      // 买了看不见比「默认多两只」糟得多（2026-08-15）。买宠物时 ep-shop 也会把开关置 true。
      const out = [], petsOn = !(Farm.state.data && Farm.state.data.petsEnabled === false);
      decos.forEach((d, i) => { if (!hp(d)) return; const it = this._shopItem(d.itemId); if (!it || !it.decoration_emoji) return; const isPet = it.category === 'pet'; if (isPet && !petsOn) return; out.push({ emoji: it.decoration_emoji, itemId: d.itemId, gx: d.gx, gy: d.gy, pet: isPet, seed: i }); });
      return out;
    },
    _drawDeco(d, moving) {
      const ctx = this._ctx, tw = this._tw(), th = this._th(), c = this._cell(d.gx, d.gy);
      if (moving) {
        const ok = !(this._moving && !this._moving.valid);
        this._diamond(c.x, c.y, tw, th);
        ctx.fillStyle = ok ? 'rgba(76,175,80,0.34)' : 'rgba(220,60,60,0.36)'; ctx.fill();
      }
      // painted iso animal sprite for pets — a clean base-less animal that sits on
      // the cell with a gentle idle bob + slight drift (a living pet, not a sliding card).
      const anim = d.itemId && ANIMALS[d.itemId];
      if (anim) {
        const im = this._lazyImg(anim);
        if (im) {
          let cx = c.x, lift = 0;
          if (!moving) { const t = Date.now() / 1000; cx += Math.sin(t * 0.6 + d.seed) * tw * 0.06; lift = Math.abs(Math.sin(t * 1.3 + d.seed)) * th * 0.12; }
          ctx.globalAlpha = moving ? 0.85 : 1;
          this._blit(im, cx, c.y + th * 0.5 - lift, animalH(d.itemId, th) * 1.1, animalH(d.itemId, th));
          ctx.globalAlpha = 1; return;
        }
      }
      // 接地阴影: emoji 装饰以前悬浮在草地上(万物落影, 2026-08-14 打磨)
      this._shadow(c.x, c.y + th * 0.30, tw * 0.42, 0.16);
      // non-animal decorations (static objects) + emoji fallback
      let cx = c.x, by = c.y + th * 0.25;
      if (d.pet && !moving) { const t = Date.now() / 1000; cx += Math.sin(t * 0.6 + d.seed) * tw * 0.06; by -= Math.abs(Math.sin(t * 1.3 + d.seed)) * th * 0.12; }
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = moving ? 0.85 : 1;
      ctx.font = (d.pet ? animalH(d.itemId, th) : th * 1.4) + 'px sans-serif';   // 宠物 emoji 按体型表，别跟人一样高
      ctx.fillText(d.emoji, cx, by); ctx.globalAlpha = 1;
    },
    // A pet may stand on grass/path — not on water, buildings, plots.
    _walkablePet(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return false;
      return !this._decoCells()[gx + ',' + gy];   // _decoCells = plots + buildings + water
    },
    // Advance one pet's wander (toward a random walkable spot near its home),
    // dt seconds. Returns live {fx,fy,face}. Frozen while in build mode.
    _updatePet(seed, hgx, hgy, dt) {
      let p = this._pets[seed];
      if (!p) p = this._pets[seed] = { fx: hgx, fy: hgy, tx: hgx, ty: hgy, pause: 0.4 + (seed % 5) * 0.25, face: 1, hx: hgx, hy: hgy };
      if (Math.abs(hgx - p.hx) > 0.5 || Math.abs(hgy - p.hy) > 0.5) { p.fx = p.tx = hgx; p.fy = p.ty = hgy; }  // home dragged → teleport
      p.hx = hgx; p.hy = hgy;
      if (dt <= 0 || this._build) return p;     // freeze while editing
      if (p.pause > 0) { p.pause -= dt; return p; }
      const dx = p.tx - p.fx, dy = p.ty - p.fy, dist = Math.hypot(dx, dy);
      if (dist < 0.06) {
        // arrived: if standing next to a crop, this pause is a nuzzle/peck.
        p.nuzzle = this._nearCrop(Math.round(p.fx), Math.round(p.fy));
        p.pause = (p.nuzzle ? 1.1 : 0.6) + Math.random() * 1.6;
        // ~45% of the time stroll over to a crop, else wander near home.
        let set = false;
        if (Math.random() < 0.45) { const cc = this._cropAdjacentWalkable(); if (cc.length) { const c = cc[(Math.random() * cc.length) | 0]; p.tx = c[0]; p.ty = c[1]; set = true; } }
        if (!set) for (let t = 0; t < 10; t++) {
          const ngx = Math.max(0, Math.min(COLS - 1, Math.round(hgx + (Math.random() * 5 - 2.5))));
          const ngy = Math.max(0, Math.min(ROWS - 1, Math.round(hgy + (Math.random() * 5 - 2.5))));
          if (this._walkablePet(ngx, ngy)) { p.tx = ngx; p.ty = ngy; break; }
        }
      } else {
        p.nuzzle = false;
        const step = Math.min(dist, 0.62 * dt);
        p.fx += dx / dist * step; p.fy += dy / dist * step;
        const sdir = dx - dy;                     // screen-x movement → face that way
        if (Math.abs(sdir) > 0.02) p.face = sdir > 0 ? 1 : -1;
      }
      return p;
    },
    // Is cell (gx,gy) next to (or on) a planted plot? → pet nuzzles there.
    _nearCrop(gx, gy) {
      const plots = Farm.state.data.plots || [];
      const N = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of N) { const idx = this._cellToPlot[(gx + dx) + ',' + (gy + dy)]; if (idx != null && plots[idx] && plots[idx].crop) return true; }
      return false;
    },
    // Walkable cells adjacent to a planted plot (so a pet can stroll over to nibble).
    _cropAdjacentWalkable() {
      const plots = Farm.state.data.plots || [], out = [], seen = {};
      for (let i = 0; i < plots.length; i++) {
        if (!plots[i] || !plots[i].crop) continue;
        const gx = this._plotGX(i), gy = this._plotGY(i);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = gx + dx, ny = gy + dy, k = nx + ',' + ny; if (!seen[k] && this._walkablePet(nx, ny)) { seen[k] = 1; out.push([nx, ny]); } }
      }
      return out;
    },
    // Pet under a screen tap (animals float between cells), or null.
    _petAt(sx, sy) {
      const th = this._th(), tw = this._tw(); let best = null, bd = tw * 0.6;
      for (const seed in this._pets) {
        const p = this._pets[seed], c = this._cell(p.fx, p.fy);
        const d = Math.hypot(sx - c.x, sy - (c.y - th * 0.45));
        if (d < bd) { bd = d; best = +seed; }
      }
      return best;
    },
    _pettedReact(seed, sx, sy) {
      const p = this._pets[seed]; if (!p) return;
      p.pause = Math.max(p.pause, 0.9); p.react = Date.now() + 750;   // pause + excited window
      const r = this._cv.getBoundingClientRect();
      if (Farm.ui && Farm.ui.floatText) Farm.ui.floatText('❤️', r.left + sx - 10, r.top + sy - 24, '#e8522a');
      if (Farm.audio) Farm.audio.play('tap');
      this.render();
    },
    _drawAnimal(d, fx, fy, face) {
      const ctx = this._ctx, tw = this._tw(), th = this._th(), c = this._cell(fx, fy), p = this._pets[d.seed];
      const im = this._lazyImg(ANIMALS[d.itemId]);
      if (!im) { ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = animalH(d.itemId, th) + 'px sans-serif'; ctx.fillText(d.emoji, c.x, c.y + th * 0.3); return; }
      const t = Date.now() / 1000, now = Date.now();
      const reacting = p && p.react && now < p.react;
      const nuzzling = p && p.pause > 0 && p.nuzzle && !reacting;
      const moving = p && p.pause <= 0;
      // Natural motion: a gentle SMOOTH bob + side-to-side waddle + slight body tilt
      // while walking (no more abs-sin "hopping"); soft breathing when idle.
      let lift = 0, sway = 0, tilt = 0;
      if (reacting) lift = Math.abs(Math.sin(t * 8)) * th * 0.16;                       // happy hop on tap (intentional)
      else if (nuzzling) lift = -Math.abs(Math.sin(t * 5 + d.seed)) * th * 0.04;        // dip to peck
      else if (moving) {
        const ph = t * 5.0 + d.seed;
        lift = (Math.sin(ph) * 0.5 + 0.5) * th * 0.045;   // small smooth body bob
        sway = Math.sin(ph * 0.5) * tw * 0.028;           // waddle left/right
        tilt = Math.sin(ph * 0.5) * 0.045;                // ~2.5° gait tilt
      } else lift = (Math.sin(t * 1.3 + d.seed) * 0.5 + 0.5) * th * 0.025;              // idle breathing
      // 体型按 ANIMAL_SCALE（以摊前路人为尺子）：鸡兔到人脚踝、猫到膝、狗到腰
      const hMax = animalH(d.itemId, th), w = hMax * 1.1, sc = Math.min(w / im.width, hMax / im.height), dw = im.width * sc, dh = im.height * sc;
      const bx = c.x + sway, by = c.y + th * 0.5 - lift;
      this._shadow(c.x, c.y + th * 0.5, dw * 0.62, 0.15);   // static ground shadow (motion reads against it)
      ctx.save(); ctx.translate(bx, by); if (tilt) ctx.rotate(tilt * (face < 0 ? -1 : 1)); ctx.scale(face < 0 ? -1 : 1, 1);
      ctx.drawImage(im, -dw / 2, -dh, dw, dh); ctx.restore();
      // emote above the head: ❤️ when petted, ✨ while nuzzling a crop
      let emote = reacting ? '❤️' : (nuzzling && Math.sin(t * 3 + d.seed) > 0.6 ? '✨' : '');
      if (emote) { ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = (th * 0.7) + 'px sans-serif'; ctx.fillText(emote, bx, by - dh - th * 0.1); }
    },
    _cloud(x, y, w, alpha) {
      const ctx = this._ctx; ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#ffffff';
      const r = w * 0.22;
      [[0, 0, r], [w * 0.22, r * 0.2, r * 0.85], [-w * 0.22, r * 0.15, r * 0.8], [w * 0.08, -r * 0.35, r * 0.7]].forEach((b) => { ctx.beginPath(); ctx.ellipse(x + b[0], y + b[1], b[2], b[2] * 0.72, 0, 0, Math.PI * 2); ctx.fill(); });
      ctx.restore();
    },
    // Calm ambiance instead of a constant emoji "rain": slow drifting clouds always,
    // plus a FEW wandering butterflies (spring/summer) or gentle leaves/snow (autumn/
    // winter). Subtle and natural — adds life without being annoying.
    _drawParticles(tw) {
      const ctx = this._ctx, W = this._cssW(), H = this._cssH(), t = Date.now() / 1000, th = this._th();
      // drifting clouds (sky) — 透明度收敛（audit B2 P2：白色椭圆云团边缘生硬、
      // 像渲染瑕疵）：0.5 → 0.22 起步，融进手绘背景当薄雾，只留 2 朵。
      for (let i = 0; i < 2; i++) { const cw = W * (0.26 + 0.07 * i), x = ((t * (5 + i * 3) + i * W * 0.55) % (W + cw * 1.4)) - cw * 0.7, y = H * (0.05 + 0.05 * i); this._cloud(x, y, cw, 0.22 - i * 0.07); }
      const season = (Farm.seasons && Farm.seasons.current) || monthSeason();
      if (season === 'autumn' || season === 'winter') {
        const n = season === 'winter' ? 9 : 6;
        ctx.save();
        for (let i = 0; i < n; i++) {
          const sp = 9 + (i % 4) * 4, x = (i * 97.3) % W, sway = Math.sin(t * 0.5 + i) * 20;
          const y = ((t * sp + i * 70) % (H + 40)) - 20, s = th * 0.18;
          if (season === 'winter') {
            ctx.globalAlpha = 0.72; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(x + sway - s, y); ctx.lineTo(x + sway + s, y);
            ctx.moveTo(x + sway, y - s); ctx.lineTo(x + sway, y + s);
            ctx.moveTo(x + sway - s * 0.7, y - s * 0.7); ctx.lineTo(x + sway + s * 0.7, y + s * 0.7);
            ctx.moveTo(x + sway + s * 0.7, y - s * 0.7); ctx.lineTo(x + sway - s * 0.7, y + s * 0.7);
            ctx.stroke();
          } else {
            ctx.globalAlpha = 0.7; ctx.fillStyle = '#c86a32';
            ctx.beginPath(); ctx.ellipse(x + sway, y, s * 1.1, s * 0.55, 0.6, 0, 6.283); ctx.fill();
          }
        }
        ctx.restore();
      } else {
        ctx.save();
        for (let i = 0; i < 2; i++) {
          const x = W * (0.28 + 0.4 * i) + Math.sin(t * 0.45 + i * 2) * W * 0.14 + Math.sin(t * 1.6 + i) * 12;
          const y = H * 0.66 + Math.cos(t * 0.62 + i * 2) * H * 0.08 + Math.sin(t * 3.0 + i) * 6;
          const fl = 0.78 + Math.abs(Math.sin(t * 6 + i)) * 0.32;
          const s = th * 0.16 * fl;
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = i ? '#e8a050' : '#d478b0';
          ctx.beginPath(); ctx.ellipse(x - s * 0.7, y, s, s * 0.55, -0.5, 0, 6.283); ctx.fill();
          ctx.beginPath(); ctx.ellipse(x + s * 0.7, y, s, s * 0.55, 0.5, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#4a3629';
          ctx.beginPath(); ctx.ellipse(x, y, s * 0.18, s * 0.45, 0, 0, 6.283); ctx.fill();
        }
        ctx.restore();
      }
    },
    _drawFestival() {
      const id = Farm.events && Farm.events.getActiveFestivalId && Farm.events.getActiveFestivalId(); if (!id) return;
      const ctx = this._ctx, W = this._cssW(), t = Date.now() / 1000, th = this._th();
      if (id === 'spring_festival') {
        const n = Math.max(3, Math.floor(W / 72));
        for (let i = 0; i < n; i++) {
          const x = (i + 0.5) * (W / n), y = 18 + Math.sin(t * 1.2 + i) * 4, s = th * 0.42;
          ctx.fillStyle = '#c44536';
          if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x - s * 0.38, y, s * 0.76, s * 0.9, s * 0.2); ctx.fill(); }
          else { ctx.fillRect(x - s * 0.38, y, s * 0.76, s * 0.9); }
          ctx.fillStyle = '#f6c945';
          ctx.fillRect(x - s * 0.42, y, s * 0.84, s * 0.14);
          ctx.fillStyle = '#8a2a22';
          ctx.fillRect(x - 1, y + s * 0.9, 2, s * 0.22);
        }
      } else if (id === 'mid_autumn') {
        const x = W - 56, y = 56;
        ctx.save();
        ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.arc(x, y, 48, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,245,200,0.7)'; ctx.fill();
        ctx.globalAlpha = 0.92; ctx.beginPath(); ctx.arc(x, y, 28, 0, Math.PI * 2); ctx.fillStyle = '#f3e0a0'; ctx.fill();
        ctx.fillStyle = 'rgba(210,170,70,0.35)';
        ctx.beginPath(); ctx.arc(x + 8, y - 4, 8, 0, 6.283); ctx.fill();
        ctx.restore();
      }
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.isoView = iso;
})();
