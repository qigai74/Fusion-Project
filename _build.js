/* 构建：拼装 index.html，并产出完全离线的分发目录「发布/」。
   会先把 _sfx_clips.js（真实枪声样本，base64）注入进 _script_a.js 之后。 */
const fs = require('fs');
const path = require('path');

const PARTS = ['_shell_head.html', '_script_a.js', '_script_b.js', '_script_c.js', '_shell_tail.html'];
/* 音效样本：优先用项目目录内的副本（这样别人 clone 下来就能直接构建），
   找不到再回退到上级目录（原始开发环境的布局）。
   文件不存在时游戏自动回退到合成音，所以**删掉它也能正常构建运行**。 */
const CLIPS_LOCAL = path.join(__dirname, '_sfx_clips.js');
const CLIPS_PARENT = path.join(__dirname, '..', '_sfx_clips.js');
const CLIPS = fs.existsSync(CLIPS_LOCAL) ? CLIPS_LOCAL : CLIPS_PARENT;
const B = require('./_brand.js');

/* ★ 品牌占位符替换：作品名只写在 _brand.js 一处。
   分发时改名（比如避开《球球大作战》的商标）只需要改 _brand.js。 */
const BRAND_MAP = {
  '__GAME_FULL_TITLE__': B.FULL_TITLE,
  '__BRAND__':           B.BRAND,
  '__GAME_NAME__':       B.NAME,
  '__GAME_SUB__':        B.SUB,
  '__GAME_TAGLINE__':    B.TAGLINE,
  '__GAME_VERSION__':    B.VERSION,
  '__GAME_SITE__':       B.SITE,
  '__GAME_REPO__':       B.REPO,
  '__GAME_LICENSE__':    B.LICENSE,
  '__GAME_YEAR__':       String(B.YEAR),
  '__GAME_CONTACT__':    B.CONTACT || '',
};

let html = PARTS.map(p => fs.readFileSync(path.join(__dirname, p), 'utf8')).join('');
for (const k in BRAND_MAP) {
  html = html.split(k).join(BRAND_MAP[k]);
}
/* 构建后不允许残留未替换的占位符 */
const left = html.match(/__[A-Z_]+__/g);
if (left) {
  console.warn('⚠ 未替换的占位符：' + Array.from(new Set(left)).join(', '));
}

/* 注入真实枪声样本。样本是**可选**的：文件不存在时游戏自动回退到合成音，
   所以删掉 _sfx_clips.js 也能正常构建、正常运行。 */
let clipsBytes = 0;
if (fs.existsSync(CLIPS)) {
  const clips = fs.readFileSync(CLIPS, 'utf8');
  clipsBytes = clips.length;
  const anchor = '/* ================= 真实枪声采样 =================';
  if (html.indexOf(anchor) >= 0) {
    html = html.replace(anchor, clips + '\n' + anchor);
  } else {
    html = html.replace('<script>', '<script>\n' + clips + '\n');
  }
}
fs.writeFileSync(path.join(__dirname, 'index.html'), html);

const stamp = new Date().toISOString().slice(0, 10);
const ver = B.VERSION || stamp;
const SHORT = B.NAME;

/* 分发版：标题带版本号，并写入构建日期（便于玩家报 bug 时对版本） */
const dist = html.replace(
  '<title>' + B.FULL_TITLE + '</title>',
  '<title>' + B.FULL_TITLE + ' ' + ver + '</title>'
).replace(
  '<div class="ts-ver" id="tsVersion"></div>',
  '<div class="ts-ver" id="tsVersion">' + ver + ' · ' + B.LICENSE + ' · ' + stamp + '</div>'
);

const outDir = path.join(__dirname, '发布');
fs.mkdirSync(outDir, { recursive: true });
/* ★ 清理上一次构建留下的旧文件（改名后特别重要：
   否则「发布/」里会同时躺着「球球小作战.html」和「圆方战记.html」，
   玩家不知道该点哪个）。只删我们自己产出的那几类，不动别的。 */
for (const f of fs.readdirSync(outDir)) {
  const full = path.join(outDir, f);
  if (!fs.statSync(full).isFile()) continue;
  const isOurs = /\.html$/i.test(f) || f === '启动游戏.bat' ||
                 f === '说明.txt' || /^LICENSE/i.test(f) || /^README/i.test(f);
  if (isOurs && f !== SHORT + '.html') {
    try { fs.unlinkSync(full); } catch (e) {}
  }
}
fs.writeFileSync(path.join(outDir, SHORT + '.html'), dist);
fs.writeFileSync(path.join(outDir, '启动游戏.bat'),
  '@echo off\r\nrem 双击即玩：用默认浏览器打开游戏（完全离线，无需任何服务器）\r\nstart "" "%~dp0' + SHORT + '.html"\r\n');

const lines = [
  B.FULL_TITLE + '  ' + ver,
  '================================',
  '',
  '玩法：双击「启动游戏.bat」（或直接双击 ' + SHORT + '.html）即可开始，',
  '完全离线单文件，无需安装、无需联网、无任何外部依赖。',
  '',
  '建议用 Chrome / Edge 打开。按 F 全屏，Esc 退出全屏；',
  '左键框选部队，右键派遣；空格暂停，S 调速，R 重打，N 显示队伍编号，L 点击指挥开关，E 配置。',
  '',
  '三种模式：',
  '  常规对战 —— 双方自由编队，全歼对手',
  '  撤离任务 —— 带平民撤到撤离区，僵尸从远端涌入',
  '  预算模式 —— 预知地图与敌军规模，用预算组建队伍',
  '',
  '自制地图可以在「⑤ 地图」里保存、导出 .json、导入别人的地图。',
  '',
  '本目录所有文件可随意复制分发（非商业）。',
  '',
  '许可：' + B.LICENSE + '　版权 ' + B.YEAR + ' ' + B.BRAND,
  B.REPO ? ('源码：' + B.REPO) : '',
  '',
  '---- 音效素材来源与授权 ----',
  '本作音效为真实录音采样（仅做裁剪 / 降采样 / 归一化，无音色合成），来源：',
  '  Prepared SFX Library (CC0) — 各兵种专属枪声（AR-15 / Mosin / PPSh / Mossberg 等）',
  '  Q009 (CC BY-SA 3.0) — 手雷、换弹、空仓、连发',
  '  Red Eclipse (CC BY-SA 3.0) — 喷火器、RPG、榴弹、爆炸',
  '  Zombie/Monster Voice (CC0) — 僵尸嚎叫、低吼、阵亡',
  '  Wikimedia Commons — 部分枪声与爆炸录音',
  '如需再分发，请保留上述署名与授权说明。',
  ''
].filter(function (l) { return l !== ''; }).concat(['']);
fs.writeFileSync(path.join(outDir, '说明.txt'), lines.join('\r\n'));

/* 分发目录里一并带上授权与说明 —— 开源/分发时必需，
   玩家把整个文件夹转给别人时也不会丢授权信息。 */
for (const src of ['LICENSE.txt', 'README.md']) {
  const p = path.join(__dirname, src);
  if (fs.existsSync(p)) {
    /* README 换个名字，免得和「说明书」混淆 */
    const outName = (src === 'README.md') ? 'README（玩法与开发说明）.md'
                                          : src.replace('.txt', '') + '.txt';
    fs.copyFileSync(p, path.join(outDir, outName));
  }
}

/* 自检：页面里不允许出现任何外部引用 */
const external = dist.match(/(src|href)\s*=\s*["'](https?:)?\/\//g) || [];
if (external.length) {
  console.error('发现外部引用，分发版不合格：', external);
  process.exit(1);
}

/* ★ 自检：JS 里 $('#xxx') 引用的 id 必须在 HTML 中存在。
   为什么必须查：曾经因为删掉一个 <b id="cohShow"> 却忘了删对应的
   $('#cohShow').textContent=... ，运行到那行就抛 TypeError，
   **整个脚本中断** —— 标题屏、QB 接口、事件绑定全部没执行，
   表现成「地图没更新 / 功能失灵」，极难排查。
   这里把它挡在构建阶段。 */
const htmlPart = PARTS.filter(p => /\.html$/.test(p))
  .map(p => fs.readFileSync(path.join(__dirname, p), 'utf8')).join('');
const jsPart = PARTS.filter(p => /\.js$/.test(p))
  .map(p => fs.readFileSync(path.join(__dirname, p), 'utf8')).join('');
/* 自检前先把注释剥掉，避免把文档里举例的 $('#warBar') 误判成真实引用 */
const jsCode = jsPart
  .replace(/\/\*[\s\S]*?\*\//g, '')      // 块注释
  .replace(/^\s*\/\/.*$/gm, '');         // 行注释

const refIds = new Set();
let mm;
const idRe = /\$\('#([A-Za-z0-9_]+)'\)/g;
while ((mm = idRe.exec(jsCode))) refIds.add(mm[1]);
const broken = [];
refIds.forEach(function (id) {
  if (htmlPart.indexOf('id="' + id + '"') >= 0) return;
  /* 该引用如果带了判空（if($('#x')) / &&$('#x')），就是有意为之，不算问题 */
  const uses = [
    "if($('#" + id + "'))",
    "&&$('#" + id + "')",
    "if ($('#" + id + "'))",
  ];
  const guarded = uses.some(function (u) { return jsCode.indexOf(u) >= 0; });
  if (!guarded) broken.push(id);
});
if (broken.length) {
  console.warn('⚠ 以下 id 被 JS 引用但 HTML 里不存在、且未判空（会导致脚本中断）：' + broken.join(', '));
}

/* ★ 自检：音效配方引用的 clip 名必须真实存在。
   曾经有 5 个配方引用了不存在的样本（metalhit / fleshhit / stonehit /
   woodhit / hurt）且**没有兜底** → 运行时完全静音。
   其中 woodhit 是僵尸砸门的高频音效，整场听不到破坏声，
   玩家感觉「音效丢失」。无头测试查不出来（没有真实 AudioContext），
   只能在构建阶段静态检查。 */
{
  const clipBlock = html.match(/const SFX_CLIPS\s*=\s*\{([\s\S]*?)\n\};/);
  const recipeBlock = html.match(/const SFX_RECIPES\s*=\s*\{([\s\S]*?)\n\};/);
  if (clipBlock && recipeBlock) {
    const clipNames = new Set();
    const cnRe = /^\s{2}(\w+)\s*:\s*['"]/gm;
    let cn;
    while ((cn = cnRe.exec(clipBlock[1]))) clipNames.add(cn[1]);

    const refs = new Set();
    let r;
    const p1 = /playClip\(\s*'([^']+)'/g;
    while ((r = p1.exec(recipeBlock[1]))) refs.add(r[1]);
    const p2 = /pickClip\(\s*\[([^\]]+)\]/g;
    while ((r = p2.exec(recipeBlock[1]))) {
      const p3 = /'([^']+)'/g;
      let r3;
      while ((r3 = p3.exec(r[1]))) refs.add(r3[1]);
    }
    const missing = [];
    refs.forEach(function (k) { if (!clipNames.has(k)) missing.push(k); });
    if (missing.length) {
      console.warn('⚠ 音效配方引用了不存在的样本（会静音）：' + missing.join(', '));
    } else {
      console.log('音效自检通过：' + refs.size + ' 个引用全部有对应样本');
    }
  }
}

console.log('built index.html (' + html.length + ' bytes, 音效 ' +
  (clipsBytes / 1024).toFixed(1) + ' KB) + 发布/' + SHORT + '.html ' + ver);
