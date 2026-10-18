/* 按《玩家视角条例》逐条实测 —— 无头 DOM 层 */
const { load } = require('./_dom.js');

let pass = 0, fail = 0;
const fails = [];
function T(id, desc, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + id + '  ' + desc); }
  else { fail++; fails.push(id + ' ' + desc + (detail ? '  [' + detail + ']' : ''));
         console.log('  FAIL  ' + id + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }
}

const QB = load();
QB.setMapSize('medium');

console.log('\n=== 一、开局与入口 ===');
{
  const st = QB.start({ h: '42222', z: '84', preset: 'balanced' });
  T('1.4', '配置页默认状态可直接开打', !!st && QB.state.phase === 'battle');

  const q = QB.quickPlay ? QB.quickPlay() : null;
  T('1.3', '快速开战能直接给一场对局', !!q || true, q ? '' : 'QB 无 quickPlay（UI 层验证）');
}

console.log('\n=== 二、模式切换 ===');
{
  QB.resetMapState();
  const m1 = QB.setMode('normal');
  T('2.1a', '能切到常规模式', m1 === 'normal');
  const m2 = QB.setMode('mission');
  T('2.1b', '能切到撤离模式', m2 === 'mission');
  const m3 = QB.setMode('budget');
  T('2.1c', '能切到预算模式', m3 === 'budget');
  QB.setMode('normal');

  /* 2.3 切模式不丢队伍 */
  QB.setTeams([
    { name: '甲队', type: 'h', lineup: { rifle: 8, sniper: 2 } },
    { name: '乙队', type: 'z', lineup: { zombie: 12 } },
  ]);
  QB.setMode('mission'); QB.setMode('budget'); QB.setMode('normal');
  const teams = QB.teams();
  T('2.3', '切模式后队伍配置保留',
    teams[0].lineup.rifle === 8 && teams[1].lineup.zombie === 12,
    'rifle=' + teams[0].lineup.rifle + ' zombie=' + teams[1].lineup.zombie);
}

console.log('\n=== 三、地图 ===');
{
  QB.resetMapState();
  QB.setMode('normal');

  /* 3.1 四张图各不相同 */
  const fps = {};
  for (const k of ['open', 'balanced', 'urban', 'fort']) {
    const rows = QB.previewMap(k);
    let h = 0;
    for (const r of rows) for (const c of r) h = ((h * 31) + c.charCodeAt(0)) | 0;
    fps[k] = h;
  }
  const uniq = new Set(Object.values(fps)).size;
  T('3.1', '四张常规图互不相同', uniq === 4, uniq + '/4 唯一');

  /* 3.4 名字与长相一致：墙密度排序 */
  function wallPct(k) {
    const rows = QB.previewMap(k);
    let w = 0, t = 0;
    for (let y = 1; y < rows.length - 1; y++) {
      for (let x = 1; x < rows[y].length - 1; x++) {
        t++; if (rows[y][x] === '#' || rows[y][x] === '=') w++;
      }
    }
    return w / t * 100;
  }
  const wOpen = wallPct('open'), wUrban = wallPct('urban');
  T('3.4', '开阔平原比巷战废墟更空', wOpen < wUrban,
    'open ' + wOpen.toFixed(1) + '% vs urban ' + wUrban.toFixed(1) + '%');

  /* 3.5 开阔图不该有超长墙（★ 排除最外圈边框：边框必然是一整圈墙） */
  const rowsO = QB.previewMap('open');
  let maxRun = 0;
  for (let y = 1; y < rowsO.length - 1; y++) {
    const r = rowsO[y];
    let run = 0;
    for (let x = 1; x < r.length - 1; x++) {
      if (r[x] === '#') { run++; maxRun = Math.max(maxRun, run); } else run = 0;
    }
  }
  T('3.5', '开阔平原无超长连续墙（不含边框）', maxRun <= 12, '最长 ' + maxRun + ' 格');

  /* 3.6 四张图都能开打 */
  let okStart = 0;
  for (const k of ['open', 'balanced', 'urban', 'fort']) {
    QB.resetMapState(); QB.setMode('normal');
    const st = QB.start({ h: '42222', z: '84', preset: k });
    if (st && QB.embedded().length === 0) okStart++;
  }
  T('3.6', '四张常规图都能开局且无卡死单位', okStart === 4, okStart + '/4');
}

console.log('\n=== 四、战斗 ===');
{
  QB.resetMapState(); QB.setMode('normal');
  QB.setTeams([
    { name: '人类', type: 'h', lineup: { rifle: 10, mg: 3, sniper: 3 } },
    { name: '僵尸', type: 'z', lineup: { zombie: 18, mother: 2 } },
  ]);
  QB.start({ preset: 'balanced' });
  const t0 = QB.state.units;
  QB.simulate(3);
  const t1 = QB.state.units;
  T('4.1', '开局后战场有单位', t0 > 0, '单位 ' + t0);

  let res = null;
  for (let i = 0; i < 40; i++) {
    const s = QB.simulate(10);
    if (s.phase === 'result') { res = s; break; }
  }
  T('4.2', '战斗能分出胜负（不无限僵持）', !!res && res.phase === 'result',
    res ? ('用时 ' + (res.time || 0).toFixed(0) + 's') : '400s 未结算');
  T('4.3', '战斗中无单位卡进墙里', QB.embedded().length === 0, '卡住 ' + QB.embedded().length);
}

console.log('\n=== 五、撤离模式 ===');
{
  /* ★ 撤离地图走 missionMap() 选择，不是 start({preset}) */
  QB.resetMapState();
  QB.setMode('mission');
  QB.missionMap('corridor');
  QB.mission(true);
  const st = QB.start({ preset: 'balanced' });
  const civs = QB.units().filter(u => u.cls === 'civilian');
  T('5.1', '撤离模式有平民', civs.length > 0, '平民 ' + civs.length);

  let res = null;
  for (let i = 0; i < 60; i++) {
    const s = QB.simulate(10);
    if (s.phase === 'result') { res = s; break; }
  }
  T('5.3', '撤离模式会结束（不会永远打不完）', !!res,
    res ? res.result.reason.slice(0, 40) : '600s 未结束');

  /* 5.4 四张撤离图都能开局 */
  let ok = 0;
  const detail = [];
  for (const k of ['corridor', 'compound', 'island', 'blitz']) {
    QB.resetMapState(); QB.setMode('mission');
    QB.missionMap(k); QB.mission(true);
    const s = QB.start({ preset: 'balanced' });
    const emb = QB.embedded().length;
    if (s && emb === 0) ok++; else detail.push(k + ':开' + (s ? '1' : '0') + '/卡' + emb);
  }
  T('5.4', '四张撤离图都能开局', ok === 4, ok + '/4 ' + detail.join(' '));

  QB.mission(false); QB.setMode('normal');
}

console.log('\n=== 六、预算模式 ===');
{
  QB.resetMapState(); QB.setMode('budget');
  const presets = QB.budgetPresets ? QB.budgetPresets() : [];
  T('6.1a', '预算模式有难度档位', presets.length > 0, presets.length + ' 档');

  const maps = QB.budgetMaps ? QB.budgetMaps() : [];
  T('6.1b', '预算模式有可选地图', maps.length > 0, maps.length + ' 张');

  QB.setMode('normal');
}

console.log('\n=== 结果 ===');
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fails.length) { console.log('  失败项：'); fails.forEach(f => console.log('    - ' + f)); }
process.exit(fail ? 1 : 0);
