/* 按《玩家视角条例》实测 —— 真实浏览器 UI 层 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 9345;
const BASE = 'C:/Users/35565/Documents/deepseek-harness/default-workspace/球球小作战';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

function hj(m, p) {
  return new Promise(function (res, rej) {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: m, timeout: 3000 },
      function (x) { let b = ''; x.on('data', function (c) { b += c; });
        x.on('end', function () { try { res(JSON.parse(b)); } catch (e) { res(b); } }); });
    r.on('error', rej); r.on('timeout', function () { r.destroy(new Error('t')); }); r.end();
  });
}

let pass = 0, fail = 0; const fails = [];
function T(id, desc, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + id + '  ' + desc); }
  else { fail++; fails.push(id + ' ' + desc + (detail ? ' [' + detail + ']' : ''));
         console.log('  FAIL  ' + id + '  ' + desc + (detail ? ' [' + detail + ']' : '')); }
}

(async function () {
  let child = null;
  try { await hj('GET', '/json/version'); }
  catch (e) {
    child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
      '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required',
      '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.env.TEMP + '/dsh-spec',
      '--no-first-run', '--window-size=1680,1020', 'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await new Promise(function (r) { setTimeout(r, 500); });
      try { await hj('GET', '/json/version'); break; } catch (e2) {}
    }
  }
  const list = await hj('GET', '/json/list');
  const pg = (Array.isArray(list) ? list : []).find(function (x) { return x.type === 'page'; });
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const errs = [];
  const om = function (m) {
    const raw = (m && m.data !== undefined) ? m.data : m;
    try {
      const g = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      if (g.id && pend.has(g.id)) { pend.get(g.id)(g); pend.delete(g.id); return; }
      if (g.method === 'Runtime.exceptionThrown') {
        errs.push(g.params.exceptionDetails.text + ' @' + g.params.exceptionDetails.lineNumber);
      }
    } catch (e) {}
  };
  if (ws.addEventListener) ws.addEventListener('message', om); else ws.on('message', om);
  const send = function (m, p) {
    return new Promise(function (r) { const i = ++id; pend.set(i, r);
      ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  };
  await new Promise(function (r, j) {
    if (ws.addEventListener) { ws.addEventListener('open', r); ws.addEventListener('error', j); }
    else { ws.on('open', r); ws.on('error', j); }
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1020, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + BASE + '/index.html' });
  await new Promise(function (r) { setTimeout(r, 6000); });

  async function ev(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.result) return r.result.result.value;
    return undefined;
  }

  console.log('\n=== 一、开局与入口 ===');
  T('1.1', '页面加载无 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  const titleVisible = await ev('!!document.querySelector("#titleScreen, .title, #setup")');
  T('1.2', '第一屏有标题/入口', titleVisible === true);
  const hasStart = await ev('!!(document.querySelector("#btnQuickPlay")||document.querySelector("#btnEnterConfig"))');
  T('1.2b', '有开始入口按钮', hasStart === true);

  /* 进入配置页 */
  await ev('var e=document.querySelector("#btnEnterConfig"); if(e) e.click();');
  await new Promise(function (r) { setTimeout(r, 900); });
  const inSetup = await ev('!!document.querySelector("#setup")');
  T('1.4', '能进入配置页', inSetup === true);

  console.log('\n=== 二、模式切换 · 页签显隐 ===');
  async function tabVis() {
    return await ev(`(function(){
      var o={};
      document.querySelectorAll('.tab').forEach(function(t){
        var hid = t.classList.contains('hide') || t.offsetParent===null;
        o[t.dataset.tab]=hid?'hidden':'shown';
      });
      return JSON.stringify(o);
    })()`);
  }
  const tNormal = JSON.parse(await tabVis() || '{}');
  T('2.2a', '常规模式显示队伍页签', tNormal.lineup === 'shown', JSON.stringify(tNormal.lineup));
  T('2.2b', '常规模式显示地图页签', tNormal.map === 'shown');
  T('2.2c', '常规模式隐藏撤离页签', tNormal.mission === 'hidden');
  T('2.2d', '常规模式隐藏预算页签', tNormal.budget === 'hidden');

  await ev('document.querySelector(\'[data-mode="mission"]\').click()');
  await new Promise(function (r) { setTimeout(r, 800); });
  const tM = JSON.parse(await tabVis() || '{}');
  T('2.2e', '撤离模式显示撤离页签', tM.mission === 'shown');
  T('2.2f', '撤离模式隐藏常规数值页签', tM.stats === 'hidden');

  await ev('document.querySelector(\'[data-mode="budget"]\').click()');
  await new Promise(function (r) { setTimeout(r, 800); });
  const tB = JSON.parse(await tabVis() || '{}');
  T('2.2g', '预算模式显示预算页签', tB.budget === 'shown');
  T('2.2h', '预算模式隐藏常规阵型页签', tB.lineup === 'hidden');

  await ev('document.querySelector(\'[data-mode="normal"]\').click()');
  await new Promise(function (r) { setTimeout(r, 600); });
  const backActive = await ev('!!document.querySelector(".tab.active")');
  T('2.4', '切回常规模式后无空白页', backActive === true);

  console.log('\n=== 三、地图按钮 ===');
  await ev('var t=document.querySelector(\'[data-tab="map"]\'); if(t) t.click();');
  await new Promise(function (r) { setTimeout(r, 700); });
  const presets = await ev(`JSON.stringify(Array.from(document.querySelectorAll('.pre')).map(function(b){return b.dataset.preset;}))`);
  const pl = JSON.parse(presets || '[]');
  T('3.2', '常规地图页只有常规图', pl.length === 4 && !pl.some(function(p){return p.indexOf('mission')===0;}), pl.join(','));
  T('3.3', '四张预设按钮都可点', pl.length === 4, pl.join(','));

  /* 点每张图，看地图是否真的变 */
  const hashes = [];
  for (const k of pl) {
    const h = await ev(`(function(){
      var b=document.querySelector('[data-preset="${k}"]');
      if(b) b.click();
      var s=0; for(var i=0;i<editGrid.length;i++) s=((s*31)+editGrid[i])|0;
      return String(s);
    })()`);
    hashes.push(h);
    await new Promise(function (r) { setTimeout(r, 300); });
  }
  T('3.3b', '点不同地图产生不同结果', new Set(hashes).size === 4, new Set(hashes).size + '/4 唯一');

  console.log('\n=== 七、设置开关 ===');
  const sfxBefore = await ev('document.querySelector("#chkSfx").checked');
  await ev('document.querySelector("#chkSfx").click()');
  await new Promise(function (r) { setTimeout(r, 300); });
  const sfxAfter = await ev('document.querySelector("#chkSfx").checked');
  T('7.1', '音效开关能切换', sfxBefore !== sfxAfter, sfxBefore + '→' + sfxAfter);

  const musicBefore = await ev('document.querySelector("#chkMusic").checked');
  await ev('document.querySelector("#chkMusic").click()');
  await new Promise(function (r) { setTimeout(r, 300); });
  const musicAfter = await ev('document.querySelector("#chkMusic").checked');
  T('7.2', '音乐开关能切换', musicBefore !== musicAfter, musicBefore + '→' + musicAfter);

  /* 反馈邮箱 */
  await ev('var t=document.querySelector(\'[data-tab="about"]\'); if(t) t.click();');
  await new Promise(function (r) { setTimeout(r, 600); });
  const mailTxt = await ev('(function(){var e=document.querySelector("#feedbackMail"); return e?e.textContent.trim():null;})()');
  T('7.3', '关于页能看到反馈邮箱', !!mailTxt && mailTxt.indexOf('@') > 0, mailTxt || '未找到');
  const hasCopy = await ev('!!document.querySelector("#btnCopyMail")');
  T('7.3b', '有复制邮箱按钮', hasCopy === true);

  console.log('\n=== 四/八、战斗与结算 ===');
  await ev('var t=document.querySelector(\'[data-tab="lineup"]\'); if(t) t.click();');
  await new Promise(function (r) { setTimeout(r, 400); });
  await ev('(function(){ if(window.QB) QB.setMode("normal"); if(window.QB) QB.resetMapState(); })()');
  await ev('document.querySelector("#btnStart").click()');
  await new Promise(function (r) { setTimeout(r, 2000); });
  const inBattle = await ev('(function(){return window.QB?QB.state.phase:null;})()');
  T('4.1', '点开始进入战斗', inBattle === 'battle', String(inBattle));

  /* 暂停：点一次应变暂停，再点一次应恢复 */
  const paused = await ev(`(function(){
    if(typeof QB==='undefined') return 'no-qb';
    var before = QB.state.paused;
    var b=document.querySelector('#btnPause');
    if(!b) return 'no-btn';
    b.click();
    var mid = QB.state.paused;
    b.click();
    var after = QB.state.paused;
    return JSON.stringify({before:before, mid:mid, after:after,
      btnText:document.querySelector('#btnPause').textContent.trim()});
  })()`);
  let pj = {};
  try { pj = JSON.parse(paused); } catch (e) { pj = { raw: paused }; }
  T('4.5', '暂停按钮能切换（可暂停也可恢复）',
    pj.mid === !pj.before && pj.after === pj.before,
    JSON.stringify(pj));

  /* 跑完一局看结算 */
  const res = await ev(`(function(){
    QB.speed=4;
    for(var i=0;i<200;i++){ var s=QB.simulate(5); if(s.phase==='result') return JSON.stringify({phase:s.phase,reason:s.result?s.result.reason:''}); }
    return JSON.stringify({phase:(QB.state||{}).phase});
  })()`);
  const rj = JSON.parse(res || '{}');
  T('4.2', '能打到结算', rj.phase === 'result', rj.reason || rj.phase);
  T('8.1', '结算有原因说明', !!rj.reason && rj.reason.length > 2, rj.reason || '无');

  const resultShown = await ev('!!document.querySelector("#resultCard, .result, #btnAgain")');
  T('8.2', '结算页有「再来一局」入口', resultShown === true);

  console.log('\n=== 结果 ===');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fails.length) { console.log('  失败项：'); fails.forEach(function (f) { console.log('    - ' + f); }); }
  if (errs.length) { console.log('  页面异常：'); errs.slice(0, 5).forEach(function (e) { console.log('    - ' + e); }); }

  ws.close();
  if (child) child.kill();
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('错误: ' + e.message); process.exit(2); });
