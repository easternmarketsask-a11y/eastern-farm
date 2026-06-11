// Visit-footprint tests V1-V4.
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
  const T = (n, c) => out.push((c ? 'PASS ' : 'FAIL ') + n);
  Farm.state.data.tutorialV1Done = true;
  var sp = document.getElementById('splash'); if (sp) sp.remove();

  // mocks
  Farm.fbAuth = Farm.fbAuth || {};
  Farm.fbAuth.isLoggedIn = () => true;
  Farm.fbAuth.memberDocId = () => 'me_uid';
  Farm.fbAuth.uid = () => 'me_uid';
  Farm.fbAuth.memberDoc = { id: 'me_uid' };
  const writes = [];
  Farm.fb = { available: true, db: { collection: (c) => ({ doc: (d) => ({
    set: async (payload) => { writes.push({ c, d, payload }); },
    get: async () => ({ exists: false }),
  }) }) } };

  // 只统计足迹写入——state.save() 会触发 debounced gameStats 同步，
  // 往同一个 mock 写入其它 payload，不能用总数断言。
  const vWrites = () => writes.filter(w => w.payload && w.payload.gameStats && w.payload.gameStats.visitEvents);

  // V1: recordVisit writes once
  Farm.state.data.dailyClaims.visitFootprints = [];
  await Farm.fbGameSync.recordVisit('host_1');
  T('V1 write sent', vWrites().length === 1 && vWrites()[0].d === 'host_1');

  // V2: same host same day → throttled, no second write
  await Farm.fbGameSync.recordVisit('host_1');
  T('V2 throttled', vWrites().length === 1);
  await Farm.fbGameSync.recordVisit('host_2');
  T('V2 new host writes', vWrites().length === 2);

  // V3: self/AI guard
  await Farm.fbGameSync.recordVisit('me_uid');
  T('V3 self skipped', vWrites().length === 2);

  // V4: settleRealOnLogin merges visits into report (4 + more-row)
  // 新流程走 fetchAndClearInbox 单次读取
  Farm.steal.settleRealEvents = async () => ({ stolen: [], helped: [] });
  Farm.fbGameSync.fetchAndClearInbox = async () => ({ steals: [], visits: [
    { visitorUid: 'a', visitorName: '阿芳', at: 1 },
    { visitorUid: 'a', visitorName: '阿芳', at: 2 },   // dup → dedup
    { visitorUid: 'b', visitorName: '老张头儿', at: 3 },
    { visitorUid: 'c', visitorName: '周小喵', at: 4 },
    { visitorUid: 'd', visitorName: 'Amy', at: 5 },
    { visitorUid: 'e', visitorName: '大厨阿林', at: 6 },
    { visitorUid: 'f', visitorName: '半亩良田', at: 7 },
  ] });
  await Farm.homeReport.settleRealOnLogin();
  await new Promise(r => setTimeout(r, 400));
  const txt = (document.getElementById('modalContent') || {}).innerText || '';
  T('V4 visit row', txt.indexOf('阿芳 来你农场逛过') >= 0);
  T('V4 dedup+cap (4 named)', (txt.match(/来你农场逛过/g) || []).length === 4);
  T('V4 more-row', txt.indexOf('还有 2 位邻居也来逛过') >= 0);
  return out.join('\\n') + '\\n--- modal: ' + txt.replace(/\\n+/g, ' | ').slice(0, 220);
})()`));
const {data}=await send('Page.captureScreenshot',{format:'png'},S);
fs.writeFileSync('C:/Users/yue00/AppData/Local/Temp/farm_test/visit_report.png',Buffer.from(data,'base64'));
console.log('saved visit_report');
await send('Target.closeTarget',{targetId});ws.close();
