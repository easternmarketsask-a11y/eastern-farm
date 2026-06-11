// Invite referral tests I1-I6.
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
// I1: boot with ?ref= captures to localStorage
await send('Page.navigate',{url:'http://localhost:8778/src/index.html?ref=inviter_abc'},S);
await new Promise(r=>setTimeout(r,3500));
async function ev(e){const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true},S);return r.result&&r.result.value;}

console.log(await ev(`(async function(){
  const out = [];
  const T = (n, c) => out.push((c ? 'PASS ' : 'FAIL ') + n);
  Farm.state.data.tutorialV1Done = true;
  var sp = document.getElementById('splash'); if (sp) sp.remove();

  // I1: ref captured at boot
  T('I1 ref captured', localStorage.getItem('eastern_farm_ref') === 'inviter_abc');

  // mocks
  Farm.fbAuth = Farm.fbAuth || {};
  Farm.fbAuth.isLoggedIn = () => true;
  Farm.fbAuth.memberDocId = () => 'me_uid';
  Farm.fbAuth.memberDoc = { id: 'me_uid' };
  const writes = [];
  let myCloudGs = {};   // simulated own farm_players doc
  Farm.fb = { available: true, db: { collection: () => ({ doc: (d) => ({
    set: async (payload) => { writes.push({ d, payload }); if (d === 'me_uid' && payload.gameStats && payload.gameStats.referredBy) { myCloudGs.referredBy = payload.gameStats.referredBy; } },
    get: async () => ({ exists: true, data: () => ({ gameStats: myCloudGs }) }),
  }) }) } };

  // I2: apply → self +200, referrer gift queued, referredBy written, localStorage cleared
  const coins0 = Farm.state.data.coins;
  await Farm.fbGameSync.applyReferral();
  const giftWrites = writes.filter(w => w.payload.gameStats && w.payload.gameStats.pendingGifts);
  const refWrites = writes.filter(w => w.payload.gameStats && w.payload.gameStats.referredBy);
  T('I2 self +bonus', Farm.state.data.coins === coins0 + Farm.fbGameSync.INVITE_BONUS);
  T('I2 referredBy written', refWrites.length === 1 && refWrites[0].d === 'me_uid');
  T('I2 gift to inviter', giftWrites.length === 1 && giftWrites[0].d === 'inviter_abc');
  T('I2 localStorage cleared', localStorage.getItem('eastern_farm_ref') === null);

  // I3: second apply (already referred) → no double pay
  localStorage.setItem('eastern_farm_ref', 'someone_else');
  const coins1 = Farm.state.data.coins;
  await Farm.fbGameSync.applyReferral();
  T('I3 once only', Farm.state.data.coins === coins1 && writes.filter(w => w.payload.gameStats && w.payload.gameStats.pendingGifts).length === 1);
  T('I3 cleared again', localStorage.getItem('eastern_farm_ref') === null);

  // I4: self-referral rejected
  myCloudGs = {};
  localStorage.setItem('eastern_farm_ref', 'me_uid');
  const coins2 = Farm.state.data.coins;
  await Farm.fbGameSync.applyReferral();
  T('I4 self-ref rejected', Farm.state.data.coins === coins2 && localStorage.getItem('eastern_farm_ref') === null);

  // I5: inviteLink shape
  T('I5 invite link', Farm.fbGameSync.inviteLink() === 'https://farm.easternmarket.ca/?ref=me_uid');

  // I6: community panel buttons exist (footer 邀请 + empty-state 邀请)
  Farm.aiNeighbors.enabled = false;
  Farm.fbGameSync.fetchVisiblePool = async () => [];
  Farm.fbGameSync.pickDailyThree = () => [];
  await Farm.neighbors.open();
  await new Promise(r => setTimeout(r, 600));
  const txt = (document.getElementById('modalContent') || {}).innerText || '';
  T('I6 footer invite btn', txt.indexOf('邀请好友') >= 0);
  T('I6 empty-state invite', txt.indexOf('各得 200 农场币') >= 0);
  return out.join('\\n');
})()`));
const {data}=await send('Page.captureScreenshot',{format:'png'},S);
fs.writeFileSync('C:/Users/yue00/AppData/Local/Temp/farm_test/invite_view.png',Buffer.from(data,'base64'));
console.log('saved invite_view');
await send('Target.closeTarget',{targetId});ws.close();
