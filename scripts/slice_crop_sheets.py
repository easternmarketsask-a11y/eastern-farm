# -*- coding: utf-8 -*-
"""
slice_crop_sheets.py — 把 Gemini 生成的作物 sheet 切成单个透明底 sprite。

流水线（每格）:
  1. 按网格均分裁出格子
  2. 白底掩码(RGB 全 >= WHITE_T) → 反掩码 = 内容
  3. 取最大连通块(自动剔除 Gemini 偷加的文字标签/碎屑)
  4. 对掩码内容做边缘羽化 alpha → 裁 bbox → 加边距 → 等比缩放进 SIZE 方画布
  5. 存 src/assets/crops/{crop_id}.png

用法: python scripts/slice_crop_sheets.py "D:/Pictures/farm pictures"
"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage  # 若无 scipy 用下面的 fallback

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'crops')
SIZE = 160          # 输出画布(正方形)
MARGIN = 6          # 内容四周留白(输出像素)
WHITE_T = 232       # 白底阈值(JPEG 噪声容忍)

# sheet 精确文件名 -> (rows, cols, 使用的行数, [crop_id 按行优先])
# 注意：目录里还有 "10.42.19 PM (1).jpeg" 是农场全景参考图，不是 sheet，勿匹配。
SHEETS = {
    'WhatsApp Image 2026-06-10 at 10.42.19 PM.jpeg': (2, 3, 2,
        ['shanghai_miao', 'ji_mao_cai', 'wa_wa_cai',
         'da_bai_cai', 'cai_xin', 'you_mai_cai']),
    'WhatsApp Image 2026-06-10 at 10.42.20 PM.jpeg': (2, 3, 2,
        ['bo_cai', 'tong_hao', 'cilantro',
         'jiucai', 'xiao_cong', 'jing_cong']),
    'WhatsApp Image 2026-06-10 at 10.42.20 PM (1).jpeg': (2, 3, 2,
        ['niu_jiao_jiao', 'eggplant', 'dong_gua',
         'xi_lan_hua', 'tw_cauliflower', 'wo_sun']),
    'WhatsApp Image 2026-06-10 at 10.42.20 PM (2).jpeg': (2, 3, 2,
        ['hu_luo_bo', 'bai_luo_bo', 'lian_ou',
         'shan_yao', 'sheng_jiang', 'taro']),
    'WhatsApp Image 2026-06-10 at 10.42.20 PM (3).jpeg': (3, 3, 2,
        ['pa_pa_gan', 'wo_gan', 'sha_tang_ju',
         'kumquat', 'pomelo', 'pi_pa']),
    'WhatsApp Image 2026-06-10 at 10.44.04 PM.jpeg': (3, 3, 2,
        ['suan_tai', 'chun_sun', 'ye_zi',
         'mang_guo', 'huo_long_guo', 'xiang_yin_putao']),
}

def largest_component(mask):
    lab, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return lab == (int(np.argmax(sizes)) + 1)

def process_cell(img, crop_id):
    a = np.asarray(img.convert('RGB')).astype(np.int16)
    white = (a[:, :, 0] >= WHITE_T) & (a[:, :, 1] >= WHITE_T) & (a[:, :, 2] >= WHITE_T)
    content = largest_component(~white)
    if not content.any():
        print('  !! empty cell for', crop_id)
        return None
    # 膨胀 1px 保住描边的抗锯齿边缘，再算软 alpha
    grown = ndimage.binary_dilation(content, iterations=2)
    # 软 alpha：白度越高越透明（只在 grown 边缘区生效，内部全不透明）
    whiteness = a.max(axis=2).astype(np.float32)
    alpha = np.where(content, 255,
                     np.where(grown, np.clip((250 - whiteness) * 3, 0, 255), 0)).astype(np.uint8)
    ys, xs = np.where(alpha > 8)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    rgba = np.dstack([a.astype(np.uint8), alpha])[y0:y1, x0:x1]
    sprite = Image.fromarray(rgba, 'RGBA')
    # 等比缩放进 SIZE 方画布
    w, h = sprite.size
    scale = (SIZE - 2 * MARGIN) / max(w, h)
    sprite = sprite.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(sprite, ((SIZE - sprite.size[0]) // 2, (SIZE - sprite.size[1]) // 2), sprite)
    return canvas

def main(src_dir):
    os.makedirs(OUT_DIR, exist_ok=True)
    done = 0
    for key, (rows, cols, use_rows, ids) in SHEETS.items():
        path = os.path.join(src_dir, key)
        if not os.path.exists(path):
            print('!! sheet not found:', key); continue
        img = Image.open(path)
        W, H = img.size
        cw, ch = W / cols, H / rows
        print(f'{key} -> {rows}x{cols} use {use_rows} rows ({W}x{H})')
        k = 0
        for r in range(use_rows):
            for c in range(cols):
                cell = img.crop((int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch)))
                out = process_cell(cell, ids[k])
                if out is not None:
                    out.save(os.path.join(OUT_DIR, ids[k] + '.png'), optimize=True)
                    done += 1
                k += 1
    print('saved', done, 'sprites ->', os.path.abspath(OUT_DIR))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else r'D:/Pictures/farm pictures')
