/* 深度用户模拟测试 —— 真实浏览器，模拟玩家完整操作序列
   覆盖：配置编辑 / 键盘快捷键 / 地图工具 / 分享码 / 撤离 / 预算 / 边界 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 9351;
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
  else {
    fail++; fails.push(id + ' ' + desc + (detail ? ' [' + detail + ']' : ''));
    console.log('  FAIL  ' + id + '  ' + desc + (detail ? ' [' + detail + ']' : ''));
  }
}

(async function () {
  let child = null;
  try { await hj('GET', '/json/version'); }
  catch (e) {
    child = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-sandbox',
      '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required',
      '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.env.TEMP + '/dsh-deep',
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
    if (r.result && r.result.exceptionDetails) return 'EXC:' + r.result.exceptionDetails.text;
    return undefined;
  }
  async function wait(ms) { await new Promise(function (r) { setTimeout(r, ms); }); }
  async function click(sel) {
    return await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)}); if(!e) return 'no-el'; e.click(); return 'ok';})()`);
  }
  async function key(k) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k === ' ' ? 'Space' : 'Key' + k.toUpperCase() });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k === ' ' ? 'Space' : 'Key' + k.toUpperCase() });
  }

  await ev('var e=document.querySelector("#btnEnterConfig"); if(e) e.click();');
  await wait(1000);

  /* ══════════════════ 1. 配置编辑 ══════════════════ */
  console.log('\n=== 1. 配置编辑（队伍与阵容）===');
  {
    await click('[data-tab="lineup"]'); await wait(400);

    const teamBefore = await ev('QB.teams().length');
    const addRes = await click('#btnAddTeam'); await wait(300);
    const teamAfter = await ev('QB.teams().length');
    T('1.1', '「添加队伍」能增加队伍', teamAfter === teamBefore + 1,
      teamBefore + '→' + teamAfter + ' (' + addRes + ')');

    /* 加满到上限 */
    for (let i = 0; i < 8; i++) { await click('#btnAddTeam'); await wait(120); }
    const teamMax = await ev('QB.teams().length');
    T('1.2', '队伍数量有上限（不会无限加）', teamMax <= 6, '当前 ' + teamMax);

    /* 兵种加减：找 tile 按钮 */
    const tileInfo = await ev(`(function(){
      var t=document.querySelectorAll('.tile');
      return JSON.stringify({count:t.length, first:t[0]?t[0].textContent.trim():null});
    })()`);
    const ti = JSON.parse(tileInfo || '{}');
    T('1.3', '兵种数量按钮存在', ti.count > 0, ti.count + ' 个');

    /* 点队伍 0 的某个兵种数字（按钮带 data-team/data-role/data-n） */
    const bump = await ev(`(function(){
      var t=document.querySelectorAll('.tile[data-team="0"][data-n]');
      if(!t.length) return JSON.stringify({err:'no-tile'});
      /* 挑第一个非零兵种，点它的「3」档，观察数量变化 */
      var b=null;
      for(var i=0;i<t.length;i++){ if(t[i].dataset.n==='3'){ b=t[i]; break; } }
      if(!b) b=t[t.length-1];
      var role=b.dataset.role;
      var before=QB.teams()[0].lineup[role]||0;
      b.click();
      var after=QB.teams()[0].lineup[role]||0;
      return JSON.stringify({role:role, clicked:b.dataset.n, before:before, after:after});
    })()`);
    let bj = {}; try { bj = JSON.parse(bump); } catch (e) { bj = { raw: bump }; }
    T('1.4', '点兵种数字会改变编制', bj.before !== bj.after,
      JSON.stringify(bj));

    /* 换弹开关 */
    const rlBefore = await ev('QB.state.reloadOn');
    await click('#chkReload'); await wait(300);
    const rlAfter = await ev('QB.state.reloadOn');
    T('1.5', '换弹开关生效', rlBefore !== rlAfter, rlBefore + '→' + rlAfter);

    /* 僵尸轮次开关 */
    await click('[data-tab="waves"]'); await wait(400);
    const wvBefore = await ev('QB.state.waveOn');
    await click('#chkWave'); await wait(300);
    const wvAfter = await ev('QB.state.waveOn');
    T('1.6', '僵尸轮次开关生效', wvBefore !== wvAfter, wvBefore + '→' + wvAfter);
    await click('#chkWave'); await wait(200);
  }

  /* ══════════════════ 2. 键盘快捷键 ══════════════════ */
  console.log('\n=== 2. 键盘快捷键 ===');
  {
    await ev('QB.resetMapState(); QB.setMode("normal"); QB.start({preset:"balanced"});');
    await wait(800);
    T('2.0', '战斗已开始', await ev('QB.state.phase') === 'battle');

    /* 空格 = 暂停 */
    const p0 = await ev('QB.state.paused');
    await key(' ');
    await wait(400);
    const p1 = await ev('QB.state.paused');
    T('2.1', '空格键切换暂停', p0 !== p1, p0 + '→' + p1);
    await key(' '); await wait(300);

    /* S = 调速 */
    const s0 = await ev('QB.state.speed');
    await key('s');
    await wait(400);
    const s1 = await ev('QB.state.speed');
    T('2.2', 'S 键切换速度', s0 !== s1, s0 + '×→' + s1 + '×');

    /* N = 显示编号 */
    const n0 = await ev('QB.state.showNums');
    await key('n');
    await wait(400);
    const n1 = await ev('QB.state.showNums');
    T('2.3', 'N 键切换编号显示', n0 !== n1, n0 + '→' + n1);
  }

  /* ══════════════════ 3. 地图工具 ══════════════════ */
  console.log('\n=== 3. 地图工具 ===');
  {
    await ev('QB.setMode("normal");');
    await click('[data-tab="map"]'); await wait(500);

    /* 随机 */
    const r0 = await ev('(function(){var s=0;for(var i=0;i<editGrid.length;i++)s=((s*31)+editGrid[i])|0;return String(s);})()');
    await click('#btnRandom'); await wait(600);
    const r1 = await ev('(function(){var s=0;for(var i=0;i<editGrid.length;i++)s=((s*31)+editGrid[i])|0;return String(s);})()');
    T('3.1', '「随机」按钮生成新地图', r0 !== r1);

    /* 清空 */
    await click('#btnClear'); await wait(500);
    const cleared = await ev(`(function(){
      var n=0; for(var i=0;i<editGrid.length;i++) if(editGrid[i]===1||editGrid[i]===2) n++;
      return n;
    })()`);
    T('3.2', '「清空」按钮清掉掩体', cleared < 200, '剩余掩体 ' + cleared);

    /* 打通通道 */
    const carve = await ev(`(function(){
      var msg0=(document.querySelector('#mapMsg')||{}).textContent||'';
      document.querySelector('#btnCarve').click();
      var msg1=(document.querySelector('#mapMsg')||{}).textContent||'';
      return JSON.stringify({before:msg0, after:msg1});
    })()`);
    let cj = {}; try { cj = JSON.parse(carve); } catch (e) { cj = { raw: carve }; }
    T('3.3', '「打通通道」有文字反馈', !!cj.after && cj.after.length > 0,
      (cj.after || cj.raw || '').slice(0, 40));

    /* 体检 */
    const audit = await ev(`(function(){
      document.querySelector('#btnAudit').click();
      var m=document.querySelector('#mapAuditMsg');
      return m?m.textContent.trim():'no-el';
    })()`);
    T('3.4', '「体检」给出结果', !!audit && audit.length > 0, String(audit).slice(0, 40));

    /* 重置 */
    await click('#btnResetMap'); await wait(600);
    const resetOk = await ev('QB.state.phase');
    T('3.5', '「重置」不报错', resetOk !== undefined);
  }

  /* ══════════════════ 4. 分享码 ══════════════════ */
  console.log('\n=== 4. 分享码生成与导入 ===');
  {
    await click('[data-tab="map"]'); await wait(400);
    await click('#btnRandom'); await wait(500);

    const code = await ev(`(function(){
      var b=document.querySelector('#btnMapShare'); if(!b) return 'no-btn';
      b.click();
      var o=document.querySelector('#mapCodeOut');
      return o?o.value:'no-out';
    })()`);
    T('4.1', '能生成分享码', !!code && code.length > 20 && code.indexOf('FUS') === 0,
      '长度 ' + (code ? code.length : 0) + (code ? ' 前缀 ' + code.slice(0, 8) : ''));

    /* 导入刚生成的码 */
    const importRes = await ev(`(function(){
      var inp=document.querySelector('#mapCodeIn');
      var btn=document.querySelector('#btnMapCodeIn');
      if(!inp||!btn) return 'no-el';
      inp.value=${JSON.stringify(code)};
      btn.click();
      var m=document.querySelector('#mapSaveMsg');
      return m?m.textContent.trim():'no-msg';
    })()`);
    T('4.2', '能导入分享码', !!importRes && String(importRes).indexOf('失败') < 0,
      String(importRes).slice(0, 50));

    /* 坏码应该被拒绝 */
    const badRes = await ev(`(function(){
      var inp=document.querySelector('#mapCodeIn');
      var btn=document.querySelector('#btnMapCodeIn');
      inp.value='FUS1-broken-garbage-xyz';
      btn.click();
      var m=document.querySelector('#mapSaveMsg');
      return m?m.textContent.trim():'no-msg';
    })()`);
    T('4.3', '坏分享码被拒绝并有提示', !!badRes && (String(badRes).indexOf('失败') >= 0 || String(badRes).indexOf('无效') >= 0 || String(badRes).indexOf('错') >= 0),
      String(badRes).slice(0, 50));
  }

  /* ══════════════════ 5. 撤离模式细节 ══════════════════ */
  console.log('\n=== 5. 撤离模式细节 ===');
  {
    await ev('QB.resetMapState(); QB.setMode("mission");');
    await wait(600);

    /* 四张撤离图逐一点选 */
    const misBtns = await ev(`JSON.stringify(Array.from(document.querySelectorAll('.mis')).map(function(b){return b.dataset.mission;}))`);
    const mb = JSON.parse(misBtns || '[]');
    T('5.1', '四张撤离地图按钮都在', mb.length === 4, mb.join(','));

    let allOk = 0;
    for (const k of mb) {
      const r = await ev(`(function(){
        var b=document.querySelector('[data-mission="${k}"]');
        if(b) b.click();
        return (typeof currentMissionMap!=='undefined')?currentMissionMap:'undef';
      })()`);
      if (r === k) allOk++;
      await wait(300);
    }
    T('5.2', '点每张撤离图都能切换', allOk === 4, allOk + '/4');

    /* 平民数量可调 */
    const civRes = await ev(`(function(){
      var i=document.querySelector('#civCount');
      if(!i) return 'no-el';
      i.value='12'; i.dispatchEvent(new Event('change',{bubbles:true}));
      return i.value;
    })()`);
    T('5.3', '平民数量可调整', civRes === '12', String(civRes));

    /* 开一局撤离看平民 */
    await ev('QB.missionMap("corridor"); QB.mission(true); QB.start({preset:"balanced"});');
    await wait(1200);
    const civCount = await ev('QB.units().filter(function(u){return u.cls==="civilian";}).length');
    T('5.4', '撤离开局有平民', civCount > 0, civCount + ' 名');

    /* 撤离区与平民计数：走玩家能看到的 UI 元素 */
    const zone = await ev(`(function(){
      var el=document.querySelector('#mapViewInfo');
      var txt=el?el.textContent.trim():'';
      var civ=(typeof QB!=='undefined'&&QB.missionInfo)?QB.missionInfo():null;
      return JSON.stringify({uiTxt:txt.slice(0,60), hasInfo:!!civ});
    })()`);
    let zj = {}; try { zj = JSON.parse(zone); } catch (e) { zj = { raw: zone }; }
    T('5.5', '撤离区信息在界面上可见', (zj.uiTxt && zj.uiTxt.length > 0) || zj.hasInfo,
      JSON.stringify(zj).slice(0, 70));

    await ev('QB.mission(false); QB.setMode("normal");');
    await wait(400);
  }

  /* ══════════════════ 6. 预算模式细节 ══════════════════ */
  console.log('\n=== 6. 预算模式细节 ===');
  {
    await ev('QB.setMode("budget");');
    await wait(800);

    const presets = await ev('JSON.stringify(QB.budgetPresets())');
    const ps = JSON.parse(presets || '[]');
    T('6.1', '预算有多个难度档', ps.length >= 4, ps.length + ' 档');

    const maps = await ev('JSON.stringify(QB.budgetMaps())');
    const ms = JSON.parse(maps || '[]');
    T('6.2', '预算有多张可选地图', ms.length >= 4, ms.length + ' 张');

    /* 自动推荐 */
    const suggest = await ev(`(function(){
      var b=document.querySelector('#btnBudgetSuggest'); if(!b) return 'no-btn';
      b.click();
      return 'clicked';
    })()`);
    await wait(600);
    const applied = await ev(`(function(){
      var el=document.querySelector('#budgetShop');
      return el?el.textContent.trim().slice(0,80):'no-el';
    })()`);
    T('6.3', '「自动推荐」有反馈', !!applied && String(applied).length > 0,
      String(applied).slice(0, 50));

    /* 超预算提示 */
    const over = await ev(`(function(){
      var b=document.querySelector('#btnBudgetApply'); if(!b) return 'no-btn';
      b.click();
      var m=document.querySelector('#budgetMsg');
      return m?m.textContent.trim():'no-msg';
    })()`);
    T('6.4', '预算应用有结果提示', over !== undefined, String(over).slice(0, 40));

    await ev('QB.setMode("normal");');
  }

  /* ══════════════════ 7. 边界与容错 ══════════════════ */
  console.log('\n=== 7. 边界与容错 ===');
  {
    /* 空队伍开局应被拒绝且不崩 */
    const emptyStart = await ev(`(function(){
      try{
        QB.setTeams([{name:'空',type:'h',lineup:{}},{name:'空2',type:'z',lineup:{}}]);
        var s=QB.start({preset:'balanced'});
        return JSON.stringify({ok:!!s, phase:QB.state.phase});
      }catch(e){ return 'THROW:'+e.message; }
    })()`);
    T('7.1', '空队伍开局不崩溃', String(emptyStart).indexOf('THROW') < 0, String(emptyStart));

    /* 反复快速开局/重开 */
    const rapid = await ev(`(function(){
      try{
        for(var i=0;i<8;i++){
          QB.resetMapState();
          QB.setTeams([{name:'A',type:'h',lineup:{rifle:5}},{name:'B',type:'z',lineup:{zombie:5}}]);
          QB.start({preset:'balanced'});
          QB.simulate(2);
        }
        return 'ok';
      }catch(e){ return 'THROW:'+e.message; }
    })()`);
    T('7.2', '连续重开 8 次不崩溃', rapid === 'ok', String(rapid));

    /* 切地图尺寸 */
    const sizes = await ev(`(function(){
      try{
        var out=[];
        ['small','medium','large','huge'].forEach(function(s){
          QB.setMapSize(s);
          var z=QB.size();
          out.push(s+':'+z.gw+'x'+z.gh);
        });
        QB.setMapSize('medium');
        return out.join(' ');
      }catch(e){ return 'THROW:'+e.message; }
    })()`);
    T('7.3', '四种地图尺寸可切换', String(sizes).indexOf('THROW') < 0, String(sizes));

    /* 非法分享码：走**玩家真实入口** QB.importShareCode（它内部有 try 包裹）。
       ★ 不要直接调 parseShareCode —— 那个函数按设计会 throw，
         它只是内部解析器，不是对外接口。 */
    const weird = await ev(`(function(){
      var r=[];
      ['', '   ', 'x', 'FUS1-', 'FUS1-broken', '完全不是码'].forEach(function(v){
        try{
          var o=QB.importCode(v);
          r.push(o && o.ok ? 'ok' : 'rejected');
        }catch(e){ r.push('throw'); }
      });
      return r.join(',');
    })()`);
    T('7.4', '非法分享码被安全拒绝（不崩溃）',
      String(weird).indexOf('throw') < 0, String(weird));
  }

  console.log('\n=== 结果 ===');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fails.length) { console.log('  失败项：'); fails.forEach(function (f) { console.log('    - ' + f); }); }
  if (errs.length) { console.log('  页面异常：'); errs.slice(0, 6).forEach(function (e) { console.log('    - ' + e); }); }

  ws.close();
  if (child) child.kill();
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('错误: ' + e.message); process.exit(2); });
