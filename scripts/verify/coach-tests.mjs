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
  const out=[];const T=(n,c)=>out.push((c?'PASS ':'FAIL ')+n);
  Farm.state.data.tutorialV1Done=true; var sp=document.getElementById('splash'); if(sp) sp.remove();
  Farm.state.data.coachSeen = {};

  // C1: tip shows once → bubble text updates + marked seen
  const before = (document.getElementById('storekeeperBubble')||{}).textContent;
  const r1 = Farm.coach.tip('first_water');
  await new Promise(r=>setTimeout(r,50));
  const after = (document.getElementById('storekeeperBubble')||{}).textContent;
  T('C1 tip shows', r1 === true && after !== before && after.indexOf('浇水')>=0);
  T('C1 marked seen', Farm.coach.seen('first_water') === true);

  // C2: second time → suppressed
  const r2 = Farm.coach.tip('first_water');
  T('C2 once only', r2 === false);

  // C3: fire respects seen (no double)
  let fired = 0;
  const realTip = Farm.coach.tip.bind(Farm.coach);
  Farm.coach.tip = (id,f) => { fired++; return realTip(id,f); };
  Farm.coach.fire('first_water');     // already seen → fire returns early, tip not called
  await new Promise(r=>setTimeout(r,800));
  T('C3 seen blocks fire', fired === 0);
  Farm.coach.tip = realTip;

  // C4: unknown id safe
  T('C4 unknown id', Farm.coach.tip('nope') === false);

  // C5: persistence — coachSeen saved to localStorage
  const saved = JSON.parse(localStorage.getItem('eastern_farm_save_v1')||'{}');
  T('C5 persisted', saved.coachSeen && saved.coachSeen.first_water);

  // C6: force shows even if seen
  T('C6 force', Farm.coach.tip('first_water', true) === true);

  // C7: coins threshold tip via refreshHUD
  Farm.state.data.coachSeen = {};
  Farm.state.data.coins = 50; Farm.ui.refreshHUD();
  await new Promise(r=>setTimeout(r,100));
  T('C7 below 100 not fired', !Farm.coach.seen('first_coins_exchange'));
  Farm.state.data.coins = 150; Farm.ui.refreshHUD();
  await new Promise(r=>setTimeout(r,1500));
  T('C7 ≥100 fired', Farm.coach.seen('first_coins_exchange'));

  // C8: all 8 wired ids exist in TIPS (tip returns true with force)
  const ids = ['first_plant','first_mature','first_warehouse','first_sell','warehouse_full','first_coins_exchange','first_water','first_neighbor','steal_unlocked'];
  const missing = ids.filter(i => Farm.coach.tip(i, true) !== true);
  T('C8 all tips defined', missing.length === 0);

  return out.join('\\n') + (missing.length? ('  missing:'+missing.join(',')):'');
})()`));
await send('Target.closeTarget',{targetId});ws.close();
