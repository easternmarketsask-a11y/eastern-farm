(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 50 && !(window.Farm && Farm.aiNeighbors && Farm.aiNeighbors.loaded && Farm.crops && Farm.crops.loaded && Farm.neighbors); i++) await sleep(150);
  const F = window.Farm;
  const out = { steps: [] };
  const ok = (name, cond, extra) => out.steps.push({ name, pass: !!cond, ...extra });
  const AN = F.aiNeighbors;

  ok('roster has 12', AN.roster.length === 12, { n: AN.roster.length });
  const id = 'wang_ayi';

  // --- determinism: same (id,now) identical; different now differs ---
  const now = Date.now();
  const a1 = JSON.stringify(AN.farmStateAt(id, now));
  const a2 = JSON.stringify(AN.farmStateAt(id, now));
  const a3 = JSON.stringify(AN.farmStateAt(id, now + 7 * 3600 * 1000));
  ok('farmStateAt deterministic (same now)', a1 === a2);
  ok('farmStateAt evolves (later now differs)', a1 !== a3);

  // --- at least several mature plots across all AIs right now (stealable) ---
  let matureTotal = 0, occupiedTotal = 0;
  AN.ids().forEach(aid => AN.farmStateAt(aid, now).forEach(p => { if (p.cropId) occupiedTotal++; if (p.mature) matureTotal++; }));
  ok('AIs have occupied plots', occupiedTotal > 40, { occupiedTotal });
  ok('AIs have mature(stealable) crops now', matureTotal > 5, { matureTotal });
  // crop ids valid
  const sample = AN.farmStateAt(id, now).filter(p => p.cropId);
  const allValid = sample.every(p => !!F.crops.get(p.cropId));
  ok('AI crops are valid catalog ids', allValid);

  // --- levelAt grows past base, capped, deterministic ---
  const base = AN.get(id).baseLevel;
  const lv = AN.levelAt(id, now);
  ok('levelAt > base (epoch in past)', lv > base, { base, lv });
  ok('levelAt <= 60', lv <= 60);
  ok('levelAt deterministic', AN.levelAt(id, now) === lv);

  ok('isActiveNow boolean', typeof AN.isActiveNow(id, now) === 'boolean');

  // --- dailyPick deterministic ---
  const p1 = AN.dailyPick(3, '2026-06-09').join(',');
  const p2 = AN.dailyPick(3, '2026-06-09').join(',');
  const p3 = AN.dailyPick(3, '2026-06-10').join(',');
  ok('dailyPick deterministic same date', p1 === p2, { p1 });
  ok('dailyPick differs other date', p1 !== p3, { p1, p3 });
  ok('dailyPick returns 3 distinct', new Set(AN.dailyPick(3, '2026-06-09')).size === 3);

  // --- today list backfills AI when no real members (stub real=[]) ---
  F.fbGameSync.fetchVisiblePool = async () => [];
  F.neighbors._todayList = null;
  const today = await F.neighbors._fetchToday();
  ok('today has 3', today.length === 3, { n: today.length });
  ok('today all AI (no reals)', today.every(t => t.isAI === true));

  // --- leaderboard merges + sorts AI (stub real=[]) ---
  F.fbGameSync.fetchLeaderboard = async () => [];
  F.neighbors._leaderboardList = null;
  const lb = await F.neighbors._fetchLeaderboard('level');
  ok('leaderboard has AI rows', lb.length > 0 && lb.some(r => r.isAI), { n: lb.length });
  const sortedDesc = lb.every((r, i) => i === 0 || (lb[i - 1].value || 0) >= (r.value || 0));
  ok('leaderboard sorted desc by value', sortedDesc);
  ok('leaderboard capped 10', lb.length <= 10);

  // --- local interact: like / help / cap ---
  const coins0 = F.state.data.coins;
  const r1 = AN.interact('wang_ayi', 'like');
  ok('like ok +5 coins', r1.ok && F.state.data.coins === coins0 + 5, { r1, coins: F.state.data.coins });
  ok('relationship recorded', F.state.data.aiRelationships.wang_ayi && F.state.data.aiRelationships.wang_ayi.likedByMe === true);
  const r1b = AN.interact('wang_ayi', 'like');
  ok('like dedup same target', r1b.ok === false && r1b.reason === 'already_liked');
  const coinsH = F.state.data.coins;
  const rh = AN.interact('zhang_dashu', 'help');
  ok('help ok +10 coins', rh.ok && F.state.data.coins === coinsH + 10);
  ok('help relationship', F.state.data.aiRelationships.zhang_dashu.helpedByMe === true);
  // fill like cap (already 1 used: wang). 4 more distinct → cap 5; 6th fails
  ['li_nainai', 'chen_yeye', 'xiao_hong', 'xiao_ming'].forEach(x => AN.interact(x, 'like'));
  const rCap = AN.interact('sask_mom', 'like');
  ok('like cap at 5', rCap.ok === false && rCap.reason === 'cap_reached', { rCap });

  // --- viewFarm renders AI farm without throwing ---
  let threw = false;
  try { F.neighbors.viewFarm(AN.displayCard('lao_liu', now)); } catch (e) { threw = true; out.viewErr = String(e); }
  const html = (document.getElementById('modalContent') || {}).innerHTML || '';
  ok('viewFarm no throw', !threw);
  ok('viewFarm shows farm plots', html.includes('neighbor-farm') && html.includes('neighbor-plot'));

  out.allPass = out.steps.every(s => s.pass);
  return out;
})()
