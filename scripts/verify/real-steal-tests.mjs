// Real-member steal logic tests (mocked Firebase): R1-R6.
import WebSocket from 'ws';
import fs from 'fs';
import http from 'http';
function getJson(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
let id=0;const pend=new Map();let ws;
function send(m,p={},s){return new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p,...(s?{sessionId:s}:{})}));});}
const ver=await getJson('http://localhost:9234/json/version');
ws=new WebSocket(ver.webSocketDebuggerUrl,{maxPayload:256*1024*1024});
await new Promise(r=>ws.on('open',r));
ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}});
const {targetId}=await send('Target.createTarget',{url:'about:blank'});
const {sessionId:S}=await send('Target.attachToTarget',{targetId,flatten:true});
await send('Page.enable',{},S);await send('Network.enable',{},S);await send('Network.setCacheDisabled',{cacheDisabled:true},S);
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true},S);
await send('Page.navigate',{url:'http://localhost:8778/src/index.html'},S);
await new Promise(r=>setTimeout(r,3500));
async function ev(e){const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true},S);return r.result&&r.result.value;}

console.log(await ev(`(async function(){
  const out = [];
  const T = (name, cond) => out.push((cond ? 'PASS ' : 'FAIL ') + name);
  Farm.state.data.tutorialV1Done = true;
  var sp = document.getElementById('splash'); if (sp) sp.remove();

  // ===== mocks =====
  let sentEvents = [];
  Farm.fbGameSync.sendStealEvent = async (uid, evt) => { sentEvents.push({ uid, evt }); return { ok: true }; };
  let serverEvents = [];
  Farm.fbGameSync.fetchAndClearStealEvents = async () => { const e = serverEvents; serverEvents = []; return e; };
  Farm.fbAuth = Farm.fbAuth || {};
  Farm.fbAuth.memberDocId = () => 'me_uid';
  Farm.fbAuth.uid = () => 'me_uid';
  Farm.fbAuth.isLoggedIn = () => true;

  // ===== R1: thief side — stealFromReal success path =====
  Farm.state.data.level = 5;
  Farm.state.data.coins = 100;
  Farm.state.data.dailyClaims.stolenToday = 0;
  Farm.state.data.dailyClaims.stolenFromTargets = {};
  Farm.state.data.warehouse = [];
  const victim = { uid: 'v1', name: '测试受害者', level: 5, hasGuardDog: false };
  const r1 = await Farm.steal.stealFromReal(victim, { plotIdx: 2, cropId: 'cai_xin', plantedAt: 111 });
  T('R1 steal ok', r1.ok === true);
  T('R1 event sent', sentEvents.length === 1 && sentEvents[0].uid === 'v1' && sentEvents[0].evt.kind === 'steal' && sentEvents[0].evt.plotIdx === 2);

  // ===== R2: newbie protection =====
  const r2 = await Farm.steal.stealFromReal({ uid: 'v2', name: 'n', level: 2, hasGuardDog: false }, { plotIdx: 0, cropId: 'cai_xin', plantedAt: 1 });
  T('R2 newbie blocked', r2.ok === false && r2.reason === 'newbie_protected');

  // ===== R3: dog cap (cap 2-1=1; already stole 1 from v3) =====
  Farm.state.data.dailyClaims.stolenFromTargets['v3'] = 1;
  const r3 = await Farm.steal.stealFromReal({ uid: 'v3', name: 'n', level: 9, hasGuardDog: true }, { plotIdx: 0, cropId: 'cai_xin', plantedAt: 1 });
  T('R3 dog cap', r3.ok === false && r3.reason === 'dog_cap');

  // ===== R4: dog catch (force random) =====
  const realRandom = Math.random; Math.random = () => 0.05;
  const coinsBefore = Farm.state.data.coins;
  sentEvents = [];
  const r4 = await Farm.steal.stealFromReal({ uid: 'v4', name: 'n', level: 9, hasGuardDog: true }, { plotIdx: 1, cropId: 'cai_xin', plantedAt: 7 });
  Math.random = realRandom;
  T('R4 caught', r4.ok === false && r4.reason === 'caught');
  T('R4 fine paid', Farm.state.data.coins === coinsBefore - 20);
  T('R4 caught event', sentEvents.length === 1 && sentEvents[0].evt.kind === 'caught');

  // ===== R5: victim settle — valid steal clears plot; stale/immature/over-cap voided =====
  const now = Date.now();
  const def = Farm.crops.get('shanghai_miao');
  const growMs = def.grow_minutes * 60000;
  const P = Farm.state.data.plots;
  function setPlot(i, planted) { P[i].unlocked = true; P[i].crop = 'shanghai_miao'; P[i].plantedAt = planted; P[i].harvestsLeft = 1; }
  setPlot(0, now - growMs - 5000);   // mature, matches evt
  setPlot(1, now - growMs - 5000);   // mature but evt has WRONG plantedAt (replay) -> void
  setPlot(2, now - 1000);            // immature -> void
  setPlot(3, now - growMs - 5000);   // mature, but over LOST_DAILY_MAX after first -> set cap to test
  Farm.state.data.dailyClaims.lostToRealToday = 2;   // 已被偷2 -> 本轮只能再丢1
  serverEvents = [
    { kind: 'steal', thiefName: '阿测', thiefUid: 'tA', plotIdx: 0, cropId: 'shanghai_miao', plantedAt: P[0].plantedAt, at: 1 },
    { kind: 'steal', thiefName: '阿测', thiefUid: 'tA', plotIdx: 1, cropId: 'shanghai_miao', plantedAt: 12345, at: 2 },
    { kind: 'steal', thiefName: '阿测', thiefUid: 'tA', plotIdx: 2, cropId: 'shanghai_miao', plantedAt: P[2].plantedAt, at: 3 },
    { kind: 'steal', thiefName: '阿测', thiefUid: 'tA', plotIdx: 3, cropId: 'shanghai_miao', plantedAt: P[3].plantedAt, at: 4 },
    { kind: 'caught', thiefName: '阿笨', thiefUid: 'tB', plotIdx: 5, cropId: 'cai_xin', plantedAt: 9, coins: 20, at: 5 },
  ];
  const coinsB4 = Farm.state.data.coins;
  const res = await Farm.steal.settleRealEvents();
  T('R5 one stolen (cap)', res.stolen.length === 1 && res.stolen[0].name === '阿测');
  T('R5 plot0 cleared', P[0].crop === null);
  T('R5 plot1 kept (replay)', P[1].crop === 'shanghai_miao');
  T('R5 plot2 kept (immature)', P[2].crop === 'shanghai_miao');
  T('R5 plot3 kept (daily cap)', P[3].crop === 'shanghai_miao');
  T('R5 caught helps +20', res.helped.length === 1 && Farm.state.data.coins === coinsB4 + 20);
  T('R5 lost counter', Farm.state.data.dailyClaims.lostToRealToday === 3);

  // ===== R5b: 浇水改小 plantedAt 后，合法偷菜事件仍然有效（方向性校验）=====
  Farm.state.data.dailyClaims.lostToRealToday = 0;
  setPlot(5, now - growMs - 8000);
  const origPlanted = P[5].plantedAt;
  P[5].plantedAt -= 60000;   // 模拟浇水 shaved 60s（speedUp 把 plantedAt 改小）
  serverEvents = [
    { kind: 'steal', thiefName: '阿测', thiefUid: 'tA', plotIdx: 5, cropId: 'shanghai_miao', plantedAt: origPlanted, at: 9 },
  ];
  const res2 = await Farm.steal.settleRealEvents();
  T('R5b watered plot still stealable', res2.stolen.length === 1 && P[5].crop === null);

  // ===== R5c: 多季作物被偷只丢一茬（harvestsLeft 减1+重置，不清整株）=====
  Farm.state.data.dailyClaims.lostToRealToday = 0;
  // 找一个 multi_harvest 作物
  const multi = (Farm.crops.all().find(c => c.multi_harvest)) || null;
  if (multi) {
    const gm = multi.grow_minutes * 60000;
    const pm = Farm.state.data.plots[6];
    pm.unlocked = true; pm.crop = multi.id; pm.plantedAt = Date.now() - gm - 9000; pm.harvestsLeft = 3;
    serverEvents = [{ kind:'steal', thiefName:'阿测', thiefUid:'tA', plotIdx:6, cropId:multi.id, plantedAt:pm.plantedAt, at:20 }];
    await Farm.steal.settleRealEvents();
    T('R5c multi keeps plot', pm.crop === multi.id);
    T('R5c multi harvestsLeft 3->2', pm.harvestsLeft === 2);
  } else {
    out.push('SKIP R5c (no multi_harvest crop in catalog)');
  }

  // ===== R6: viewFarm renders real snapshot + stealable cells =====
  const nb = {
    isReal: true, uid: 'v9', id: 'real_v9', name: '快照户', emoji: '🧑',
    level: 6, totalHarvests: 10, likesReceived: 1,
    _doc: { gameStats: { level: 6, farmPlots: [
      { i: 0, c: 'shanghai_miao', p: now - growMs - 9000 },   // mature -> stealable
      { i: 1, c: 'cai_xin', p: now - 1000 },                  // growing
    ], hasGuardDog: false } },
  };
  await Farm.neighbors.viewFarm(nb);
  await new Promise(r => setTimeout(r, 300));
  const stealCells = document.querySelectorAll('.neighbor-plot.stealable').length;
  const growCells = document.querySelectorAll('.neighbor-plot.growing').length;
  T('R6 stealable=1', stealCells === 1);
  T('R6 growing>=1', growCells >= 1);

  // ===== R7: farmPlots payload shape =====
  const payload = Farm.fbGameSync._buildPayload();
  T('R7 payload farmPlots array', Array.isArray(payload.farmPlots));
  T('R7 payload hasGuardDog bool', typeof payload.hasGuardDog === 'boolean');

  return out.join('\\n');
})()`));
const {data}=await send('Page.captureScreenshot',{format:'png'},S);
fs.writeFileSync('C:/Users/yue00/AppData/Local/Temp/farm_test/real_steal_view.png',Buffer.from(data,'base64'));
console.log('saved real_steal_view');
await send('Target.closeTarget',{targetId});ws.close();
