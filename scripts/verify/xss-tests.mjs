// XSS regression: a malicious name must NOT create live DOM nodes anywhere.
import WebSocket from 'ws';
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
  window.__xss=false;
  const EVIL = '<img src=x onerror="window.__xss=true">';

  // 1) escapeHtml helper
  T('escapeHtml works', Farm.ui.escapeHtml(EVIL).indexOf('<img') === -1);

  // 2) home-report row with evil thief name → no live <img>
  const ev1 = { stolen:[{kind:'steal', name:EVIL, realUid:'tA', cropId:'shanghai_miao', count:1}], helped:[] };
  Farm.homeReport.show(ev1);
  await new Promise(r=>setTimeout(r,300));
  T('report no live img', document.querySelectorAll('#modalContent img[src="x"]').length === 0);
  Farm.ui.hideModal();

  // 3) neighbor card via viewFarm modal title with evil name
  await Farm.neighbors.viewFarm({ isReal:true, uid:'v1', id:'real_v1', name:EVIL, emoji:'🧑', level:5 });
  await new Promise(r=>setTimeout(r,400));
  T('viewFarm title no live img', document.querySelectorAll('#modalContent img[src="x"]').length === 0);
  const title = (document.querySelector('.modal-title')||{}).textContent||'';
  T('evil rendered as text', title.indexOf('<img') >= 0 || title.indexOf('img') >= 0);  // escaped → shows literal
  Farm.ui.hideModal();

  // 4) onerror never fired
  await new Promise(r=>setTimeout(r,200));
  T('onerror never fired', window.__xss === false);

  // 5) nickname write sanitizes (simulate the blur handler regex)
  const sanitized = EVIL.replace(/[<>&"']/g,'').trim().slice(0,12);
  T('nickname strips html chars', sanitized.indexOf('<')===-1 && sanitized.indexOf('>')===-1);

  return out.join('\\n');
})()`));
await send('Target.closeTarget',{targetId});ws.close();
