/**
 * neighbors.js — Procedural neighbor farms.
 *
 * Generates 60 fictional neighbor profiles (Saskatoon Chinese community
 * themed). Each day, 3 are picked deterministically by date hash. Players
 * can view each neighbor's farm (read-only) to satisfy the daily visit
 * task (+5 EP after visiting all 3).
 *
 * Future (V2): replace procedural with real other players' farms.
 */
(function() {
  // 60 names + cute avatar emojis
  const POOL = [
    { name_zh: '王阿姨', name_en: 'Auntie Wang', emoji: '👩' },
    { name_zh: '张大叔', name_en: 'Uncle Zhang', emoji: '👨' },
    { name_zh: '李奶奶', name_en: 'Grandma Li', emoji: '👵' },
    { name_zh: '陈爷爷', name_en: 'Grandpa Chen', emoji: '👴' },
    { name_zh: '小红', name_en: 'Little Hong', emoji: '👧' },
    { name_zh: '小明', name_en: 'Little Ming', emoji: '👦' },
    { name_zh: '林姐', name_en: 'Sister Lin', emoji: '👩' },
    { name_zh: '吴先生', name_en: 'Mr. Wu', emoji: '🧑' },
    { name_zh: '萨城老华侨', name_en: 'Old Saskatoon Chinese', emoji: '🧓' },
    { name_zh: '阿芳', name_en: 'Ah Fang', emoji: '👩' },
    { name_zh: '阿杰', name_en: 'Ah Jie', emoji: '🧑' },
    { name_zh: '杨妈妈', name_en: 'Mama Yang', emoji: '👩‍🦰' },
    { name_zh: '黄医生', name_en: 'Dr. Huang', emoji: '👨‍⚕️' },
    { name_zh: '周师傅', name_en: 'Master Zhou', emoji: '👨‍🍳' },
    { name_zh: '何大姐', name_en: 'Big Sister He', emoji: '👩' },
    { name_zh: '何小弟', name_en: 'Little He', emoji: '👦' },
    { name_zh: '老赵', name_en: 'Old Zhao', emoji: '🧓' },
    { name_zh: '徐二哥', name_en: 'Brother Xu', emoji: '🧑' },
    { name_zh: '孙阿姨', name_en: 'Auntie Sun', emoji: '👩' },
    { name_zh: '马奶奶', name_en: 'Grandma Ma', emoji: '👵' },
    { name_zh: '朱小姐', name_en: 'Miss Zhu', emoji: '👩' },
    { name_zh: '宋大伯', name_en: 'Uncle Song', emoji: '👨' },
    { name_zh: '冯婶婶', name_en: 'Aunt Feng', emoji: '👩' },
    { name_zh: '韩老板', name_en: 'Boss Han', emoji: '🧑‍💼' },
    { name_zh: '叶老师', name_en: 'Teacher Ye', emoji: '👩‍🏫' },
    { name_zh: '梁同学', name_en: 'Classmate Liang', emoji: '👨‍🎓' },
    { name_zh: '于姐', name_en: 'Sister Yu', emoji: '👩' },
    { name_zh: '萨大留学生', name_en: 'U of S Student', emoji: '👨‍🎓' },
    { name_zh: '小芸', name_en: 'Xiao Yun', emoji: '👧' },
    { name_zh: '老程', name_en: 'Old Cheng', emoji: '🧓' },
    { name_zh: '柯先生', name_en: 'Mr. Ke', emoji: '🧑' },
    { name_zh: '蓝色清晨', name_en: 'Blue Morning', emoji: '🌅' },
    { name_zh: '麦穗金黄', name_en: 'Golden Wheat', emoji: '🌾' },
    { name_zh: '草原微风', name_en: 'Prairie Breeze', emoji: '🌬' },
    { name_zh: '北极光', name_en: 'Northern Lights', emoji: '✨' },
    { name_zh: '雪松', name_en: 'Snowy Pine', emoji: '🌲' },
    { name_zh: 'Bessborough', name_en: 'Bessborough', emoji: '🏨' },
    { name_zh: '8th 街菜农', name_en: '8th Street Farmer', emoji: '🧑‍🌾' },
    { name_zh: '河边的老树', name_en: 'Riverside Oak', emoji: '🌳' },
    { name_zh: '王师傅炒饭', name_en: 'Chef Wang', emoji: '👨‍🍳' },
    { name_zh: '萨村小贺', name_en: 'Sask He', emoji: '🧑' },
    { name_zh: '北风', name_en: 'North Wind', emoji: '💨' },
    { name_zh: '阿强大叔', name_en: 'Uncle Qiang', emoji: '👨' },
    { name_zh: '小天才', name_en: 'Little Genius', emoji: '👶' },
    { name_zh: '红梅', name_en: 'Red Plum', emoji: '🌺' },
    { name_zh: '一直在', name_en: 'Always Here', emoji: '🌟' },
    { name_zh: '种菜机器人', name_en: 'Farm Bot', emoji: '🤖' },
    { name_zh: '夜班司机', name_en: 'Night Driver', emoji: '🚛' },
    { name_zh: '萨城宝妈', name_en: 'Sask Mom', emoji: '👩' },
    { name_zh: '广东客', name_en: 'Cantonese', emoji: '🧑' },
    { name_zh: '川辣大姐', name_en: 'Sichuan Sister', emoji: '👩' },
    { name_zh: '东北老铁', name_en: 'NE Buddy', emoji: '👨' },
    { name_zh: '福建小妹', name_en: 'Fujian Girl', emoji: '👧' },
    { name_zh: '台湾阿伯', name_en: 'Taiwan Uncle', emoji: '👨' },
    { name_zh: '上海宁', name_en: 'Shanghainese', emoji: '🧑' },
    { name_zh: '北京胡同', name_en: 'Beijing Hutong', emoji: '🧓' },
    { name_zh: '一日三餐', name_en: 'Three Meals', emoji: '🍚' },
    { name_zh: '湖南辣妹', name_en: 'Hunan Girl', emoji: '👧' },
    { name_zh: '广州师傅', name_en: 'GZ Chef', emoji: '👨‍🍳' },
    { name_zh: '萨村新邻居', name_en: 'New Neighbor', emoji: '🧑' },
  ];

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }
  function mulberry32(seed) {
    return function() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = seed;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const neighbors = {
    getTodaysSet() {
      const today = Farm.state.getDateString();
      const rng = mulberry32(hashStr(today + ':neighbors'));
      const picks = new Set();
      while (picks.size < 3) {
        picks.add(Math.floor(rng() * POOL.length));
      }
      return Array.from(picks).map((idx, order) => ({
        id: 'neighbor_' + today + '_' + idx,
        index: idx,
        profile: POOL[idx],
        order,
      }));
    },

    // Generate this neighbor's farm content (deterministic by id)
    generateFarm(neighbor) {
      const playerLevel = Farm.state.data.level;
      const available = Farm.crops.all().filter(c => c.unlock_level <= Math.min(playerLevel + 2, 10));
      const rng = mulberry32(hashStr(neighbor.id + ':farm'));
      const plots = [];
      const totalPlots = 12;
      const occupiedCount = 6 + Math.floor(rng() * 5);  // 6-10 plots occupied
      for (let i = 0; i < totalPlots; i++) {
        if (i < occupiedCount && available.length > 0) {
          const def = available[Math.floor(rng() * available.length)];
          const stage = Math.floor(rng() * 3);  // 0/1/2 random
          plots.push({ cropId: def.id, stage });
        } else {
          plots.push({ cropId: null, stage: -1 });
        }
      }
      const decos = [];
      // 0-2 decorations
      const decoCount = Math.floor(rng() * 3);
      const decoEmojis = ['🏮', '🎐', '🌷', '🌻', '🦋'];
      for (let i = 0; i < decoCount; i++) {
        decos.push(decoEmojis[Math.floor(rng() * decoEmojis.length)]);
      }
      // Activity level for flavor text
      const level = 2 + Math.floor(rng() * 8);  // Lv 2-10
      return { plots, decos, neighborLevel: level };
    },

    open() {
      const lang = Farm.state.data.language;
      const today = Farm.state.getDateString();
      const set = this.getTodaysSet();
      const visited = Farm.state.data.dailyClaims.neighborsVisited || [];

      const html = `
        <h2 class="modal-title">🏘 ${lang === 'en' ? "Today's Neighbors" : '今日邻居'}</h2>
        <p class="modal-subtitle">
          ${lang === 'en' ? 'Visit all 3 → +5 <span class="points-icon"></span>' : '走访 3 户 → +5 <span class="points-icon"></span>'}
          (${visited.length}/3)
        </p>
        <div class="neighbor-list">
          ${set.map(n => {
            const isVisited = visited.includes(n.id);
            const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
            return `
              <div class="neighbor-card ${isVisited ? 'visited' : ''}" data-id="${n.id}" data-idx="${n.index}">
                <div class="neighbor-avatar">${n.profile.emoji}</div>
                <div class="neighbor-name">${n.profile[nameKey]}</div>
                <div class="neighbor-status">
                  ${isVisited ? '✅ ' + (lang === 'en' ? 'Visited' : '已访问') : '🚪 ' + (lang === 'en' ? 'Visit' : '去看看')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
        <div class="btn-row">
          <button class="btn secondary" onclick="Farm.ui.hideModal()">${Farm.i18n.t('btn_close')}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      document.querySelectorAll('.neighbor-card').forEach(card => {
        card.onclick = () => {
          const id = card.dataset.id;
          const idx = parseInt(card.dataset.idx, 10);
          this.viewFarm({ id, index: idx, profile: POOL[idx] });
        };
      });
    },

    viewFarm(neighbor) {
      const lang = Farm.state.data.language;
      const farm = this.generateFarm(neighbor);
      const nameKey = lang === 'en' ? 'name_en' : 'name_zh';
      const cropNameKey = lang === 'en' ? 'name_en' : 'name_zh';

      const plotsHTML = farm.plots.map(p => {
        if (!p.cropId) {
          return '<div class="neighbor-plot empty"></div>';
        }
        const def = Farm.crops.get(p.cropId);
        if (!def) return '<div class="neighbor-plot empty"></div>';
        const isMature = p.stage >= 2;
        const svg = Farm.cropArt ? Farm.cropArt.svg(p.cropId, p.stage, 40) : `<span style="font-size:28px;">${def.icon}</span>`;
        return `<div class="neighbor-plot ${isMature ? 'mature' : 'growing'}">${svg}</div>`;
      }).join('');

      const decoHTML = farm.decos.length > 0
        ? '<div class="neighbor-decos">' + farm.decos.map(e => `<span>${e}</span>`).join('') + '</div>'
        : '';

      const greetings = lang === 'en' ? [
        'Welcome to my farm!',
        'Look at my crops!',
        'Just harvested some great greens today.',
        'My grandkids love this game.',
        'I shop at Eastern Market every Saturday.',
      ] : [
        '欢迎来到我的农场！',
        '看看我的菜长得多好。',
        '今天刚收了一波青菜。',
        '我孙子也喜欢玩这个游戏。',
        '我每周六去东方超市采购。',
      ];
      const greeting = greetings[Math.floor(Math.random() * greetings.length)];

      const html = `
        <h2 class="modal-title">${neighbor.profile.emoji} ${neighbor.profile[nameKey]}</h2>
        <div class="neighbor-greeting">"${greeting}"</div>
        <div style="font-size:11px;text-align:center;color:var(--warm-text-soft);margin-bottom:8px;">
          Lv ${farm.neighborLevel} ${lang === 'en' ? 'Farmer' : '农夫'}
        </div>
        <div class="neighbor-farm">${plotsHTML}</div>
        ${decoHTML}
        <div class="btn-row">
          <button class="btn secondary" id="neighborBack">${lang === 'en' ? 'Back' : '返回'}</button>
        </div>
      `;
      Farm.ui.showModal(html);

      // Mark visited + reward if 3rd
      const wasNew = Farm.state.claimNeighborVisit(neighbor.id);
      if (wasNew) {
        const visited = Farm.state.data.dailyClaims.neighborsVisited;
        if (visited.length === 3) {
          // Award the +5 EP
          Farm.state.addEastPoints(5, {
            source: 'neighbor_visit_complete',
            description: 'Visited 3 neighbors today',
          });
          Farm.ui.refreshHUD();
          setTimeout(() => {
            Farm.ui.toast(lang === 'en' ? '🎉 Visited 3 neighbors! +5 <span class="points-icon"></span>' : '🎉 走访 3 户完成 +5 <span class="points-icon"></span>', 3000);
            if (Farm.audio) Farm.audio.play('achievement');
          }, 400);
        }
      }

      document.getElementById('neighborBack').onclick = () => this.open();
    },
  };

  window.Farm = window.Farm || {};
  window.Farm.neighbors = neighbors;
})();
