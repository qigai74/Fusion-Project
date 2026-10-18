/* 统一测试入口：一条命令跑完全部四套测试
   用法：node _all.js
*/
const { execFileSync } = require('child_process');

const SUITES = [
  { name: '核心回归（329 项）', file: '_test.js',       expect: '全部通过' },
  { name: '条例·逻辑（18 项）', file: '_spec_logic.js', expect: '通过 18 项' },
  { name: '条例·界面（25 项）', file: '_spec_ui.js',    expect: '通过 25 项' },
  { name: '深度模拟（31 项）',  file: '_spec_deep.js',  expect: '通过 31 项' },
];

let allOk = true;
const results = [];

for (const s of SUITES) {
  process.stdout.write('▶ ' + s.name + ' ... ');
  let out = '';
  let ok = false;
  try {
    out = execFileSync('node', [s.file], { encoding: 'utf8', timeout: 1500000, maxBuffer: 1 << 26 });
    ok = out.indexOf(s.expect) >= 0 || out.indexOf('失败 0 项') >= 0;
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    ok = out.indexOf(s.expect) >= 0;
  }
  console.log(ok ? 'PASS' : 'FAIL');
  if (!ok) {
    allOk = false;
    const failLines = out.split('\n').filter(function (l) {
      return l.indexOf('FAIL') >= 0 || l.indexOf('失败项') >= 0;
    });
    failLines.slice(0, 6).forEach(function (l) { console.log('     ' + l.trim()); });
  }
  results.push({ name: s.name, ok: ok });
}

console.log('');
console.log('═══════════════════════════════════════');
const okCount = results.filter(function (r) { return r.ok; }).length;
console.log('  通过 ' + okCount + '/' + results.length + ' 套测试');
console.log('  ' + (allOk ? '全部通过 ✅' : '有失败项 ❌'));
console.log('═══════════════════════════════════════');
process.exit(allOk ? 0 : 1);
