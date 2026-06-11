/**
 * tending.js — 打理系统：浇水 / 施肥（可选加成，绝不强制）。
 *
 * 设计原则（spec 2026-06-09）：不浇水/不施肥，作物照常生长与收获；
 * 浇水只是让「来得勤、用心打理」的玩家多得好处，不变成强制杂活。
 *
 *   Farm.tending.waterPlot(idx)        玩家点「浇水」：剩余时间 -20%，每周期 1 次
 *   Farm.tending.applyWaterSpeedup(p)  纯函数：对某 plot 施加一次浇水提速（供 T5「帮浇水」复用）
 *   Farm.tending.canWater(plot)        该 plot 现在能否浇水
 *
 * 施肥（fertilize*）在 T2 加入本模块。
 */
(function () {
  // 浇水提速比例：统一从 Farm.socialConfig 读取（单一来源），缺失时回落 0.2。
  function waterSpeedup() {
    return (Farm.socialConfig && Farm.socialConfig.WATER_SPEEDUP) || 0.2;
  }

  const tending = {
    // 生长中（未成熟）且本周期未浇水才可浇。
    canWater(plot) {
      if (!plot || !plot.crop || plot.watered) return false;
      return !Farm.crops.isMature(plot);
    },

    // 纯逻辑：对一块在长作物施加一次浇水提速并标记已浇。
    // 返回 { ok, shavedMs }。不做任何 UI（供玩家浇水与「帮浇水」共用）。
    applyWaterSpeedup(plot) {
      if (!this.canWater(plot)) return { ok: false, shavedMs: 0 };
      const shaved = Farm.crops.speedUp(plot, waterSpeedup());
      plot.watered = true;
      return { ok: true, shavedMs: shaved };
    },

    // 玩家主动浇水：校验 → 提速 → 存档 → 视觉 → 重渲染。
    waterPlot(plotIdx) {
      const plot = Farm.state.data.plots[plotIdx];
      const lang = Farm.state.data.language;
      if (!plot || !plot.crop) return false;
      if (Farm.crops.isMature(plot)) {
        Farm.ui.toast(Farm.i18n.t('tending_water_mature'));
        return false;
      }
      if (plot.watered) {
        Farm.ui.toast(Farm.i18n.t('tending_water_done'));
        return false;
      }
      const r = this.applyWaterSpeedup(plot);
      if (!r.ok) return false;
      Farm.state.save();
      if (Farm.audio) Farm.audio.play('coin');

      // 视觉：地块短暂蓝色水光 + 飘字
      const el = document.querySelector('.plot[data-plot-id="' + plotIdx + '"]');
      if (el) {
        el.classList.add('just-watered');
        setTimeout(() => el.classList.remove('just-watered'), 900);
        const rect = el.getBoundingClientRect();
        if (Farm.ui && Farm.ui.floatText) {
          Farm.ui.floatText('💧 ' + (lang === 'en' ? 'Watered' : '浇水'),
            rect.left + rect.width / 2 - 18, rect.top, '#2e86c1');
        }
      }
      if (Farm.farm) Farm.farm.renderGrid();
      Farm.ui.toast(Farm.i18n.t('tending_water_toast'), 1800);
      if (Farm.coach) Farm.coach.fire('first_water', 2000);   // 首次浇水：解释加成
      return true;
    },

    // ============ 施肥 ============
    fertilizerCount() {
      const eff = Farm.state.data.activeEffects || {};
      return eff.fertilizerCharges || 0;
    },

    // 有作物、本块未施肥、且库存里有化肥才可施。
    canFertilize(plot) {
      if (!plot || !plot.crop || plot.fertilized) return false;
      return this.fertilizerCount() > 0;
    },

    // 玩家施肥：消耗 1 袋化肥 → 标记本块，成熟收获时产量翻倍（crops.harvest 读 plot.fertilized）。
    fertilizePlot(plotIdx) {
      const plot = Farm.state.data.plots[plotIdx];
      const lang = Farm.state.data.language;
      if (!plot || !plot.crop) return false;
      if (plot.fertilized) {
        Farm.ui.toast(Farm.i18n.t('tending_fert_done'));
        return false;
      }
      if (this.fertilizerCount() <= 0) {
        Farm.ui.toast(Farm.i18n.t('tending_fert_none'));
        return false;
      }
      Farm.state.data.activeEffects.fertilizerCharges -= 1;
      plot.fertilized = true;
      Farm.state.save();
      if (Farm.audio) Farm.audio.play('buy');

      const el = document.querySelector('.plot[data-plot-id="' + plotIdx + '"]');
      if (el) {
        el.classList.add('just-fertilized');
        setTimeout(() => el.classList.remove('just-fertilized'), 1000);
        const rect = el.getBoundingClientRect();
        if (Farm.ui && Farm.ui.floatText) {
          Farm.ui.floatText('🌟 ' + (lang === 'en' ? 'Fertilized' : '施肥'),
            rect.left + rect.width / 2 - 18, rect.top, '#e08a00');
        }
      }
      if (Farm.farm) Farm.farm.renderGrid();
      Farm.ui.toast(Farm.i18n.t('tending_fert_toast'), 2000);
      return true;
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.tending = tending;
})();
