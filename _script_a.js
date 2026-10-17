"use strict";
/* =========================================================================
   __GAME_FULL_TITLE__
   （作品名统一在 _brand.js 里改，构建时替换 —— 不要在这里写死名字）
   圆点 = 人类型单位 / 实心方块 = 墙 / 半透明方块 = 窗户与门
   僵尸型近战命中造成感染：3 秒窗口内没被治好就尸变, 并倒戈加入攻击者一方
   队伍制：默认「队伍1(人类) vs 队伍2(僵尸)」, 可自由增删队伍(最多 6 支),
   每支队伍都能混编人类型与僵尸型兵种, 形成多阵容对打；所有角色始终可用
   单位身上的数字 = 队伍编号
   ========================================================================= */

/* ---------------- 基础工具 ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const clamp = (v,a,b) => v<a?a:(v>b?b:v);
const TAU = Math.PI*2;
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
let rng = mulberry32((Date.now()^0x9e3779b9)>>>0);
function rnd(){ return rng(); }
function rr(a,b){ return a+(b-a)*rng(); }
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=(rng()*(i+1))|0; const t=arr[i]; arr[i]=arr[j]; arr[j]=t; } return arr; }

/* ---------------- 网格常量（地图尺寸可切换：小 / 中 / 大） ---------------- */
/* ★ 网格尺寸缩小（32 → 24），地图格数相应放大。
   为什么这么做（用户提示「像他一样单个模块的占用变小」）：
   参考作品是 300×660 的竖屏画面，却能装下上百个单位 ——
   说明它的**单个模块（格子）相对很小**，单位密度极高。

   我们原来是 TILE=32、40×22，一屏只有 880 格，
   几十个单位就显得很挤，而掩体一旦占掉 1 格就是 32px 的大块。
   现在 TILE=24、地图格数等比放大（见 MAP_SIZES），效果是：
     · 同样一块掩体在地图上占的**视觉比例更小**，可以摆得更细
     · 战场格数从 880 提到 1500+，容纳的单位与掩体都更多
     · 单位相对地图变小 → 交火距离拉长，更接近参考作品的观感
   TILE 只影响「一格多少像素」，所有战斗数值（射程/速度/半径）
   都是像素单位，改 TILE 不会改变单位之间的相对强弱。 */
const TILE=24;
const MAP_SIZES={
  small: {name:'小地图',gw:36,gh:20},
  medium:{name:'中地图',gw:52,gh:28},
  large: {name:'大地图',gw:72,gh:40},
  huge:  {name:'超大地图',gw:96,gh:54},   // 城市救援 / 大规模交战专用
};
let MSIZE='medium', GW=52, GH=28, VW=GW*TILE, VH=GH*TILE;
const EMPTY=0, WALL=1, WIN=2, DOOR=3;
const DOOR_MAX=150;
const WIN_MAX=90;             // 窗的结构耐久（僵尸可砸穿，砸穿后变成缺口）
const BREAK_SCAN=TILE*1.6;    // 僵尸主动找「挡路结构」的搜索半径
const BREAK_ARC_COS=0.25;     // 只砸朝向目标一侧的结构（点积阈值，≈75° 锥角）
const DIR8=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
const idx=(x,y)=>y*GW+x;
const inB=(x,y)=>x>=0&&y>=0&&x<GW&&y<GH;
const cx_of=x=>x*TILE+TILE/2, cy_of=y=>y*TILE+TILE/2;

/* ---------------- 规则常量 ---------------- */
const INFECT_TIME=3.0;        // 被咬后多少秒尸变
const ZOMBIE_FRESH=0.55;      // 尸变后继承的僵尸血量比例
const PANIC_R=96;             // 僵尸型敌人进入此距离, 人类型单位必定后撤（原 70：更早撤）
const HUMAN_KITE=0.42;        // 人类主动后撤时多跑的余量：撤到 panicR 的多少倍之外才停
const HUMAN_SPEED_MUL=1.07;   // 全体人类型移速小幅上调（第⑤项：+7%）
const COHESION_R=150;         // 抱团搜索半径（超出则不长途奔波）
const COHESION_DEAD=27;       // 距离同伴小于此值就不再挤（随半径 0.8 缩放）
const LINE_GAP=17;            // 战线间距：同伴近于此值就互相推开，形成有厚度的散兵线
const SEP_MAX_W=0.34;         // 分离力权重上限：保证主意图（后撤/进攻）始终占主导
const SEP_BIAS=0.45;          // 分离偏置的固定幅度（不随拥挤放大，避免把单位钉死）
/* 友军挡射界：开启后只有前排能开火，后排会主动走位找射界。
   这是「薄弧形散兵线」能形成的原因，也避免了 500 人集火秒杀单个目标。 */
const FRIENDLY_BLOCK=true;
const LANE_BLOCK_DIST=120;    // 只看身前这段距离内有没有友军挡住
const CIVILIAN_AURA_R=76;     // 平民鼓舞半径（随半径 0.8 缩放）

/* ---------------- 队形系统（像真实部队一样列阵） ----------------
   真实步兵班不是「一堆人朝敌人跑」，而是有明确结构的：
     · 盾兵/霰弹在最前排扛线（rank 0~1）
     · 步枪手在中排输出（rank 2）
     · 机枪/火箭在第三排提供压制（rank 3）
     · 医疗兵在靠后位置待命（rank 4）
     · 狙击手在最后排（rank 5）
     · 同一排里的人沿「战线方向」横向排开（file）
   这样做的好处：
     ① 天然解决「后排挡住前排射界」的问题（纵深拉开了）
     ② 远程单位不会被顶到最前面送死
     ③ 画面从「一团球」变成有厚度的阵列，和视频里的观感一致 */
const RANK_DEPTH={
  shieldman:0, shotgun:1, flamer:1,
  rifle:2, rocketeer:3, mg:3, medic:4, sniper:5, civilian:6,
};
const RANK_STEP=27;           // 每排之间的纵深间距（px，会随 RS 缩放）
const FILE_GAP=23;            // 同一排内相邻单位的横向间距
const FORM_W=0.40;            // 队形引力权重（相对主意图）
const FORM_ARRIVE=14;         // 到位的容差，避免在格位上抖
const FORM_REFRESH=0.28;      // 队形基准（中心/朝向）的重算间隔
const MID_RANK=2.5;           // 排号中间值：让阵形以队伍中心为基准（盾=0 … 狙=5）
const CIVILIAN_AURA=1.25;     // 射速加成（不可叠加）
const HEAL_INTERVAL=3.0;      // 医疗兵：每 3 秒治疗一个单位
const HEAL_BURST=42;          // 单次治疗量
const INFECTED_AVOID_R=48;    // 同伴被感染后，非医疗兵单位的回避半径（随半径 0.8 缩放）
const WAVE_CHECK=0.25;        // 僵尸轮次检查间隔
const COVER_REFRESH=0.5;      // 游击每隔多久重挑一次掩体
const COVER_GAIN=7;           // 新掩体要比现位置好这么多才挪窝（防抖）
const WIN_SHOOT_BONUS=1.5;    // 隔窗射击的掩体评分加成
const DOOR_DODGE_R=35;        // 门口躲避：距门多近算「借门」（随半径 0.8 缩放）
const HOLD_SCORE_R=210;       // 判断「这地方好守吗」的取样半径
const FREE_REPLAN=1.2;        // 自由行动每隔多久重新决策一次
const DISPATCH_EPS=16;        // 抵达派遣点的判定半径
const DISPATCH_TTL=60;        // 派遣指令最长保留时间（秒），防止永久追点
const MAX_TEAMS=6;            // 最多几支队伍
const HIT_PAD=2.0;            // 子弹命中判定的额外余量（随半径 0.8 从 2.5 缩放）
const TARGET_REFRESH=0.22;    // 目标搜索缓存时长（秒）：大编制下省下大量邻域查询
/* ---------------- 感染超临界（学 B站「这球有问题」的爆发曲线） ----------------
   他的对局数据（我从视频 HUD 逐帧读出）：
     8.5s  人类495 僵尸4       ← 潜伏期，几乎不动
     24.5s 人类485 僵尸6
     40.5s 人类460 僵尸22      ← 开始加速
     52.5s 人类87  僵尸233     ← 指数爆炸（12 秒从 22 涨到 233）
     56.5s 人类0   僵尸276     ← 人类崩盘
   这是典型的 R0>1（超临界）曲线：一旦突破临界点就不可逆。
   我们的旧版本 R0<1，僵尸必输，永远出不来这个形状。
   下面几个开关用来把「传播效率」调到超临界：
     • 新尸变单位有短暂的「僵直」，之后才全力扑咬
     • 尸变单位继承更多血量（否则刚变就被旁边的人秒掉，R0 被压到 1 以下）
     • 群体狂暴：僵尸数量越多，单次撕咬的感染概率越高（正反馈）
   注意：这些数值直接决定平衡，改动后必须重跑平衡矩阵。 */
const PLAGUE_ON=true;                 // 总开关
const ZOMBIE_FRESH_HP=0.72;           // 尸变继承血量比例（原 0.55 → 更容易滚雪球）
const ZOMBIE_ROUSE=1.2;               // 尸变后「僵直」时间（秒），期间不攻击
const PLAGUE_BOOST_MAX=0.55;          // 群体狂暴上限：僵尸占比越高，感染概率加成越大
function plagueBoost(){
  if(!PLAGUE_ON) return 0;
  let z=0,h=0;
  for(const u of G.units){
    if(!u.alive) continue;
    if(u.kind==='z') z++; else h++;
  }
  const total=z+h;
  if(!total) return 0;
  return PLAGUE_BOOST_MAX*(z/total);
}
/* 僵尸索敌半径：必须足够覆盖整张地图的对角线，
   否则两队隔远了（如左右出生点相距 1000+px）僵尸会「看不见敌人」而原地发呆。
   这里取画面对角线，配合 TARGET_REFRESH 缓存，性能与行为都能兼顾。 */
function zombieSeekR(){ return Math.hypot(VW,VH); }
/* 单纯为了「朝哪个方向瞄准」的索敌半径：覆盖整图即可，不必更大 */
function aimSeekR(){ return Math.max(VW,VH); }

/* ---------------- 角色缩放（第⑥项：全体缩小以容纳更大对局） ----------------
   RS = radius scale。所有「半径类」常量与绘制尺寸都必须乘它，改这一个数即可整体缩放。
   注意：改完必须重跑平衡矩阵（_test.js 的平衡段），单位密度变高会显著改变胜负。 */
const RS=0.8;
const rsz=r=>Math.round(r*RS*10)/10;          // 半径取一位小数，避免浮点噪声进测试
/* holdScoreAt 的取样尺度（像素语义，随 RS 联动换算成格数）。
   原值是 R=3 格、咽喉探测 6 格；乘 RS 后保持「覆盖同样多的身位」，
   否则缩小角色会让同一张图上评分最高的格子整片搬家，坚守点漂到敌方跟前。 */
const HOLD_SCORE_W=TILE*3*RS;
const HOLD_CHOKE_SPAN=TILE*6*RS;

/* ---------------- 新机制常量（第①②③④项） ---------------- */
const BURN_TIME=3.0;          // 灼烧持续 3 秒
const BURN_DPS=9;             // 灼烧每秒固定扣血
const BURN_REFRESH=true;      // 灼烧「可刷新时长、不叠加」（设计确认 ①）
const SHIELD_HIT_WINDOW=2.0;  // 盾卫最近 2 秒内挨打就不能开枪（设计确认 ③）
const SHIELD_PUSH=520;        // 盾击的瞬时击退速度（大幅加强：原来是 230，推不动）
const SHIELD_ARC=1.45;        // 盾牌防御扇形的半角（加宽：覆盖更大的正面）
const SHIELD_STUN=0.55;       // 被盾击命中后的硬直时间（僵尸会被打断攻击）
const SHIELD_KNOCK_T=0.22;    // 击退持续时间
/* 盾牌：★ 正面「完全免疫」伤害 —— 盾卫的核心价值就是举盾时正面无敌。
   侧后方只吃少量减伤（盾牌挡不住，但护具仍在）。
   配套机制：
     · 盾卫会「缓慢持续转向」最近的威胁（SHIELD_TURN），所以不是无脑免疫，
       敌人绕到侧后就打得动 —— 这就是它唯一的破绽。
     · 举盾期间自己也不能开枪（见 shieldMayShoot），形成攻防取舍。 */
const SHIELD_IMMUNE=true;     // 正面完全免疫
const SHIELD_DR_SIDE=0.45;    // 侧后方减伤 45%（原 20%：即使被绕后也很能扛）
const SHIELD_TURN=2.10;       // 盾牌转向速度（弧度/秒）—— 原 1.35 太慢，容易被绕
/* ★ 盾牌不可破坏：
   盾卫的盾不再有耐久、不会被任何攻击打掉，防御力完全由「朝向」决定 ——
   只有绕到侧后才能真正伤到它。这是用户明确要求的方向：
   强调盾卫的防御对抗能力，让它成为真正的坦克，而不是「盾一破就废」。 */
const SHIELD_UNBREAKABLE=true;
const GRENADE_CD=9.0;         // 步兵掷手雷冷却
const GRENADE_R=52;           // 手雷爆炸半径
const GRENADE_DMG=26;         // 手雷爆炸伤害
const ROCKET_R=62;            // 火箭爆炸半径
const ROCKET_DMG=46;          // 火箭爆炸伤害
const TEAM_COLORS=['#5ee07a','#ff8a7a','#6ea8ff','#ffd84d','#c07aff','#4ad6c8'];

/* ---------------- 兵种表（数值可在「数值调整」里改） ----------------
   kind = 兵种性质：'h' 人类型（会被感染 / 吃平民光环 / 推门而过）
                     'z' 僵尸型（近战并造成感染 / 撞门）
   kind 与「属于哪支队伍」无关：任何队伍都能编入任意兵种 */
/* 制式手枪：医疗兵 / 盾卫 / 狙击手（副武器）数值必须完全一致。
   ★ 之前两者各写一套（医疗兵 6/0.6/230、盾卫 7/0.55/120），
     同一个「手枪」打出来伤害和射程都不同，既不合理也难平衡。
     现在统一定义一次，所有用手枪的角色都引用它。
   伤害在用户要求下集体 +1（8 → 9）。 */
const PISTOL={dmg:10,cd:0.42,range:230,spread:0.045,bspeed:620};
function pistolGun(){ return Object.assign({},PISTOL); }
const CLASSES = {
  rifle:  {num:1,kind:'h',name:'步枪手',  color:'#5ee07a',hp:110,speed:56,dmg:12,cd:0.50,range:300,spread:0.045,bspeed:600, pref:235,radius:9,lead:1,mag:30,reload:2.0,
           role:'中距持续输出', feat:'均衡输出：中距离持续火力，命中稳定，DPS 高于狙击手，是阵容中坚'},
  sniper: {num:2,kind:'h',name:'狙击手',  color:'#6ea8ff',hp:80, speed:44,dmg:72,cd:3.20,range:560,spread:0.0,  bspeed:1400,pref:410,radius:8,lead:1,pierce:-1,pierceMul:0.25,mag:6,reload:2.5,
           /* 副武器：被近身时能用手枪自卫（狙击枪在近战几乎无用） */
           gun:pistolGun(),sidearm:1,
           role:'远程点杀', feat:'单发伤害最高、射程最远，子弹无限贯穿，后续目标只吃 25% 伤害；攻速极慢，<b>被近身时改用手枪自卫</b>'},
  mg:     {num:3,kind:'h',name:'机枪手',  color:'#f5a742',hp:150,speed:36,dmg:8, cd:0.10,range:290,spread:0.115,bspeed:640, pref:215,radius:10,suppress:1,mag:100,reload:4.0,
           role:'弹幕压制', feat:'高射速弹幕压制，命中附带减速；移动最慢但血量最厚'},
  shotgun:{num:4,kind:'h',name:'霰弹枪手',color:'#ffd84d',hp:118,speed:58,dmg:9, cd:1.05,range:155,spread:0.30,bspeed:540, pref:48, radius:9,pellets:6,mag:8,reload:1.0,shell:1,
           role:'近距爆发', feat:'近距 6 发霰弹齐射，贴脸单次爆发极高；中远距几乎打不中'},
  medic:  {num:5,kind:'h',name:'医疗兵',  color:'#eaf2ff',hp:100,speed:60,range:230,pref:200,radius:9,
           heal:1, healR:150,
           gun:pistolGun(),mag:10,reload:2.0,
           role:'治疗 / 解除感染', feat:'每 3 秒治疗一名同队单位（优先被感染者），一次回满一截血并直接解除感染；另配制式手枪自卫'},
  civilian:{num:6,kind:'h',name:'平民',   color:'#c9d8c4',hp:70, speed:70,dmg:4,cd:0.80,range:24,radius:7,melee:1,
           role:'鼓舞 + 近战', feat:'只会 4 点伤害的近战，但跑得最快；站在同队人类型单位身边时为他们 +25% 射速（多人不叠加）'},
  /* ---- 新增 4 个人类角色（移交文档第 7.1 节） ---- */
  flamer: {num:7,kind:'h',name:'喷火兵',  color:'#ff8c42',hp:135,speed:50,dmg:9, cd:0.12,range:118,spread:0.075,bspeed:430,pref:86,radius:9,pierce:-1,pierceMul:1,burn:1,mag:60,reload:7.0,emptyOnly:1,
           role:'近距穿透 + 灼烧', feat:'火舌无限穿透，穿过的每个敌人都会被点燃（每秒 '+BURN_DPS+' 点、持续 '+BURN_TIME+' 秒，重复命中只刷新时间不叠加）；<b style="color:#ff9ad2">燃料罐必须打空才能换弹</b>，换弹极慢'},
  rocketeer:{num:8,kind:'h',name:'火箭兵', color:'#ff6b3d',hp:106,speed:46,dmg:46,cd:2.60,range:380,spread:0.02, bspeed:340,pref:300,radius:9,mag:1,reload:3.6,rocket:1,
           role:'远程范围杀伤', feat:'<b style="color:#ffd84d">弹舱只有 1 发</b>，打出火箭弹：命中敌人或墙壁立即爆炸，打空则飞到最大射程自爆；爆炸对半径 '+ROCKET_R+' px 内敌人造成 '+ROCKET_DMG+' 点伤害（离爆心越远伤害越低）'},
  shieldman:{num:9,kind:'h',name:'盾卫',  color:'#9fb4d8',hp:420,speed:50,dmg:PISTOL.dmg,cd:PISTOL.cd,range:PISTOL.range,spread:PISTOL.spread,bspeed:PISTOL.bspeed,pref:150,radius:9,gun:pistolGun(),mag:14,reload:3.2,
           shield:{reach:38,dmg:34,kb:SHIELD_PUSH,cd:0.62,stun:SHIELD_STUN},
           role:'盾墙 + 盾击', feat:'朝威胁方向举盾：<b style="color:#7dffa8">盾牌正面完全免疫伤害且<b>永不可破</b></b>（侧后仍减伤 '+Math.round(SHIELD_DR_SIDE*100)+'%）；盾牌快速转向（'+SHIELD_TURN+' rad/s）；盾击造成 <b style="color:#ffd84d">'+Math.round(SHIELD_PUSH)+' 速度击退 + '+SHIELD_STUN+' 秒硬直</b>，能强行打断僵尸的进攻'},
  zombie: {num:1,kind:'z',name:'僵尸',    color:'#63c96f',hp:158,speed:64,dmg:20,cd:0.90, range:26, radius:9, infect:1,
           role:'近战 + 感染', feat:'近战撕咬，命中必感染：3 秒后尸变并倒戈加入自己一方。可撞开木门，速度高于多数人类兵种'},
  runner: {num:2,kind:'z',name:'跑尸',    color:'#8ef07a',hp:96, speed:86,dmg:30,cd:0.80, range:26, radius:8, infect:0.5,
           role:'高速突击', feat:'血少、跑得极快、单次伤害更高，但每次命中只有 50% 概率造成感染；专抓掉队的人'},
  mother: {num:3,kind:'z',name:'僵尸母体',color:'#b465e8',hp:1150,speed:44,dmg:44,cd:1.50, range:30, radius:13, infect:1, hatch:10.0,maxChild:3, spawnCls:'zombie',
           role:'前排 + 孵化 + 感染', feat:'重甲近战并感染，每 10 秒孵化 1 只<b>普通僵尸</b>（自身上限 3 只），战场的僵尸兵工厂'},
  bigbelly:{num:4,kind:'z',name:'大胃袋',  color:'#c9b45a',hp:300,speed:40,dmg:16,cd:1.10, range:26, radius:12, infect:1,
           deathBurst:{r:95,dmg:30,infect:0.5},
           role:'移动弹药库 + 死亡爆裂', feat:'血更厚、跑得更慢；死亡时胃袋爆裂，对周围小范围造成 30 点伤害并有 50% 概率感染波及者'},
  umother:{num:5,kind:'z',name:'终极母体',color:'#ff4fd8',hp:2200,speed:34,dmg:50,cd:1.60, range:30, radius:15, infect:1, instant:1, hatch:12.0,maxChild:20,twins:2, randomSpawn:1,
           role:'终极兵工厂', feat:'重甲近战；攻击立刻感染成功（被咬者当场尸变）；每 12 秒一次孵化 2 只<b>随机僵尸</b>（跑尸 / 僵尸 / 大胃袋 / 母体，<b>不含终极母体自己</b>），累计上限 20 只'},
};
const DEFAULT_STATS={};

/* ============================================================================
   预算模式：兵种定价
   ============================================================================
   玩法：开局前**知道地图和对手的总数量 / 波次**，但不知道对手具体编成；
        玩家用一笔固定预算买自己的队伍，花完为止。

   定价必须客观，否则模式就是运气游戏。这里用「战斗价值」推算：
     价值 = 生存力 + 输出力 + 特殊性
       · 生存力：血量、减伤（盾）、治疗能力
       · 输出力：DPS × 有效射程系数（射程越远越安全 → 加权）
       · 特殊性：感染、孵化、范围伤害、穿透等
   再把价值映射成 5 的整数倍（方便玩家心算），最低 5。

   定价一旦改，预算模式的平衡就会变 —— 所以价格是**算出来的**而不是手写的，
   改兵种数值后自动跟着变，不会出现「数值调了但价格没调」的失衡。
   ========================================================================== */
const _PRICE_CACHE={};
function unitPrice(cls){
  if(_PRICE_CACHE[cls]!==undefined) return _PRICE_CACHE[cls];
  const d=CLASSES[cls];
  if(!d){ _PRICE_CACHE[cls]=5; return 5; }
  /* ① 生存力（血量是主要成本项） */
  const hp=d.hp*0.030;
  /* 盾卫：正面免疫 + 击退 + 硬直，等价于一大截有效血量 */
  const shield=d.shield?14:0;
  /* ② 输出力：DPS × 射程系数 */
  const shots=d.shot||1;
  const dps=d.cd>0?(d.dmg*shots)/d.cd:0;
  /* 射程系数：越远越安全，但近战（射程<40）也不该被低估，给下限 0.8 */
  const rangeMul=d.range>=500?1.5 : d.range>=300?1.3 : d.range>=200?1.1 : 0.8;
  const atk=dps*rangeMul;
  /* ③ 特殊性。
     ★ 刻度目标（改 pricing 时照着调）：
         普通僵尸 ≈ 12　跑尸 ≈ 16　大胃袋 ≈ 20
         步枪手 ≈ 15　霰弹 ≈ 14　狙击 ≈ 22　机枪 ≈ 26
         盾卫 ≈ 30　喷火 ≈ 28　火箭 ≈ 30
         普通母体 ≈ 48　终极母体 ≈ 90
       这样 180 预算能买 12 人上下，600 预算能买 20+ 人，
       既有「铺人数」的空间，也有「攒钱买重甲」的取舍。 */
  let special=0;
  if(d.infect) special+=d.infect*3;                  // 感染
  if(d.instant) special+=5;                           // 当场尸变
  if(d.heal) special+=6;                              // 治疗 + 解感染
  if(d.deathBurst) special+=4;                        // 死亡爆裂
  if(d.hatch) special+=d.hatch<=12?16:10;             // 孵化（母体的核心价值）
  if(d.randomSpawn) special+=6;                       // 随机孵化
  if(d.flame&&d.pierce) special+=7;                   // 穿透灼烧
  if(d.rocket) special+=8;                            // 范围爆炸
  if(d.radius>=12) special+=3;                        // 大体型
  if(d.aura) special+=5;                              // 光环
  let v=hp+shield+atk*1.15+special;
  /* 医疗兵 / 平民这类「不直接打输出」的必须保底 */
  if(d.heal) v=Math.max(v,15);
  if(d.aura) v=Math.max(v,12);
  /* 映射到整数（最低 3）—— 刻度太粗会让便宜兵和贵兵挤在一起 */
  const p=Math.max(3,Math.round(v));
  _PRICE_CACHE[cls]=p;
  return p;
}

/* 预算模式：**难度档位**与**地图**分开选。
   用户要求：「预算模式的预算和地图分开，以此加强可玩性」。
   原来每个预设写死一张图，玩法组合只有 5 种；
   拆开后 = 5 个难度档 × 8 张预置图 + 随机图 = 可玩组合多一个量级，
   而且「山地要塞打 200 只」和「开阔平原打 200 只」完全是两种打法。

   所以预设里只保留「预算 / 敌军规模 / 波数 / 兵种池」这些**难度参数**，
   地图由玩家在「战场地图」里单独挑（见 bgMapKey）。 */
const BUDGET_PRESETS={
  recruit:{
    name:'新兵演习', budget:300, enemyCount:40, waves:2, diff:'低',
    pool:['rifle','shotgun','medic'],
    enemyPool:['zombie'],
    desc:'对手只有普通僵尸。熟悉「预知规模、按需配队」的思路',
  },
  street:{
    name:'街区遭遇', budget:520, enemyCount:70, waves:3, diff:'中',
    pool:['rifle','shotgun','medic','sniper','mg'],
    enemyPool:['zombie','runner'],
    desc:'巷战地形 + 大量跑尸。需要能顶住近身的火力',
  },
  hospital:{
    name:'医院突围', budget:780, enemyCount:110, waves:4, diff:'中高',
    pool:['rifle','shotgun','medic','sniper','mg','shieldman'],
    enemyPool:['zombie','runner','bigbelly'],
    desc:'大胃袋会冲散阵型，盾卫能挡住第一波',
  },
  downtown:{
    name:'市中心死战', budget:1120, enemyCount:160, waves:5, diff:'高',
    pool:['rifle','shotgun','medic','sniper','mg','shieldman','flamer'],
    enemyPool:['zombie','runner','bigbelly','mother'],
    desc:'母体持续孵化，拖久了必被淹 —— 需要速攻手段',
  },
  laststand:{
    name:'最终防线', budget:1600, enemyCount:200, waves:6, diff:'极高',
    pool:['rifle','shotgun','medic','sniper','mg','shieldman','flamer','rocketeer'],
    enemyPool:['zombie','runner','bigbelly','mother','umother'],
    desc:'200 只、6 波、终极母体随机孵化。必须组一支完整的合成部队',
  },
};

/* 预算模式可用的地图列表（含「随机」）。
   把 random 也放进来 —— 随机图 + 预设规模能进一步延长可玩性。 */
const BUDGET_MAPS=[
  {key:'open',     name:'开阔平原'},
  {key:'balanced', name:'均衡街区'},
  {key:'urban',    name:'巷战废墟'},
  {key:'fort',     name:'中央要塞'},
  {key:'mission1', name:'城市街区'},
  {key:'mission2', name:'市中心'},
  {key:'mission3', name:'老城巷道'},
  {key:'mission4', name:'近郊平房'},
  {key:'random',   name:'随机地图'},
];

/* 把「总预算 + 兵种池」展开成一份具体编成。
   ★ 这是预算模式的核心算法，必须可靠（不能出现买不起 / 买不完 / 编制畸形）。

   做法：按**性价比**贪心，但加入三个约束避免畸形编制：
     ① 必须买到指定的人数下限（否则全是便宜兵，场面难看）
     ② 单一兵种占比不超过 45%（防止「全买一种最强的」这种无脑解）
     ③ 至少要有一个「反重甲」单位（高单价兵），
        否则面对母体会完全打不动 —— 这是给玩家的隐性保底
   返回 {lineup, spent, count, left}。 */
function buildBudgetLineup(budget, pool, opts){
  opts=opts||{};
  const minCount=opts.minCount||8;              // 至少要有这么多人
  const maxShare=opts.maxShare||0.40;           // 单一兵种占比上限
  pool=(pool&&pool.length)?pool.slice():['rifle'];
  const info=pool.map(function(k){
    const d=CLASSES[k];
    return {k:k, price:unitPrice(k), hp:d.hp,
            dps:d.cd>0?d.dmg*(d.shot||1)/d.cd:0};
  }).filter(function(x){ return x.price>0; });
  if(!info.length) return {lineup:{},spent:0,count:0,left:budget};

  const lineup={};
  let spent=0, count=0;

  /* ★ 循环策略（关键是「不要只买性价比最高的那一种」）：
       如果纯按「价值/价格」贪心，永远只会挑到同一种兵 ——
       实测会出现「全是霰弹枪手 + 医疗兵」这种畸形编成。
       这里改成**轮转补位**：
         · 每次挑「当前数量最少、且买得起」的兵种
         · 同数量时，用「价值/价格」打破平局
       这样自然买成一支有层次的部队（前排 / 输出 / 支援都有），
       也让贵兵在预算充裕时一定会被考虑。 */
  const cheapest=Math.min.apply(null,info.map(function(x){ return x.price; }));
  let guard=0;
  while(spent+cheapest<=budget && guard++<600){
    let best=null, bestScore=-1e9;
    for(const x of info){
      if(spent+x.price>budget) continue;
      const have=lineup[x.k]||0;
      const share=count>0?have/count:0;
      /* 占比超限：只有当「别的都买不起」时才允许继续买它 */
      if(count>=4&&share>=maxShare) continue;
      /* 主排序键：现有数量越少越优先（负号让它越小越好）；
         次排序：价值/价格（越高越好） */
      const val=x.hp*0.5+x.dps*1.4;
      const eff=val/x.price;
      const score=-have*100+eff;
      if(score>bestScore){ bestScore=score; best=x; }
    }
    /* 全被占比限制挡住了 → 放宽限制，买最便宜的，避免死循环 */
    if(!best){
      const sorted=info.slice().sort(function(a,b){ return a.price-b.price; });
      best=sorted[0];
      if(spent+best.price>budget) break;
    }
    lineup[best.k]=(lineup[best.k]||0)+1;
    spent+=best.price; count++;
  }
  /* 兜底 ①：一个人都没买到（预算太小）→ 硬塞最便宜的 */
  if(count===0){
    const c=info.slice().sort(function(a,b){ return a.price-b.price; })[0];
    lineup[c.k]=1; spent=Math.min(budget,c.price); count=1;
  }
  /* 兜底 ②：人数不足下限 → 用最便宜的补足 */
  if(count<minCount){
    const sorted=info.slice().sort(function(a,b){ return a.price-b.price; });
    let gi=0;
    while(count<minCount&&spent+sorted[0].price<=budget&&gi<300){
      const k=sorted[gi%sorted.length].k;
      lineup[k]=(lineup[k]||0)+1;
      spent+=sorted[gi%sorted.length].price; count++; gi++;
    }
  }
  /* 兜底 ③：没有高单价兵 → 卖便宜兵换一个重甲（面对母体不至于打不动） */
  const heavyAll=info.filter(function(x){ return x.price>=30; })
                     .sort(function(a,b){ return b.price-a.price; });
  const hasHeavy=heavyAll.some(function(x){ return (lineup[x.k]||0)>0; });
  if(!hasHeavy&&heavyAll.length){
    const want=heavyAll[heavyAll.length-1];            // 最便宜的重甲
    if(spent+want.price>budget){
      const cheap=info.slice().sort(function(a,b){ return a.price-b.price; });
      let gi=0;
      while(spent+want.price>budget&&count>minCount&&gi<200){
        const c=cheap[gi%cheap.length];
        if((lineup[c.k]||0)>0){ lineup[c.k]--; spent-=c.price; count--; if(!lineup[c.k]) delete lineup[c.k]; }
        gi++;
      }
    }
    if(spent+want.price<=budget){
      lineup[want.k]=(lineup[want.k]||0)+1;
      spent+=want.price; count++;
    }
  }
  return {lineup:lineup, spent:spent, count:count, left:budget-spent};
}

/* 预算模式：把「对手总数量 + 波次 + 敌方兵种池」展开成具体波次。
   ★ 敌方编制是**隐藏在局内的**：玩家只知道总量与波数，
     具体每一波是什么兵种，只有打起来才知道 —— 这是模式的核心张力。
   分配原则：杂兵铺前几波，重甲压在后面，形成渐进的难度曲线。
   同时保证「每波都有杂兵垫底」，避免某一波全是重甲直接把玩家打崩。 */
function buildBudgetWaves(preset){
  const P=(typeof preset==='string')?BUDGET_PRESETS[preset]:preset;
  if(!P) return [];
  const pool=(P.enemyPool&&P.enemyPool.length)?P.enemyPool.slice():['zombie'];
  const total=P.enemyCount, waves=Math.max(1,P.waves||1);
  const light=pool.filter(function(k){ return unitPrice(k)<40; });
  const heavy=pool.filter(function(k){ return unitPrice(k)>=40; });
  if(!light.length) light.push('zombie');
  const out=[];
  let left=total;
  for(let w=0;w<waves;w++){
    const remainWaves=waves-w;
    const n=(w===waves-1)?left:Math.max(1,Math.round(left/remainWaves));
    left-=n;
    const lineup={};
    /* 最后一波重甲最多；前面逐步加码 */
    const heavyRatio=heavy.length?((w===waves-1)?0.45:(0.08+w*0.10)):0;
    const hn=Math.min(n,Math.round(n*heavyRatio));
    const hSorted=heavy.slice().sort(function(a,b){ return unitPrice(a)-unitPrice(b); });
    for(let i=0;i<hn;i++){
      /* 终极母体只在最后一波、且只放 1 只 */
      let k=hSorted[i%hSorted.length];
      if(w<waves-1&&k==='umother') k=hSorted[0];
      if(k==='umother'&&(lineup.umother||0)>=1) k=hSorted[0];
      lineup[k]=(lineup[k]||0)+1;
    }
    for(let i=0;i<n-hn;i++){
      const k=light[i%light.length];
      lineup[k]=(lineup[k]||0)+1;
    }
    out.push({lineup:lineup, gap:w===0?0:(w===waves-1?30:22), count:n});
  }
  return out;
}


for(const k in CLASSES){
  const d=CLASSES[k], g=d.gun;
  DEFAULT_STATS[k]={hp:d.hp,speed:d.speed,dmg:d.dmg,cd:d.cd,range:d.range,mag:d.mag||0,reload:d.reload||0,
    gun: g?{dmg:g.dmg,cd:g.cd,range:g.range}:null, shell:d.shell||0};
}
/* ---- 第⑤ + ⑥ 项的联动改写：人类型移速 ×1.07、全体半径 ×RS ----
   放在 CLASSES 定义之后、DEFAULT_STATS 之后执行一次，
   这样「恢复默认」恢复的是调好的新基线，而不是旧数值。 */
for(const k in CLASSES){
  const d=CLASSES[k];
  if(d.kind==='h') d.speed=Math.round(d.speed*HUMAN_SPEED_MUL*10)/10;
  d.radius=rsz(d.radius);
  if(d.gun) d.gun.range=Math.round(d.gun.range*RS);
  d.range=Math.round(d.range*RS);
  if(d.range<20&&!d.melee&&d.kind==='z') d.range=20;   // 近战射程不要缩到够不着
}
for(const k in DEFAULT_STATS){
  const s=DEFAULT_STATS[k], d=CLASSES[k];
  s.speed=d.speed; s.radius=d.radius; s.range=d.range;
  if(s.gun&&d.gun) s.gun.range=d.gun.range;
}
/* 角色顺序即数字顺序：「42222」= 步4 狙2 机2 霰2 医2，「84」= 僵尸8 母体4
   所有角色（含平民 / 跑尸）始终可用，不设解锁门槛 */
const ROLES_H=['rifle','sniper','mg','shotgun','medic','civilian','flamer','rocketeer','shieldman'];   // 人类型兵种
const ROLES_Z=['zombie','mother','runner','bigbelly','umother'];                          // 僵尸型兵种
const ALL_ROLES=ROLES_H.concat(ROLES_Z);
const BASE_H={rifle:4,sniper:2,mg:2,shotgun:2,medic:2,civilian:0,flamer:0,rocketeer:0,shieldman:0};
/* 默认僵尸编制：人类默认 12 人（4步2狙2机2霰2医）。
   平衡矩阵实测（4 张图，中地图，人类编制固定，记录「人类胜/僵尸胜」与人类剩余 HP）：
     16 僵尸 + 2 母体 → 人类 4/0 胜（HP 0.82）
     16 僵尸 + 4 母体 → 人类 3/1 胜（HP 0.59）
     18 僵尸 + 4 母体 → 人类 2/2 胜（HP 0.35）   ← 默认取这组，接近五五开
     20 僵尸 + 4 母体 → 人类 2/2 胜（HP 0.32）
     20 僵尸 + 6 母体 → 僵尸 4/0 胜（HP 0.00）
   注意：母体数量对平衡影响极大（它会不断孵化），调参时不要只动僵尸数。 */
const BASE_Z={zombie:18,mother:4,runner:0};
const BEHAVIORS={free:'自由行动',skirmish:'游击',push:'主动出击',hold:'坚守'};
const BEHAV_ORDER=['free','skirmish','push','hold'];
const TYPE_NAMES={h:'人类型',z:'僵尸型',mix:'混编'};
function poolFor(type){
  if(type==='mix') return ALL_ROLES.slice();
  return (type==='z'?ROLES_Z:ROLES_H).slice();
}
function teamRoles(t){ return poolFor(t.type); }
function syncTeamRoles(){
  for(const t of teams) t.roles=teamRoles(t);
}
function lineupForType(type,src){
  const pool=poolFor(type), o={}, s=src||{};
  for(const k of pool) o[k]=clamp(Math.floor(Number(s[k])||0),0,999);
  return o;
}

/* ---------------- 队伍 ---------------- */
function baseTeam(i){ return {name:'队伍'+(i+1),color:TEAM_COLORS[i%TEAM_COLORS.length]}; }
function blankTeam(i,type,src){
  return Object.assign(baseTeam(i),{
    type:type, roles:poolFor(type), lineup:lineupForType(type,src)
  });
}
let teams=[ blankTeam(0,'h',BASE_H), blankTeam(1,'z',BASE_Z) ];
function rebuildTeams(list){
  teams=list.map((t,i)=>{
    const type=t.type||'h';
    return Object.assign(baseTeam(i),{
      name:t.name||('队伍'+(i+1)),
      type:type,
      color:t.color||TEAM_COLORS[i%TEAM_COLORS.length],
      lineup:lineupForType(type,t.lineup)
    });
  });
  syncTeamRoles();
  return teams;
}

/* ---------------- 全局状态 ---------------- */
const G = {
  phase:'setup', map:new Uint8Array(GW*GH), doorHP:new Float32Array(GW*GH),
  winHP:new Float32Array(GW*GH),
  units:[], bullets:[], parts:[], corpses:[], feed:[], counter:1, grenades:[],
  shocks:[], scorches:[],          // 爆炸冲击波 / 地面焦痕
  jets:[],                         // 喷火兵的连续火线
  /* ★ matchTime 已移除：对局不再有时间上限，
     只按战场结果（一方被打光 / 撤离任务有结论）判定胜负。
     保留字段会让后来接手的人误以为还有计时逻辑。 */
  time:0, tick:0, speed:1, paused:false, result:null, hudT:0, endT:0,
  kills:[], infections:0, converted:0,
  civPos:[], zCap:60, startCount:[], stats:null, baseDirty:true,
  showNums:false, behavior:'free', cmdOn:true, reloadOn:false,
  waveCleared:false, waveIdx:0, waveT:0, waveLog:[], teamNum:[],
  selected:new Set(), selBox:null, dispatchMark:null,
  /* ---- 撤离模式（学 EP20「救援小队 vs 无尽尸潮」）----
     人类队伍要深入地图，把被困的平民带回撤离区。
     平民会跟随最近的护送者；带到撤离区内即算救出。 */
  mission:{on:false, saved:0, total:0, left:0, lost:0, escorting:0, civs:[], zone:null, extractedList:[]},
  missionArea:null, missionZone:null,
  /* ---- 刷怪点（学 EP23/EP24 的「第 N/M 波」）----
     允许在地图上指定若干「洞口」，僵尸从这些点成波涌出，
     而不是一次性在出生区摆满。 */
  spawners:[], spawnOn:false,
  teams:[], panicR:PANIC_R
};
let editGrid = new Uint8Array(GW*GH);

/* ---------------- 方块通行性（按兵种性质，而不是队伍） ---------------- */
/* ★ 翻窗：人类可以翻越窗户，但**速度很慢**。
   设计意图：
     · 窗不再是人类型单位的硬墙 —— 否则一扇关着的窗就能把整队人卡死，
       而僵尸反而能砸窗进来（原来只有僵尸能通过窗），逻辑上是反的
     · 但翻窗有代价：进入「翻越」状态（VAULT_TIME 秒），
       期间速度降到 VAULT_SPEED 倍、不能开枪。
       这样「走门」依然是首选，翻窗是应急手段，形成战术取舍
   · 僵尸不翻窗 —— 它们只会砸（WIN_MAX 打穿后窗变空地） */
const VAULT_TIME=0.85;        // 翻越耗时（秒）—— 明显慢于正常行走
const VAULT_SPEED=0.32;       // 翻越期间的速度倍率
function isWindowAt(tx,ty){ return inB(tx,ty)&&G.map[idx(tx,ty)]===WIN; }
function blocksMove(t,tx,ty,kind){
  if(t===WALL) return true;
  /* 窗：人类可翻越（慢），僵尸不行（要砸开） */
  if(t===WIN) return kind!=='h';
  if(t===DOOR) return G.doorHP[idx(tx,ty)]>0 && kind==='z';   // 人类型推门即过；僵尸型需撞开
  return false;
}
function blocksSight(t,tx,ty){
  if(t===WALL) return true;
  if(t===DOOR) return G.doorHP[idx(tx,ty)]>0;
  return false;
}
const blocksBullet = blocksSight;

/* ---------------- 地图构造工具 ---------------- */
const newGrid=()=>new Uint8Array(GW*GH);
function gSet(g,x,y,t){ if(inB(x,y)) g[idx(x,y)]=t; }
function gRect(g,x,y,w,h,t,fill){
  if(fill===undefined) fill=true;
  for(let j=0;j<h;j++) for(let i=0;i<w;i++){
    if(fill||i===0||i===w-1||j===0||j===h-1) gSet(g,x+i,y+j,t);
  }
}
function gH(g,x1,x2,y,t){ for(let x=Math.min(x1,x2);x<=Math.max(x1,x2);x++) gSet(g,x,y,t); }
function gV(g,x,y1,y2,t){ for(let y=Math.min(y1,y2);y<=Math.max(y1,y2);y++) gSet(g,x,y,t); }
function gBorder(g,t){ t=t===undefined?WALL:t; gH(g,0,GW-1,0,t); gH(g,0,GW-1,GH-1,t); gV(g,0,0,GH-1,t); gV(g,GW-1,0,GH-1,t); }

/* 出生点：按队伍数量均匀分布在场地四周（2 支队伍时即左 / 右对峙）。
   ★ 三队以上时，均匀角度可能正好落在**建筑密集区**上，
     导致 validateGrid 以「出生区空地太少」拒绝开局
     （实测三队混战直接 start 返回 null）。
     这里在锚点周围找一个「空得开」的位置：若原锚点附近空地不足，
     就沿径向 / 切向搜索最近的合格点。 */
function teamAnchors(n){
  const out=[];
  for(let i=0;i<n;i++){
    const a=Math.PI + i*TAU/n;
    out.push({x:VW/2+Math.cos(a)*VW*0.40, y:VH/2+Math.sin(a)*VH*0.40});
  }
  return out;
}
/* 给定锚点，在它附近找一块「有足够空地」的实际落点。
   ★ 关键：不仅要「站得开」，还必须**落在主连通区里** ——
     地图变密之后，三队以上的均匀角度可能正好落在被建筑围住的口袋里，
     虽然附近有 8 格空地，但那块空地跟其他队伍不连通，
     于是 validateGrid 报「队伍3 到队伍1 之间没有可通行路线」直接拒绝开局
     （实测踩到）。这里把连通性一起纳入筛选。 */
function relaxedAnchor(g, anchor, need){
  if(!g||!g.length) return anchor;
  const reg=mainRegion(g);
  const freeAt=(x,y,r)=>{
    let c=0;
    const t0=Math.max(0,Math.floor((x-r)/TILE)), t1=Math.min(GW-1,Math.ceil((x+r)/TILE));
    const s0=Math.max(0,Math.floor((y-r)/TILE)), s1=Math.min(GH-1,Math.ceil((y+r)/TILE));
    for(let ty=s0;ty<=s1;ty++) for(let tx=t0;tx<=t1;tx++){
      if(!passableForHuman(g,tx,ty)) continue;
      /* 必须在主连通区（reg 为空时退化为只看通行性） */
      if(reg.mask&&!reg.mask[idx(tx,ty)]) continue;
      c++;
    }
    return c;
  };
  const R=TILE*4.5;
  if(freeAt(anchor.x,anchor.y,R)>=need) return anchor;
  let best=null, bd=1e9;
  for(let rad=TILE;rad<=Math.max(VW,VH)*0.55;rad+=TILE){
    for(let k=0;k<20;k++){
      const a=k/20*TAU;
      const x=clamp(anchor.x+Math.cos(a)*rad, TILE, VW-TILE);
      const y=clamp(anchor.y+Math.sin(a)*rad, TILE, VH-TILE);
      if(freeAt(x,y,R)>=need){
        const d=Math.hypot(x-anchor.x,y-anchor.y);
        if(d<bd){ bd=d; best={x:x,y:y}; }
      }
    }
    if(best) break;
  }
  if(best) return best;
  /* 兜底：全图找一个离原锚点最近、且在主连通区内的可通行格 */
  let fb=null, fd=1e9;
  for(let ty=2;ty<GH-2;ty++) for(let tx=2;tx<GW-2;tx++){
    if(!passableForHuman(g,tx,ty)) continue;
    if(reg.mask&&!reg.mask[idx(tx,ty)]) continue;
    const x=cx_of(tx), y=cy_of(ty);
    const d=Math.hypot(x-anchor.x,y-anchor.y);
    if(d<fd){ fd=d; fb={x:x,y:y}; }
  }
  return fb||anchor;
}
/* 预设地图：每种尺寸各有一套布局，按比例生成，保证掩体/窗户/门分布均匀
   ------------------------------------------------------------------
   设计约束（对齐 AI 逻辑，改图时请一并遵守）：
   ① 左右镜像对称：两队出生点分居左右，任何门/窗/掩体都要成对出现，
      否则防守方（人类）与进攻方（僵尸）的收益不对等。
   ② 己方出生区要有「可退空间」：人类被僵尸贴到 PANIC_R(=96px) 会后退，
      退路上必须有掩体与窗口，不能是死胡同。
   ③ 中段要有咽喉与掩体：bestHoldSpot 在「己方→敌方」前 3/4 段找
      掩体多 + 通道窄的点；中段完全空旷会导致 hold 预设找不到守点。
   ④ 门是僵尸瓶颈（要撞开）、人类型可推门而过 → 门要对称且别堵死主通道。
   ⑤ 窗挡人不挡子弹：窗要开在射界上，形成「隔窗对射」的掩体收益。 */
function buildLayout(g,kind){
  gBorder(g);
  const mx=(GW/2)|0, my=(GH/2)|0;
  const S=Math.min(GW/40,GH/22);                     // 相对中地图的缩放
  const P=v=>Math.max(1,Math.round(v*S));
  const W=(x,y,w,h,fill)=>gRect(g,clamp(x,1,GW-2),clamp(y,1,GH-2),w,h,WALL,fill);
  const D=(x,y)=>gSet(g,clamp(x,1,GW-2),clamp(y,1,GH-2),DOOR);
  const N=(x,y)=>gSet(g,clamp(x,1,GW-2),clamp(y,1,GH-2),WIN);
  /* 左右镜像：M(fn) 会把 fn 以 sgn=+1 / -1 各调用一次。
     坐标一律写成「距中轴的偏移」，由 MIR(off,sgn) 换算成真实 x。
     ★ 关键：镜像必须严格满足 x_R === GW-1-x_L（auditMap 就是这么校验的）。
       GW 为偶数时（如 40）不存在整数中轴，四舍五入会左右各偏半格，
       所以先算出左侧列，右侧直接取 GW-1-左侧，保证是真正的镜像对。 */
  const axisX=(GW-1)/2;
  /* 按「距中轴的比例」换算偏移：0=中轴，1=地图边缘。
     这样同一套布局能自动适配小/中/大三种尺寸，
     绝不能写死 40 格地图的绝对格数（否则小地图会被墙塞满）。 */
  const O=frac=>Math.max(1,Math.round(axisX*frac));
  const MIR=(off,sgn)=>{
    const left=Math.round(clamp(axisX-off,1,GW-2));
    const right=GW-1-left;
    if(right<1||right>GW-2) return Math.round(clamp(sgn>0?(axisX+off):(axisX-off),1,GW-2));
    return sgn>0 ? right : left;
  };
  const M=(fn)=>{ fn(1); fn(-1); };
  /* 中轴：GW 为偶数时（40）没有整数中轴列，true axis 在 19.5。
     为了让「中轴上的墙/门」也左右对称，凡是中轴元素都同时写到
     左右两列（axL / axR），而不是只写一列。
     这样 auditMap 的 x ↔ GW-1-x 校验才能全绿。 */
  const axL=Math.floor(axisX), axR=GW-1-axL;
  /* 在中轴两侧对称地放同一个东西 */
  const AX=(setter,fn)=>{ fn(axL); if(axR!==axL) fn(axR); };
  const AxV=(y1,y2,t)=>AX(null,y=>gV(g,y,y1,y2,t));
  const AxH=(x1,x2,y,t)=>AX(null,y2=>gH(g,x1,x2,y,t));
  const AxD=(y)=>AX(null,x=>gSet(g,x,y,DOOR));
  const AxN=(y)=>AX(null,x=>gSet(g,x,y,WIN));
  const AxS=(y,t)=>AX(null,x=>gSet(g,x,y,t));
  /* 镜像矩形的关键：W(x,y,w,h) 总是从 x 向右画 w 列，
     所以左右两份会差 w-1 格、破坏对称。
     MWR 按「外缘对齐」来画：左份占 [xl, xl+w-1]，
     右份占 [GW-1-(xl+w-1), GW-1-xl]，保证严格镜像。 */
  const MWR=(off,y,w,h,sgn,fill)=>{
    const xl=Math.round(clamp(axisX-off-(w-1)/2,1,GW-2-w+1));
    const xr=GW-1-xl-w+1;
    const x=sgn>0?xr:xl;
    W(x,y,w,h,fill);
  };
  /* 镜像横线：同样按外缘对齐，避免跨度造成的不对称 */
  const MHL=(off1,off2,y,sgn,t)=>{
    const l1=Math.round(clamp(axisX-off1,1,GW-2)), l2=Math.round(clamp(axisX-off2,1,GW-2));
    const xl=Math.min(l1,l2), xr=Math.max(l1,l2);
    if(sgn>0) gH(g,GW-1-xr,GW-1-xl,y,t); else gH(g,xl,xr,y,t);
  };

  if(kind==='plaza'){
    /* 空旷广场：中段开阔，但中轴有一道带门廊的隔断作为第一道咽喉，
       两侧各有一组掩体形成侧翼射击位；出生区前留 L 形依托。 */
    for(let dy=-P(8);dy<=P(8);dy++) if(dy!==0) AxD(my+dy);
    AxV(1,my-P(9),WALL); AxV(my+P(9),GH-2,WALL);
    M(sgn=>{
      /* 2×2 掩体：中段侧翼两组 */
      MWR(-O(0.55),my-P(7),2,2,sgn);
      MWR(-O(0.55),my+P(5),2,2,sgn);
      /* 纵向短墙（带窗与门）：侧翼射击位 */
      const x=MIR(-O(0.75),sgn);
      gV(g,x,Math.max(1,my-P(6)),Math.min(GH-2,my+P(6)),WALL);
      N(x,my-P(3)); N(x,my+P(3)); D(x,my);
      /* 出生区前的横向矮墙：防守方的依托（上下各一条，跨度按外缘对齐镜像） */
      MHL(-O(0.95),-O(0.80),Math.max(1,my-P(5)),sgn,WALL);
      MHL(-O(0.95),-O(0.80),Math.min(GH-2,my+P(5)),sgn,WALL);
      N(MIR(-O(0.85),sgn),Math.max(1,my-P(5)));
      N(MIR(-O(0.85),sgn),Math.min(GH-2,my+P(5)));
    });
    return g;
  }
  if(kind==='fortress'){
    /* 走廊堡垒：中轴长墙把场地分成两半，只有 3 道门相通 → 天然咽喉。
       两侧对称布置碉堡与射击窗，人类可隔窗对射、受压迫可缩进去。 */
    for(let y=1;y<=GH-2;y++) AxV(y,y,WALL);
    for(const dy of [-P(7),0,P(7)]) AxD(my+dy);
    for(const dy of [-P(4),P(4)])   AxN(my+dy);
    M(sgn=>{
      /* 上下两个碉堡（墙体 + 正面窗 + 一道门） */
      for(const sy of [-1,1]){
        const by=my+sy*P(6);
        MWR(O(0.65),by,Math.min(5,O(0.24)+1),Math.min(5,P(5)),sgn,false);
        const bx=MIR(O(0.65),sgn);
        /* 朝向中路开门：左半场开在右缘，右半场开在左缘 */
        D(bx+(sgn>0?-2:2),by);
        N(bx+(sgn>0?2:-2),by);                      // 正面射击窗
        N(bx,by+(sy>0?-2:2));                       // 侧向窗
      }
      /* 己方半场的纵向长条窗：稳定射界 */
      for(let dy=-2;dy<=2;dy++) N(MIR(O(0.35),sgn),my+dy);
      /* 出生区前的盾墙（中间留缺口）：可依托节节抵抗 */
      const wx=MIR(O(0.90),sgn);
      gV(g,wx,Math.max(1,my-P(5)),my-2,WALL);
      gV(g,wx,my+2,Math.min(GH-2,my+P(5)),WALL);
      N(wx,my-3); N(wx,my+3);
    });
    return g;
  }
  if(kind==='warehouse'){
    /* 货架仓库：三排横向货架形成多条走廊，中轴一条竖向主通道 +
       每排货架都给门与窗 → 攻守都能利用，僵尸要逐排撞门。
       ★ 所有偏移都按 GW/2 的比例算，不能写死 40 格地图的绝对值，
         否则小地图上货架会横贯全图、墙密度爆表导致开局校验失败。 */
    const rows=[Math.max(2,P(4)),my,Math.min(GH-3,GH-P(4))];
    const half=axisX;                                   // 中轴到边缘的距离
    const oEdge=Math.round(half*0.95);                  // 货架靠边的一端
    const oMid =Math.round(half*0.22);                  // 货架靠中轴的一端
    const oWin =Math.round(half*0.62);
    const oDoor=Math.round(half*0.34);
    const oDoor2=Math.round(half*0.85);
    for(const y of rows){
      M(sgn=>{
        MHL(oEdge,oMid,y,sgn,WALL);    // 一段货架（外缘→近中轴）
        N(MIR(oWin,sgn),y);            // 窗：可隔窗对射
        D(MIR(oDoor,sgn),y);           // 门：僵尸瓶颈
        D(MIR(oDoor2,sgn),y);          // 靠出生区的门，方便人类机动
      });
    }
    /* 中轴竖向通道：留缺口让部队能南北调动 */
    for(let y=1;y<=GH-2;y++){
      if(y===my) continue;
      if(y%3!==0) AxS(y,WALL);
    }
    AxD(Math.max(2,my-P(4))); AxN(my-P(2)); AxD(my+P(3)); AxN(my+P(5));
    M(sgn=>{
      /* 中段与出生区前的小掩体 */
      MWR(oDoor,my-P(3),2,2,sgn);
      MWR(oDoor,my+P(2),2,2,sgn);
      MWR(oDoor2,my-P(4),2,2,sgn);
      MWR(oDoor2,my+P(3),2,2,sgn);
    });
    return g;
  }
  /* city：街区制。左右镜像的楼群，每栋楼都有门有窗，
     楼间留出街道作为射界；出生区一带刻意留出空地，避免被楼群围死
     （曾经的问题：左侧楼群把出生区包成死胡同，bestHoldSpot 找不到守点）。 */
  const bw=Math.max(5,P(6)), bh=Math.max(4,P(4));
  M(sgn=>{
    /* 四栋楼的「左上角距中轴的偏移区间」。
       每栋楼整体放在 [x0, x0+bw-1] 内，右侧楼体取严格镜像，
       楼内门窗一律用「距内侧边缘的偏移」表达，保证左右完全镜像。 */
    const offs=[O(0.15),O(0.65)];                  // 靠中一栋 / 靠边一栋（左侧楼体的左缘偏移）
    const ys=[2, GH-2-bh+1];
    for(const offL of offs) for(const by0 of ys){
      const y=clamp(by0,2,GH-1-bh);
      /* 左侧楼体的左缘（真实坐标） */
      const xl=Math.round(clamp(axisX-offL-(bw-1),1,GW-1-bw));
      const x=sgn>0 ? (GW-1-xl-bw+1) : xl;
      /* 小地图上两栋楼可能重叠：重叠时整体跳过这一栋（左右同时跳，保持对称），
         否则后画的楼会盖掉前一栋的门窗，形成左右不一致。 */
      if(x<2||x+bw-1>GW-3) continue;
      gRect(g,x,y,bw,bh,WALL,false);
      /* 门窗只写「本栋楼自己」的格子，不顺手写镜像那一份 ——
         镜像那一份由 sgn=-1 的那轮负责。以前的写法两边都写，
         在小地图上会互相覆盖（楼挨得近时出现一张图上一侧是窗一侧是墙）。 */
      const inner = sgn>0 ? x : (x+bw-1);
      const ix = k => sgn>0 ? (inner-k) : (inner+k);
      const onWall=(px,py)=>{
        if(px<1||px>GW-2||py<1||py>GH-2) return false;
        /* 必须落在「本栋楼」的矩形范围内：小地图上楼挨得近，
           不校验归属就会把窗开到隔壁楼的墙上，造成左右不一致。 */
        if(px<x||px>x+bw-1||py<y||py>y+bh-1) return false;
        return g[idx(px,py)]===WALL;
      };
      const put=(fn,px,py)=>{ if(onWall(px,py)) fn(px,py); };
      /* 上边与下边各开一道门（bw 小的时候两者同列，只开一次即可） */
      put(D,ix(2),y);
      if(bw-3!==2) put(D,ix(bw-3),y+bh-1);
      /* 侧面开窗：避开与门同列的位置 */
      if(bw-2!==2) put(N,ix(bw-2),y+2);
      if(1!==2) put(N,ix(1),y+bh-2);
      const kMid=Math.floor(bw/2);
      /* 中窗不能与上门/下门同列（小地图 bw=5 时 kMid 恰好等于 2，会覆盖门） */
      if(bw>=7 && kMid!==2 && kMid!==bw-3) put(N,ix(kMid),y+Math.floor(bh/2));
    }
    /* 出生区前的纵向矮墙（中间留缺口）：给人类一个后撤依托，但不封死 */
    const wx=MIR(O(0.90),sgn);
    gV(g,wx,Math.max(1,my-P(4)),my-3,WALL);
    gV(g,wx,my+3,Math.min(GH-2,my+P(4)),WALL);
    N(wx,my-2); N(wx,my+2);
    /* 出生点附近的独立掩体，避免完全裸奔 */
    MWR(O(0.80),my-P(7),2,2,sgn);
    MWR(O(0.80),my+P(5),2,2,sgn);
  });
  /* 中轴的上下通道：形成第三条通路（左右各一，天然对称） */
  M(sgn=>{ D(MIR(O(0.45),sgn),1); N(MIR(O(0.45),sgn),GH-2); });
  return g;
}
/* 大地图额外补几处对称掩体，小地图保持紧凑。
   注意必须左右对称：auditMap 会检查对称性，不对称会让两队收益失衡。
   右侧一律取 GW-1-左侧，绝不用 mx+off（那样会差半格）。 */
function extraCover(g){
  const my=(GH/2)|0, n=GW>=52?3:(GW<=30?1:2);
  const axisX=(GW-1)/2;
  /* 只在「空地上」补掩体：若该处已有墙/窗/门就整块跳过。
     否则覆盖既有结构会破坏左右对称（小地图上尤其明显）。 */
  const canPlace=(x,y)=>{
    if(x<2||y<2||x>GW-3||y>GH-3) return false;
    return g[idx(x,y)]===EMPTY;
  };
  for(let i=0;i<n;i++){
    const off=Math.round(GW*0.16*(i+1));
    const xL=clamp(Math.round(axisX-off),2,GW-3), xR=GW-1-xL;
    const yT=clamp(Math.round(GH*0.30),2,GH-3), yB=clamp(GH-1-yT,2,GH-3);
    const wL=clamp(xL+1,2,GW-3), wR=GW-1-wL;
    /* 左右两侧必须能同时放下，否则两边都不放 —— 保证对称 */
    const okWall=canPlace(xL,yT)&&canPlace(xR,yT)&&canPlace(xL,yB)&&canPlace(xR,yB);
    if(!okWall) continue;
    for(const x of [xL,xR]) for(const yy of [yT,yB]) gSet(g,x,yy,WALL);
    const okWin=canPlace(wL,yT)&&canPlace(wR,yT)&&canPlace(wL,yB)&&canPlace(wR,yB);
    if(okWin) for(const x of [wL,wR]) for(const yy of [yT,yB]) gSet(g,x,yy,WIN);
  }
}
function N_at(g,x,y){ gSet(g,x,y,WIN); }
/* ---------------- 撤离任务专用地图 ----------------
   设计目标（每个都不同，逼玩家用不同打法）：
     corridor  撤离走廊：一条贯穿的主通道，平民在尽头，沿线有掩体
     compound  救援营地：多个房间，平民分散在各屋，需要逐屋搜救
     island    孤岛待援：中央开阔区被墙围住，只有几个门，僵尸从外围压
     blitz     闪电撤离：极短直线距离，几乎没有掩体，纯粹比谁快 */
/* 把撤离区吸附到最近的可站立格。
   ★ 防止「撤离区落在墙里 / 落在封闭死腔」这类硬编码坐标失误：
     只要给一个大致位置，这里保证返回一个一定可到达的坐标。
     （corridor 地图的 y=GH/2 正好是一条长墙，就踩过这个坑。） */
function snapZone(g, x, y){
  const reg=mainRegion(g);
  const tx=(x/TILE)|0, ty=(y/TILE)|0;
  if(inB(tx,ty)&&reg.mask&&reg.mask[idx(tx,ty)]) return {x:cx_of(tx),y:cy_of(ty)};
  let best=null,bd=1e9;
  for(let gy=1;gy<GH-1;gy++) for(let gx=1;gx<GW-1;gx++){
    if(!reg.mask||!reg.mask[idx(gx,gy)]) continue;
    const d=Math.hypot(cx_of(gx)-x,cy_of(gy)-y);
    if(d<bd){ bd=d; best={x:cx_of(gx),y:cy_of(gy)}; }
  }
  return best||{x:cx_of((GW/2)|0),y:cy_of((GH/2)|0)};
}
/* ============================================================================
   撤离地图：整体迷宫型生成器
   ============================================================================
   用户要求：「撤离模式更多应该是整体为迷宫类型的」。

   迷宫设计要点（不是随便凿洞，而是「能打的迷宫」）：
     ① 递归回溯迷宫 —— 保证全图连通，有明确的探索感
     ② 环路（braid）—— 随机拆掉一些墙制造回路。纯迷宫死胡同太多，
        救援队会被困死；加回路后「走错也能绕回来」，更像真实城区
     ③ 房间 —— 大小随机的房间作为「平民藏身处」与「据点」，是迷宫里的地标
     ④ 主通道 —— 1~3 条横贯/纵贯的宽路，作为救援主推进轴与僵尸涌入方向
     ⑤ 保留部分死胡同 —— 迷宫感与伏击点的来源
   ========================================================================== */

/* 递归回溯迷宫：奇数格为通路、偶数格为墙的经典表示 */
function carveMaze(g, rnd2, braid){
  for(let y=1;y<GH-1;y++) for(let x=1;x<GW-1;x++) gSet(g,x,y,WALL);
  const visited=new Uint8Array(GW*GH);
  const start={x:1+2*Math.floor(rnd2()*Math.max(1,Math.floor((GW-2)/2))),
               y:1+2*Math.floor(rnd2()*Math.max(1,Math.floor((GH-2)/2)))};
  const stack=[start];
  visited[idx(start.x,start.y)]=1;
  gSet(g,start.x,start.y,EMPTY);
  const DIRS=[[0,-2],[0,2],[-2,0],[2,0]];
  let guard=0;
  while(stack.length&&guard++<GW*GH*4){
    const c=stack[stack.length-1];
    const cand=[];
    for(const d of DIRS){
      const nx=c.x+d[0], ny=c.y+d[1];
      if(nx<1||nx>=GW-1||ny<1||ny>=GH-1) continue;
      if(visited[idx(nx,ny)]) continue;
      cand.push({x:nx,y:ny,dx:d[0],dy:d[1]});
    }
    if(!cand.length){ stack.pop(); continue; }
    const pick=cand[Math.floor(rnd2()*cand.length)];
    gSet(g,c.x+pick.dx/2, c.y+pick.dy/2, EMPTY);
    gSet(g,pick.x, pick.y, EMPTY);
    visited[idx(pick.x,pick.y)]=1;
    stack.push({x:pick.x,y:pick.y});
  }
  /* 环路：只拆「两侧都是通路」的墙，避免把关卡凿成空地 */
  const loops=Math.round(GW*GH*braid);
  for(let i=0;i<loops;i++){
    const x=2+Math.floor(rnd2()*(GW-4));
    const y=2+Math.floor(rnd2()*(GH-4));
    if(!inB(x,y)||g[idx(x,y)]!==WALL) continue;
    const h=(g[idx(x-1,y)]===EMPTY&&g[idx(x+1,y)]===EMPTY&&
             g[idx(x,y-1)]===WALL&&g[idx(x,y+1)]===WALL);
    const v=(g[idx(x,y-1)]===EMPTY&&g[idx(x,y+1)]===EMPTY&&
             g[idx(x-1,y)]===WALL&&g[idx(x+1,y)]===WALL);
    if(h||v) gSet(g,x,y,EMPTY);
  }
}
/* 在迷宫里挖房间：房间是地标，也是平民藏身处与防守据点 */
function carveRooms(g, rnd2, count){
  const rooms=[];
  for(let k=0;k<count;k++){
    const w=3+Math.floor(rnd2()*4), h=3+Math.floor(rnd2()*3);
    const x0=clamp(2+Math.floor(rnd2()*(GW-w-4)),2,Math.max(2,GW-w-3));
    const y0=clamp(2+Math.floor(rnd2()*(GH-h-4)),2,Math.max(2,GH-h-3));
    const x1=Math.min(x0+w,GW-2), y1=Math.min(y0+h,GH-2);
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) gSet(g,x,y,EMPTY);
    rooms.push({x0:x0,y0:y0,x1:x1-1,y1:y1-1});
    /* 至少 2 个出口，让房间融入迷宫而不是死盒子 */
    let doors=0;
    for(let t=0;t<30&&doors<2;t++){
      const side=Math.floor(rnd2()*4);
      let px,py;
      if(side===0){ px=x0+Math.floor(rnd2()*(x1-x0)); py=y0; }
      else if(side===1){ px=x0+Math.floor(rnd2()*(x1-x0)); py=y1-1; }
      else if(side===2){ px=x0; py=y0+Math.floor(rnd2()*(y1-y0)); }
      else { px=x1-1; py=y0+Math.floor(rnd2()*(y1-y0)); }
      if(px<2||px>=GW-2||py<2||py>=GH-2) continue;
      if(g[idx(px,py)]!==WALL) continue;
      gSet(g,px,py, rnd2()<0.75?DOOR:WIN);
      doors++;
    }
  }
  return rooms;
}
/* 主通道：横贯/纵贯的宽路，作为主推进轴 */
function carveBoulevards(g, rnd2, nH, nV){
  for(let i=0;i<nH;i++){
    const y=clamp(3+Math.floor(rnd2()*(GH-6)),3,GH-4);
    for(let x=1;x<GW-1;x++){
      gSet(g,x,y,EMPTY);
      if(rnd2()<0.5&&y+1<GH-2) gSet(g,x,y+1,EMPTY);
    }
  }
  for(let i=0;i<nV;i++){
    const x=clamp(3+Math.floor(rnd2()*(GW-6)),3,GW-4);
    for(let y=1;y<GH-1;y++){
      gSet(g,x,y,EMPTY);
      if(rnd2()<0.5&&x+1<GW-2) gSet(g,x+1,y,EMPTY);
    }
  }
}
function buildMazeMissionMap(kind){
  const conf={
    corridor:{seed:31001, braid:0.055, rooms:9,  bh:2, bv:2},
    compound:{seed:31002, braid:0.035, rooms:14, bh:1, bv:1},
    island:  {seed:31003, braid:0.020, rooms:7,  bh:1, bv:1},
    blitz:   {seed:31004, braid:0.090, rooms:6,  bh:3, bv:3},
  }[kind]||{seed:31999,braid:0.05,rooms:9,bh:2,bv:2};
  const rnd2=seededRng(conf.seed);
  const g=newGrid();
  gBorder(g);
  carveMaze(g,rnd2,conf.braid);
  carveBoulevards(g,rnd2,conf.bh,conf.bv);
  const rooms=carveRooms(g,rnd2,conf.rooms);
  /* 撤离集结点：左边缘清出一块空地 */
  const zy=(GH/2)|0;
  for(let y=zy-2;y<=zy+2;y++) for(let x=1;x<=4;x++){
    if(inB(x,y)) gSet(g,x,y,EMPTY);
  }
  for(let x=5;x<GW-2;x++){ if(inB(x,zy)&&g[idx(x,zy)]===WALL) gSet(g,x,zy,DOOR); }
  g._maze=true; g._rooms=rooms; g._conf=conf;
  return {grid:g, zone:snapZone(g,cx_of(3),cy_of(zy)), entry:{x:cx_of(3),y:cy_of(zy)}};
}

function buildMissionMap(kind){
  /* ★ 撤离地图全面改为**迷宫型**。
     原来的四张城市图（城市街区 / 市中心 / 老城迷巷 / 近郊平房）
     已移交到常规模式（见 PRESETS 的 mission1~4），不再是撤离专用图 ——
     用户要求「撤离应该是整体迷宫类型的」。 */
  const built=buildMazeMissionMap(kind);
  return {grid:built.grid, zone:built.zone, entry:built.entry};
}
const MISSION_MAPS={
  corridor:{name:'地下管网', style:'maze', desc:'管道纵横、环路少，最容易迷路'},
  compound:{name:'废弃医院', style:'maze', desc:'房间最多，走廊狭窄，逐屋搜索'},
  island:  {name:'老城迷巷', style:'maze', desc:'死胡同极多，几乎没有环路'},
  blitz:   {name:'断壁残垣', style:'maze', desc:'通路多、掩体少，考验快速穿行'},
};

/* ---------------- 城市迷宫生成器（真实城市救援的地图） ----------------
   设计目标（用户要求「更大、更像迷宫、像真实城市救援」）：
     · **街道网**：纵横主干道把地图切成街区，街道是主要的机动通道
     · **建筑群**：每个街区里盖楼，楼内有**房间隔墙 + 门**，可以逐屋搜索
     · **死巷与阻断**：部分街道被瓦砾堵死、部分小路是死胡同 —— 制造迷宫感
     · **巷子**：楼与楼之间有窄巷连通，形成绕行路线
     · **入口/撤离区在左侧**，僵尸从右侧涌入，平民藏在城里各处
   用确定性随机（种子）保证同一张图每次一致，便于测试与平衡。 */
function seededRng(seed){
  let a=seed>>>0;
  return function(){
    a|=0; a=a+0x6D2B79F5|0;
    let t=Math.imul(a^a>>>15,1|a);
    t=t+Math.imul(t^t>>>7,61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
/* ============================================================================
   城市地图生成器 v2 —— 去掉「田字格」
   ============================================================================
   旧版问题（用户反馈「道路设计全是田字格」「同质化严重」）：
   它用固定 gapX/gapY 铺满横竖街道，于是每张图都是规整的棋盘格，
   街区大小完全一致，没有任何一座真实城市的样子。

   参考真实俯视角战争游戏（如《这是我的战争》《僵尸毁灭工程》
   《Company of Heroes》的城市图）的共性做法：

     ① 主干道（Arterial）—— 少量贯穿全图的宽路，方向各异，构成骨架
     ② 次级路（Collector）—— 从主干道分叉，**长度与角度随机**，不打满全图
     ③ 街区（Block）—— 由道路自然围合，**大小不一**（含少量超大/超小地块）
     ④ 建筑（Building）—— 沿街布置、朝向随机；有独栋、有联排、有空地
     ⑤ 街区内部小路（Alley）—— 建筑之间留出窄巷，供步行穿插
     ⑥ 死巷与断头路 —— 真实城市都有，制造局部攻防焦点

   关键是**不再用等间距网格**：道路起点、长度、走向都由种子随机决定，
   再用「拓宽已有道路」代替「新开一条笔直的路」，天然形成不规则街区。
   ========================================================================== */

/* 从某点沿某方向「修路」。dirX/dirY 必须是单位轴向（只能一个非 0）。
   width 是**垂直于走向**的宽度。
   straight=true 时不允许转向（主干道必须贯穿全图，否则会走偏、
   导致大片区域没有路、建筑也长不出来 —— 实测下半张图全空就是这个原因）。 */
function carveRoad(g, isRoad, x, y, dirX, dirY, len, width, rnd2, straight){
  let cx=x, cy=y, dx=dirX, dy=dirY;
  for(let i=0;i<len;i++){
    /* 支路每走几格允许 90° 转向（模拟真实道路的折线）；主干道不转 */
    if(!straight&&i>0&&i%6===0&&rnd2()<0.28){
      if(dx!==0){ dx=0; dy=(rnd2()<0.5)?1:-1; }
      else { dy=0; dx=(rnd2()<0.5)?1:-1; }
    }
    const nx=cx+dx, ny=cy+dy;
    if(nx<2||nx>=GW-2||ny<2||ny>=GH-2) break;
    for(let w=0;w<width;w++){
      const px = (dx!==0) ? nx : nx+w;
      const py = (dx!==0) ? ny+w : ny;
      if(inB(px,py)){ gSet(g,px,py,EMPTY); isRoad[idx(px,py)]=1; }
    }
    cx=nx; cy=ny;
  }
  return {x:cx,y:cy,dx:dx,dy:dy};
}
/* 在建筑之间开一条窄巷（1 格宽，随机走，用于连通街区内部） */
function carveAlley(g, isRoad, x, y, len, rnd2){
  let cx=x, cy=y;
  for(let i=0;i<len;i++){
    const r=rnd2();
    if(r<0.35) cx++; else if(r<0.7) cy++; else cx--;
    if(cx<2||cx>=GW-2||cy<2||cy>=GH-2) break;
    gSet(g,cx,cy,EMPTY); isRoad[idx(cx,cy)]=1;
  }
}

/* ⚠️ 这是**上一代**的城市生成器，已被下方的 buildCityMap（v3）取代。
   改名保留只是为了不破坏可能存在的旧引用；
   真正的生成逻辑见文件后部的 buildCityMap(style, seed)。
   ★ 教训：两个同名函数，后定义的会静默覆盖先定义的 ——
     这次就是这样，新生成器写好了却完全没生效。 */
function buildCityMapV2Legacy(variant,seed){
  const rnd2=seededRng(seed||12345);
  const g=newGrid();
  gBorder(g);
  const V=variant||'block';
  /* 街区密度。
     ★ 关键教训：上一版 arterials 太少（2~3 条），而建筑循环会把
       「所有非路面格」都盖成墙 —— 结果整张图变成一大团实心墙，
       既没有街道也没有可走区域（实测行 15~37 几乎全 #）。
       现在按地图尺寸给出足够密的路网：横向 4~6 条主干道 + 纵向 5~8 条，
       再叠 12~20 条次级路，确保建筑之间始终有街道分隔。 */
  const sc=Math.max(0.6, Math.min(1.6, (GW*GH)/(40*22)));
  const cfg={
    block:    {arterials:4, collectors:9,  buildDensity:0.62, alley:5, lots:0.16},
    downtown: {arterials:5, collectors:12, buildDensity:0.74, alley:7, lots:0.08},
    maze:     {arterials:6, collectors:16, buildDensity:0.80, alley:11, lots:0.05},
  }[V]||{arterials:4,collectors:9,buildDensity:0.62,alley:5,lots:0.16};
  cfg.arterials=Math.max(3,Math.round(cfg.arterials*sc));
  cfg.collectors=Math.max(6,Math.round(cfg.collectors*sc));
  cfg.alley=Math.max(4,Math.round(cfg.alley*sc));

  const isRoad=new Uint8Array(GW*GH);

  /* ① 主干道：横竖各若干条，**位置在各自分段内随机**（不是等距网格）。
        它们贯穿全图，保证任意位置都能走通。宽度 3 格。 */
  const arts=[];
  const nH=Math.ceil(cfg.arterials/2);      // 横向
  const nV=cfg.arterials-nH;                // 纵向
  for(let i=0;i<nH;i++){
    const seg=Math.floor((GH-6)/nH);
    const pos=3+i*seg+Math.floor(rnd2()*Math.max(2,seg-3));
    const r=carveRoad(g,isRoad,2,clamp(pos,3,GH-4),1,0,GW-4,3,rnd2,true);
    arts.push(r);
  }
  for(let i=0;i<nV;i++){
    const seg=Math.floor((GW-8)/nV);
    const pos=4+i*seg+Math.floor(rnd2()*Math.max(2,seg-3));
    const r=carveRoad(g,isRoad,clamp(pos,4,GW-5),2,0,1,GH-4,3,rnd2,true);
    arts.push(r);
  }
  /* ② 次级路：从主干道分叉出去，**长度随机、不打满全图** */
  for(let i=0;i<cfg.collectors;i++){
    const a=arts[i%arts.length];
    const vertical=(a.dx!==0);                 // 主干道是横向 → 支路竖着分叉
    const len=4+Math.floor(rnd2()*((vertical?GH:GW)*0.5));
    let sx, sy;
    if(vertical){
      sx=a.x; sy=clamp(3+Math.floor(rnd2()*(GH-6)),3,GH-4);
    } else {
      sx=clamp(3+Math.floor(rnd2()*(GW-6)),3,GW-4); sy=a.y;
    }
    const r=carveRoad(g,isRoad,sx,sy, vertical?0:1, vertical?1:0, len, 2, rnd2);
    /* 死巷：约 1/3 的支路走到头就封死（真实城市里的断头路） */
    if(rnd2()<0.33){
      const bx=r.x+(r.dx||0), by=r.y+(r.dy||0);
      if(inB(bx,by)&&!isRoad[idx(bx,by)]) gSet(g,bx,by,WALL);
    }
  }
  /* ③ 建筑：在**非道路**的空地上按「沿街」原则布置，
        大小随机（1×1 到 4×3），朝向随机，留出空地 */
  for(let y=2;y<GH-2;y++){
    for(let x=2;x<GW-2;x++){
      if(isRoad[idx(x,y)]) continue;
      if(g[idx(x,y)]!==EMPTY) continue;
      if(rnd2()>cfg.buildDensity) continue;
      /* 建筑面积随机；且必须有至少一边贴着道路（沿街） */
      const bw=1+Math.floor(rnd2()*3), bh=1+Math.floor(rnd2()*2.5);
      const x2=Math.min(x+bw,GW-2), y2=Math.min(y+bh,GH-2);
      let touchesRoad=false;
      for(let j=y-1;j<=y2&&!touchesRoad;j++) for(let i=x-1;i<=x2;i++){
        if(inB(i,j)&&isRoad[idx(i,j)]){ touchesRoad=true; break; }
      }
      if(!touchesRoad) continue;
      /* 铺墙 + 挖内部空间 */
      for(let j=y;j<y2;j++) for(let i=x;i<x2;i++) gSet(g,i,j,WALL);
      if((x2-x)>=2&&(y2-y)>=2){
        for(let j=y+1;j<y2-1;j++) for(let i=x+1;i<x2-1;i++) gSet(g,i,j,EMPTY);
        /* 门开向街道那一侧 */
        if(rnd2()<0.85){
          const side=Math.floor(rnd2()*4);
          const dx=[1,-1,0,0][side], dy=[0,0,1,-1][side];
          const mx=(x+x2-1)>>1, my=(y+y2-1)>>1;
          const px=dx!==0?(dx>0?x2-1:x):mx;
          const py=dy!==0?(dy>0?y2-1:y):my;
          gSet(g,px,py,DOOR);
          /* 再补一扇窗做半掩体 */
          const wx=dx!==0?(dx>0?x2-1:x):mx;
          const wy=dy!==0?(dy>0?y2-1:y):my;
          if(rnd2()<0.6){
            const ox=(rnd2()<0.5)?1:0;
            if(inB(wx+ox,wy+ox)) gSet(g,wx+ox,wy+ox,WIN);
          }
        }
      }
      /* 跳过大楼占用的区域 */
      for(let j=y;j<y2;j++) for(let i=x;i<x2;i++) isRoad[idx(i,j)]=-1;
    }
  }
  /* ④ 空地/停车场：少量留白，撒一点矮掩体 */
  const lots=Math.round(GW*GH*0.002*(cfg.lots/0.14));
  for(let i=0;i<lots;i++){
    const x=3+Math.floor(rnd2()*(GW-6)), y=3+Math.floor(rnd2()*(GH-6));
    if(isRoad[idx(x,y)]!==0&&g[idx(x,y)]!==EMPTY) continue;
    const n=1+Math.floor(rnd2()*3);
    for(let k=0;k<n;k++){
      const px=x+Math.floor(rnd2()*3)-1, py=y+Math.floor(rnd2()*3)-1;
      if(inB(px,py)&&!isRoad[idx(px,py)]&&g[idx(px,py)]===EMPTY) gSet(g,px,py,WALL);
    }
  }
  /* ⑤ 街区内部小巷：把被建筑围住的死区打通 */
  let alleys=0;
  for(let t=0;t<cfg.alley*8 && alleys<cfg.alley*3;t++){
    const x=3+Math.floor(rnd2()*(GW-6)), y=3+Math.floor(rnd2()*(GH-6));
    if(g[idx(x,y)]!==WALL) continue;
    carveAlley(g,isRoad,x,y,6+Math.floor(rnd2()*8),rnd2);
    alleys++;
  }
  /* ⑥ 出口清空：左右两侧留出双方展开区 */
  for(const side of [0,1]){
    const x0=side===0?1:GW-8;
    for(let y=2;y<GH-2;y++) for(let x=x0;x<x0+7;x++){
      if(inB(x,y)){ gSet(g,x,y,EMPTY); isRoad[idx(x,y)]=1; }
    }
  }
  /* ⑥b ★ 保证最小开口密度。
     小地图（28×16）上建筑又小又薄，「沿街那面」经常算不出几格，
     于是整张图可能只有 1 个门（实测 mission1/small 就是），
     房间全成了进不去的实心块 —— 战术性完全丧失。
     这里做一个**补足**：统计当前门窗数量，不足就沿「建筑外墙」
     补到目标值。目标按面积定：每 100 格至少 2 门 4 窗。 */
  {
    let nDoor=0, nWin=0;
    for(let i=0;i<g.length;i++){ if(g[i]===DOOR) nDoor++; else if(g[i]===WIN) nWin++; }
    const wantDoor=Math.max(6,Math.round(GW*GH/100*2));
    const wantWin =Math.max(8,Math.round(GW*GH/100*4));
    /* 收集「贴着道路的墙格」作为候选（优先朝街，最自然） */
    const candDoor=[], candWin=[];
    for(let y=2;y<GH-2;y++){
      for(let x=2;x<GW-2;x++){
        if(g[idx(x,y)]!==WALL) continue;
        let onRoad=false;
        for(const d of [[1,0],[-1,0],[0,1],[0,-1]]){
          const nx=x+d[0], ny=y+d[1];
          if(inB(nx,ny)&&isRoad[idx(nx,ny)]===1){ onRoad=true; break; }
        }
        if(!onRoad) continue;
        /* 判断这个墙格是不是「建筑的边界」（另一侧是空地/墙内） */
        const nb=[[1,0],[-1,0],[0,1],[0,-1]];
        let solidN=0;
        for(const d of nb) if(inB(x+d[0],y+d[1])&&g[idx(x+d[0],y+d[1])]!==EMPTY) solidN++;
        candDoor.push({x:x,y:y,solid:solidN});
        candWin.push({x:x,y:y,solid:solidN});
      }
    }
    /* 打散顺序，避免补出来的开口排成一排 */
    for(let i=candDoor.length-1;i>0;i--){
      const j=Math.floor(rnd2()*(i+1)); const t=candDoor[i]; candDoor[i]=candDoor[j]; candDoor[j]=t;
    }
    for(let i=candWin.length-1;i>0;i--){
      const j=Math.floor(rnd2()*(i+1)); const t=candWin[i]; candWin[i]=candWin[j]; candWin[j]=t;
    }
    for(const c of candDoor){
      if(nDoor>=wantDoor) break;
      if(g[idx(c.x,c.y)]!==WALL) continue;
      gSet(g,c.x,c.y,DOOR); nDoor++;
    }
    for(const c of candWin){
      if(nWin>=wantWin) break;
      if(g[idx(c.x,c.y)]!==WALL) continue;
      gSet(g,c.x,c.y,WIN); nWin++;
    }
  }
  /* ⑦ ★ 打开「封闭天井」：
     建筑群有时会围出一块走不进去的空地（实测 22~103 格）。
     这些区域单位进不去、平民可能被生成在里面，必须打通。
     两级策略：
       ① 空腔**贴着主区** → 在边界上放一扇门（最自然，像建筑开口）
       ② 空腔**被墙包住**（②找不到）→ 朝主区方向凿一条巷道出来
     只做 ① 是不够的：实测 huge 尺寸下仍会剩 11~25 格打不通，
     因为有些空腔四面都是建筑内部的墙，边上根本没有「空地邻居」。 */
  let guard=0;
  while(guard++<120){
    const reg=mainRegion(g);
    if(!reg.mask||reg.sealed<=0) break;
    let fixed=false;
    /* ① 边界开门 */
    for(let y=3;y<GH-3&&!fixed;y++){
      for(let x=3;x<GW-3&&!fixed;x++){
        const i=idx(x,y);
        if(reg.mask[i]) continue;
        if(g[i]!==EMPTY) continue;
        const nb=[[1,0],[-1,0],[0,1],[0,-1]];
        for(const d of nb){
          if(reg.mask[idx(x+d[0],y+d[1])]){ gSet(g,x,y,DOOR); fixed=true; break; }
        }
      }
    }
    /* ② 找不到贴边的空腔 → 从任一个封闭空腔朝主区方向凿墙 */
    if(!fixed){
      outer:
      for(let y=3;y<GH-3;y++){
        for(let x=3;x<GW-3;x++){
          const i=idx(x,y);
          if(reg.mask[i]||g[i]!==EMPTY) continue;
          /* 从这个空腔出发，朝四个方向找主区，把路上的墙敲成一个门 */
          for(const d of [[1,0],[-1,0],[0,1],[0,-1]]){
            let cx=x, cy=y;
            for(let step=1;step<=4;step++){
              cx+=d[0]; cy+=d[1];
              if(!inB(cx,cy)||cx<2||cx>=GW-2||cy<2||cy>=GH-2) break;
              const ci=idx(cx,cy);
              if(reg.mask[ci]){                 // 撞到主区了：把起点那格开成门
                gSet(g,x,y,DOOR); fixed=true; break;
              }
              if(g[ci]!==WALL) break;           // 路上遇到非墙就放弃这个方向
            }
            if(fixed) break;
          }
          if(fixed) break outer;
        }
      }
    }
    /* ③ 还是不行：随便找块封闭空地凿一条小巷（最终兜底） */
    if(!fixed){
      for(let y=3;y<GH-3&&!fixed;y++){
        for(let x=3;x<GW-3&&!fixed;x++){
          const i=idx(x,y);
          if(reg.mask[i]||g[i]!==EMPTY) continue;
          carveAlley(g,isRoad,x,y,10,rnd2);
          fixed=true;
        }
      }
      if(!fixed) break;
    }
  }
  g._streets=isRoad;
  return g;
}
/* 旧的网格版生成器保留但不再使用（改名避免误调用） */
function buildCityMapGridLegacy(variant,seed){
  const rnd2=seededRng(seed||12345);
  const g=newGrid();
  gBorder(g);
  const V=variant||'block';
  const gapX = V==='maze' ? 7 : (V==='downtown' ? 9 : 11);
  const gapY = V==='maze' ? 5 : (V==='downtown' ? 7 : 8);
  const sw = V==='maze' ? 1 : 2;
  const isStreet=new Uint8Array(GW*GH);
  for(let y=3;y<GH-3;y+=gapY){
    for(let h=0;h<sw;h++){
      const yy=y+h; if(yy>=GH-3) break;
      for(let x=2;x<GW-2;x++) isStreet[idx(x,yy)]=1;
    }
  }
  for(let x=4;x<GW-3;x+=gapX){
    for(let w=0;w<sw;w++){
      const xx=x+w; if(xx>=GW-3) break;
      for(let y=2;y<GH-2;y++) isStreet[idx(xx,y)]=1;
    }
  }
  const xs=[],ys=[];
  for(let x=4;x<GW-3;x+=gapX) xs.push(x);
  for(let y=3;y<GH-3;y+=gapY) ys.push(y);
  for(let i=0;i<xs.length;i++){
    for(let j=0;j<ys.length;j++){
      const bx=xs[i]+sw, by=ys[j]+sw;
      const bw=gapX-sw, bh=gapY-sw;
      if(bw<3||bh<3) continue;
      if(bx+bw>=GW-2||by+bh>=GH-2) continue;
      const roll=rnd2();
      if(roll<0.18){
        for(let k=0;k<2;k++){
          const px=bx+((rnd2()*(bw-2))|0), py=by+((rnd2()*(bh-2))|0);
          if(inB(px,py)&&!isStreet[idx(px,py)]) gSet(g,px,py,WALL);
        }
        continue;
      }
      for(let y=by;y<by+bh;y++) for(let x=bx;x<bx+bw;x++) gSet(g,x,y,WALL);
      /* 内部分隔：竖一道或横一道，形成 2~4 个房间 */
      const splitV = bw>=5 && rnd2()<0.6;
      const rooms=[];
      if(splitV){
        const mx2=bx+1+((rnd2()*(bw-2))|0);
        for(let y=by+1;y<by+bh-1;y++) gSet(g,mx2,y,WALL);
        rooms.push({x0:bx+1,y0:by+1,x1:mx2-1,y1:by+bh-2});
        rooms.push({x0:mx2+1,y0:by+1,x1:bx+bw-2,y1:by+bh-2});
        /* 房间之间的连通门 */
        if(bh>3){
          const dy=by+1+((rnd2()*(bh-2))|0);
          gSet(g,mx2,dy,DOOR);
        }
      }
      if(bh>=5&&rnd2()<0.6){
        const my2=by+1+((rnd2()*(bh-2))|0);
        for(let x=bx+1;x<bx+bw-1;x++) gSet(g,my2,x,WALL);
        if(bw>3){
          const dx=bx+1+((rnd2()*(bw-2))|0);
          gSet(g,dx,my2,DOOR);
        }
        if(!splitV) rooms.push({x0:bx+1,y0:by+1,x1:bx+bw-2,y1:by+bh-2});
      }
      if(!rooms.length) rooms.push({x0:bx+1,y0:by+1,x1:bx+bw-2,y1:by+bh-2});
      /* 楼门开向街道：四周找一个贴街的位置开门，再补一扇窗 */
      const outs=[];
      for(let x=bx;x<bx+bw;x++){ if(isStreet[idx(x,by-1)]) outs.push([x,by]); if(isStreet[idx(x,by+bh)]) outs.push([x,by+bh-1]); }
      for(let y=by;y<by+bh;y++){ if(isStreet[idx(bx-1,y)]) outs.push([bx,y]); if(isStreet[idx(bx+bw,y)]) outs.push([bx+bw-1,y]); }
      if(outs.length){
        const pick=outs[(rnd2()*outs.length)|0];
        gSet(g,pick[0],pick[1],DOOR);
        if(outs.length>1){
          const p2=outs[(rnd2()*outs.length)|0];
          if(p2[0]!==pick[0]||p2[1]!==pick[1]) gSet(g,p2[0],p2[1],WIN);
        }
      }
      g._rooms=g._rooms||[];
      for(const r of rooms) g._rooms.push(r);
    }
  }
  /* 3) 制造迷宫感：把一部分街道用瓦砾堵成死巷（保留主通道） */
  const blocked=[];
  for(let k=0;k<Math.round((GW*GH)/260);k++){
    const x=2+((rnd2()*(GW-4))|0), y=2+((rnd2()*(GH-4))|0);
    if(!isStreet[idx(x,y)]) continue;
    /* 别堵左边缘：那是救援队的入口/撤离区 */
    if(x<8) continue;
    gSet(g,x,y,WALL);
    blocked.push(idx(x,y));
  }
  g._streets=isStreet;
  return g;
}

/* ============================================================================
   关卡设计驱动的地图生成器 v2 —— 从「空旷场地」到「城市街区」
   ============================================================================
   用户反馈：「地图太空旷了，要有道路设计等等」。

   量化诊断（改造前）：
     预置地图  墙 18~22%　空地 77~82%   ← 大片空白，只有零星掩体
     撤离地图  墙 31~35%　空地 60~65%
     真实俯视角城市图（Project Zomboid / Company of Heroes）
               墙 40~55%　道路+空地 45~60%
   差别的关键不是「墙多不多」，而是**空地是不是道路**：
   真实城市里空地几乎都是「街道 + 人行道 + 小巷」，
   而旧图里空的是「什么都没有的广场」。

   新做法（关键思路反转）：
     旧：先铺几条路 → 往空地上撒掩体        → 结果是大片空白
     新：先铺**路网**（道路本身就是设计好的）→ 再把「街区」填满建筑
         街区 = 被路网围出来的地块，建筑沿街排布、占满地块，
         只留出「院子 / 巷道 / 小广场」这些有功能的空间。

   路网层次（参考真实城市）：
     ① 主干道（宽 3）—— 贯穿全图，构成骨架，位置随机非等距
     ② 次干道（宽 2）—— 把主干道之间的长条切成街区
     ③ 支路 / 巷道（宽 1）—— 街区内部的步行通道，制造近距离交战
     ④ 环路 —— 少数主干道互联，形成「绕行」路线（避免一条路堵死）

   街区填充：
     每个地块按「沿街」原则排建筑：贴街那一侧立墙 + 开窗（半掩体），
     建筑内部挖空成房间（可进可守），建筑之间留巷道。
   ========================================================================== */

/* 把整张图按「路网 + 街区」铺满。
   返回 isRoad（1=道路，0=未铺，-1=已是建筑）便于后续判断。 */
/* ============================================================================
   城市地图生成器 v3 —— 可读的道路骨架 + 明确的交战逻辑
   ============================================================================
   用户反馈：「太随机化了，没有明确的道路指引和交战逻辑倾向」。

   诊断（实测四张图的指标几乎完全相同）：
     open  / balanced / urban / fort 的连通区 552/564/564/588、
     掩体比 0.40/0.40/0.41/0.37、最长视线**全是 38** ——
     说明它们本质是同一张图换了随机种子，风格参数没起作用。

   根因是设计思路反了：
     旧版：先撒墙 → 剩下的地方算「路」 → 结果是一堆噪声，看不出路在哪
     新版：先画路 → 路围出来的街区再填建筑 → 路是明确可读的骨架

   这与真实城市、以及成熟俯视角游戏（Project Zomboid / Hotline Miami /
   Door Kickers）的共同点一致：**一眼就能看出街道在哪、往哪走**。

   三条硬规则：
     ① 道路必须**连续笔直** —— 从地图一边直通另一边，不拐弯。
        拐弯的路看起来就是噪声；笔直的路才是「指引」。
     ② 街区大小**天然不等** —— 路的位置不等距，所以地块有大有小。
        等距 = 田字格；不等距 = 真实城市。
     ③ 建筑填满地块，但**朝街开门开窗** —— 这决定「从哪进屋、在哪防守」。

   交战逻辑由风格参数决定（见 CITY_STYLE）：
     open     少路网 + 宽路 + 干净路面 → 长视线，远程/狙击占优
     balanced 标准路网 + 适中宽度     → 远近混合
     urban    密路网 + 窄路 + 路面瓦砾 → 短视线，近战/霰弹占优
     fort     标准路网 + 中央大据点    → 交战集中在中心
   ========================================================================== */
/* ============================================================================
   地图生成器 v4 —— 按参考游戏实测数据重做
   ============================================================================
   数据来源：逐帧解码 UP 主「这球有问题」的 11 集（88 帧，300×660），
   统计战场区域的「非地面像素」占比：

     EP03 6.5%   EP04 5.2%   EP07 8.5%   EP08 5.6%   EP10 8.4%
     EP11 7.3%   EP17 8.1%   EP18 5.6%   EP20 6.0%   EP23 11.6%  EP24 8.6%

   → **掩体只占 5~12%，地面占 88~95%**。

   对比我之前做的地图：墙占 33~42%，是参考值的 4~7 倍。
   这就是「太随机、没有交战逻辑」的根本原因 ——
   地图被建筑填死了，双方隔着一堆墙互相看不见，
   AI 找不到目标就原地不动（实测 12 人 420 秒 X 坐标没变过）。

   所以核心改动是**做减法**：
     ① 地面要占 85% 以上 —— 这是交火能发生的前提
     ② 掩体是**成块的柱子/矮墙**，不是连片的建筑
     ③ 掩体要**分散**在战场各处，制造「推进—找掩体—再推进」的节奏
     ④ 中间留出大块空地作为主战场（参考图里中间几乎全是空的）

   风格差异靠「掩体形态 + 密度」做，不再靠「建筑覆盖率」：
     open      6%   极稀疏的柱子，几乎纯开阔 → 远程压制
     balanced  10%  中等的块状掩体，均匀散布 → 标准攻防
     urban     16%  密集的矮墙长廊 → 近身缠斗
     fort      12%  中央大据点 + 四周开阔 → 争夺中心
   ========================================================================== */

const MAP_STYLE = {
  /* coverPct : 掩体占地图面积的目标比例（按参考数据定）
     minGap   : 掩体之间至少隔几格（防止连成片把地图堵死）
     shape    : 掩体形态 'pillar'（柱）/ 'wall'（矮墙）
     plaza    : 中央是否留大空地
     roomChance : 掩体里做成「可进入的小房间」的概率
                  （房间是少数派 —— 参考图里绝大多数掩体是柱子/矮墙）
     winBias  : 掩体做成「窗」的概率（窗可透视，不切断视野）。
                掩体越稀疏的风格，窗比例越高 —— 否则整张图只剩几堵实心墙，
                既没有可透视掩体，随机生成也会因「开口不足」被判不合格。 */
  open:     { coverPct: 0.07, minGap: 5, shape: 'pillar', plaza: false, roomChance: 0.05, winBias: 0.85 },
  balanced: { coverPct: 0.11, minGap: 3, shape: 'wall',   plaza: false, roomChance: 0.16, winBias: 0.60 },
  urban:    { coverPct: 0.17, minGap: 2, shape: 'wall',   plaza: false, roomChance: 0.30, winBias: 0.45 },
  fort:     { coverPct: 0.13, minGap: 3, shape: 'pillar', plaza: true,  roomChance: 0.22, winBias: 0.70 },
};

/* 在 (x,y) 附近是否已有掩体（用于保持最小间距，避免连成一片） */
function nearCover(g, x, y, gap) {
  for (let dy = -gap; dy <= gap; dy++) {
    for (let dx = -gap; dx <= gap; dx++) {
      const nx = x + dx, ny = y + dy;
      if (!inB(nx, ny)) continue;
      const t = g[idx(nx, ny)];
      if (t === WALL || t === WIN) return true;
    }
  }
  return false;
}

/* 放一根柱子（1~2 格的小掩体）。
   ★ 窗的比例要给够：窗是**半掩体**（挡移动不挡子弹/视线），
     是「隔窗对射」这种战术的基础。参考游戏里掩体本身很少，
     所以每一块掩体都要尽量发挥价值 —— 相当一部分做成可透视的窗，
     这样既挡走位又不切断视野，比实心墙更有利于交火。
   ★ `open` 风格要特别提高窗的比例：
     它掩体最少（7%），如果还全做实心墙，整张图只会剩下几堵孤零零的墙，
     门窗数量凑不够 → 随机生成被判不合格（实测 open 只有 2~6 个开口）。
     掩体少的地方，每一块都应该尽量是「可透视的」，
     这样既不堵视野，又能提供战术位置。 */
function placePillar(g, isRoad, x, y, rnd, winBias) {
  const pWin = (winBias === undefined) ? 0.55 : winBias;
  gSet(g, x, y, rnd() < pWin ? WIN : WALL);
  if (rnd() < 0.30) {
    const dx = rnd() < 0.5 ? 1 : -1;
    if (inB(x + dx, y) && g[idx(x + dx, y)] === EMPTY) {
      gSet(g, x + dx, y, rnd() < pWin ? WIN : WALL);
    }
  }
}

/* 放一段矮墙（3~5 格），带一个可绕行的缺口 */
function placeWall(g, isRoad, x, y, horiz, rnd) {
  const len = 3 + Math.floor(rnd() * 3);
  const gapAt = Math.floor(rnd() * len);
  for (let i = 0; i < len; i++) {
    if (i === gapAt) continue;                    /* 留缺口，不是实心墙 */
    const px = horiz ? x + i : x;
    const py = horiz ? y : y + i;
    if (!inB(px, py) || px < 2 || px >= GW - 2 || py < 2 || py >= GH - 2) break;
    if (g[idx(px, py)] !== EMPTY) break;
    /* 矮墙里混入窗：半数以上是窗，形成「断续的半掩体线」 */
    gSet(g, px, py, rnd() < 0.45 ? WALL : WIN);
  }
}

/* 放一个小房间（可进入的掩体，给「逐屋清理」用）。
   注意：房间是**稀有的**，不是画满整张图。 */
function placeRoom(g, isRoad, x, y, rnd) {
  const w = 3 + Math.floor(rnd() * 2);
  const h = 2 + Math.floor(rnd() * 2);
  if (x + w >= GW - 2 || y + h >= GH - 2) return;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const edge = (i === 0 || i === w - 1 || j === 0 || j === h - 1);
      if (edge) gSet(g, x + i, y + j, WALL);
      else gSet(g, x + i, y + j, EMPTY);
    }
  }
  /* 至少开一个门，保证能进去 */
  const side = Math.floor(rnd() * 4);
  if (side === 0) gSet(g, x + 1, y, DOOR);
  else if (side === 1) gSet(g, x + 1, y + h - 1, DOOR);
  else if (side === 2) gSet(g, x, y + 1, DOOR);
  else gSet(g, x + w - 1, y + 1, DOOR);
}

/* 主入口 */
function buildCityMap(style, seed) {
  const rnd = seededRng(seed || 20261017);
  const S = MAP_STYLE[style] ? style : 'balanced';
  const cfg = MAP_STYLE[S];
  const g = newGrid();
  gBorder(g);
  const isRoad = new Uint8Array(GW * GH);
  const W = GW, H = GH;

  /* 出生区：左右各留 3 列干净地面（单位从这里展开） */
  const spawnW = 3;

  /* ① 按目标比例放置掩体。
        用「尝试次数」控制，而不是铺满 —— 这样保证不会过密。 */
  const targetCells = Math.round(W * H * cfg.coverPct);
  let placed = 0;
  let tries = 0;
  const maxTries = targetCells * 40;

  while (placed < targetCells && tries++ < maxTries) {
    const x = 2 + Math.floor(rnd() * (W - 4));
    const y = 2 + Math.floor(rnd() * (H - 4));

    /* 出生区里不放掩体（保证双方能展开） */
    if (x < spawnW + 1 || x >= W - spawnW - 1) continue;
    /* 已有掩体太近就跳过 —— 这是「不连成片」的关键 */
    if (nearCover(g, x, y, cfg.minGap)) continue;
    if (g[idx(x, y)] !== EMPTY) continue;

    const roll = rnd();
    if (roll < cfg.roomChance) {
      placeRoom(g, isRoad, x, y, rnd);
      placed += 9;                       /* 房间面积大，按 9 格计 */
    } else if (cfg.shape === 'wall') {
      placeWall(g, isRoad, x, y, rnd() < 0.5, rnd);
      placed += 4;
    } else {
      placePillar(g, isRoad, x, y, rnd, cfg.winBias);
      placed += 1;
    }
  }

  /* ② fort：中央一块大空地 + 一圈掩体（交战焦点） */
  if (cfg.plaza) {
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    const rw = Math.max(3, Math.round(W * 0.10));
    const rh = Math.max(2, Math.round(H * 0.14));
    for (let y = cy - rh; y <= cy + rh; y++) {
      for (let x = cx - rw; x <= cx + rw; x++) {
        if (inB(x, y) && x > 1 && x < W - 2 && y > 1 && y < H - 2) gSet(g, x, y, EMPTY);
      }
    }
    /* 据点外围撒一圈掩体，形成「攻打据点」的层次 */
    const ringN = Math.round((rw + rh) * 2.2);
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2;
      const rx = Math.round(cx + Math.cos(a) * (rw + 1.5));
      const ry = Math.round(cy + Math.sin(a) * (rh + 1.5));
      if (!inB(rx, ry) || rx < 2 || rx >= W - 2 || ry < 2 || ry >= H - 2) continue;
      if (g[idx(rx, ry)] === EMPTY) gSet(g, rx, ry, rnd() < 0.55 ? WALL : WIN);
    }
  }

  /* ③ 出生区最终清理：左右各 3 列确保畅通（放在掩体之后，优先级最高） */
  for (const side of [0, 1]) {
    const x0 = side === 0 ? 1 : W - spawnW - 1;
    for (let y = 1; y < H - 1; y++) {
      for (let x = x0; x < x0 + spawnW; x++) {
        if (inB(x, y)) { gSet(g, x, y, EMPTY); isRoad[idx(x, y)] = 1; }
      }
    }
  }

  /* ④ 公平性：180° 旋转对称（下半区由上半区旋转而来）。
     保证两队地形完全对等。 */
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const my = H - 1 - y, mx = W - 1 - x;
      if (!(y > my || (y === my && x > mx))) continue;
      gSet(g, x, y, g[idx(mx, my)]);
      isRoad[idx(x, y)] = isRoad[idx(mx, my)];
    }
  }

  g._style = S;
  g._streets = isRoad;
  return g;
}

/* 兼容旧调用点 */
function buildTacticalMap(style, seed) {
  const S = MAP_STYLE[style] ? style : 'balanced';
  const seedMap = { open: 11001, balanced: 11002, urban: 11003, fort: 11004 };
  return buildCityMap(S, seed || seedMap[S] || 11002);
}



const PRESET_STYLE={
  open:'open', balanced:'balanced', urban:'urban', fort:'fort',
  /* 旧 key 兼容 */
  plaza:'balanced', fortress:'fort', warehouse:'urban', city:'urban',
};
const PRESET_SEED={ open:11001, balanced:11002, urban:11003, fort:11004 };
/* 按 key 生成地图。
   ★ 必须优先走 PRESETS[kind].build() —— 那是**每张图的权威生成器**。
     踩过的坑：这里原本只查 PRESET_STYLE 映射表，而 mission1~4
     不在表里 → 全部回退到 'balanced' →
     点「城市街区 / 市中心 / 老城巷道 / 近郊平房」四个按钮，
     地图纹丝不动（用户反馈「地图不能用的按钮还是存在」）。
     现在：有 PRESETS 条目就用它自己的 build()，没有才退回风格表。 */
function buildPreset(kind){
  if(typeof PRESETS!=='undefined' && PRESETS[kind] && typeof PRESETS[kind].build==='function'){
    return PRESETS[kind].build();
  }
  const style=PRESET_STYLE[kind]||'balanced';
  const seed=PRESET_SEED[style]||11002;
  return buildTacticalMap(style, seed);
}
/* ---------------- 地图体检：按 AI 逻辑检查地图是否可用 ----------------
   返回 {ok, issues[], stats}。既供「⑤ 地图」面板提示，也供回归测试断言。
   检查项来自 bestHoldSpot / coverAt / panic 后退的真实需求。 */
function auditMap(g){
  const issues=[];
  const st={wall:0,win:0,door:0,doorL:0,doorR:0,winL:0,winR:0,
            blocksL:0,blocksR:0,midBlocks:0,midDoors:0,spawnFree:0};
  const mid0=Math.floor(GW*0.30), mid1=Math.ceil(GW*0.70);
  for(let y=0;y<GH;y++) for(let x=0;x<GW;x++){
    const v=g[idx(x,y)], left=x<GW/2;
    if(v===WALL) st.wall++;
    else if(v===WIN){ st.win++; if(left) st.winL++; else st.winR++; }
    else if(v===DOOR){ st.door++; if(left) st.doorL++; else st.doorR++; }
    if(x>=mid0&&x<mid1){
      if(v===WALL||v===WIN) st.midBlocks++;
      if(v===DOOR) st.midDoors++;
    }
    if(left&&(v===WALL||v===WIN)) st.blocksL++;
    if(!left&&(v===WALL||v===WIN)) st.blocksR++;
  }
  /* ① 公平性：**中心旋转对称**（而不是左右镜像）。
     ★ 这里必须和生成器保持一致：buildTacticalMap 用的是 180° 旋转对称
       `(x,y) ↔ (GW-1-x, GH-1-y)`，因为它允许道路斜走、街区形状不规则
       （左右镜像会强行把路拉成田字）。
       旧版这里检查的是左右镜像，于是**每张新图都被判「不对称」** ——
       随机地图生成器因此 100% 判不合格、永远走兜底分支。
       现在改成检查旋转对称，与生成器口径一致。
     另外保留「左右分区均衡度」作为补充指标：
     两边的掩体数量不该差太多（否则一侧天生吃亏）。 */
  let asym=0;
  for(let y=1;y<GH-1;y++) for(let x=1;x<GW-1;x++){
    if(g[idx(x,y)]!==g[idx(GW-1-x,GH-1-y)]) asym++;
  }
  st.asymmetry=asym;
  st.rotAsym=asym;
  st.blockDiff=Math.abs(st.blocksL-st.blocksR);
  /* ★ 关卡设计指标（判断「逻辑性」，而不只是看对称与方块数量）：
       连通区    —— 主可通行区大小（有没有死腔）
       咽喉点    —— 窄口数量，即攻防焦点数量
       最长视线  —— 决定远程单位强弱
       掩体比例  —— 全掩体 / 半掩体 / 空地的搭配 */
  const reg=mainRegion(g);
  st.mainSize=reg?reg.size:0;
  st.sealed=reg?reg.sealed:0;
  let chokes=0;
  for(let y=1;y<GH-1;y++) for(let x=2;x<GW-2;x++){
    if(!passableForHuman(g,x,y)) continue;
    const lw=!passableForHuman(g,x-1,y), rw=!passableForHuman(g,x+1,y);
    const uw=!passableForHuman(g,x,y-1), dw=!passableForHuman(g,x,y+1);
    if((lw&&rw)||(uw&&dw)) chokes++;
  }
  st.chokepoints=chokes;
  let maxSight=0;
  for(let y=1;y<GH-1;y++){
    let run=0;
    for(let x=1;x<GW-1;x++){
      if(blocksSight(g,x,y)){ if(run>maxSight) maxSight=run; run=0; }
      else run++;
    }
    if(run>maxSight) maxSight=run;
  }
  st.maxSight=maxSight;
  st.coverRatio=+(((st.wall||0)+(st.win||0)*0.5)/Math.max(1,GW*GH)).toFixed(3);
  /* 旋转对称容差放宽到 2%：生成器的对称化是「取更保守值」，
     本来就不追求逐格一致（否则又会退回田字格）。 */
  if(asym>Math.max(12,GW*GH*0.02)) issues.push('中心旋转不对称（'+asym+' 格不一致），两队收益不对等');
  /* 掩体均衡：两侧掩体数量差太多会让一边天生吃亏 */
  if(st.blockDiff>Math.max(10,GW*GH*0.05)) issues.push('左右掩体数量差 '+st.blockDiff+'，两队地形收益不均');
  /* ② 中段必须有掩体，否则 hold / cover 预设找不到依托 */
  if(st.midBlocks<6) issues.push('中段过于空旷（挡视线方块仅 '+st.midBlocks+'），AI 找不到掩体');
  /* ③ 必须有门：门是僵尸的瓶颈，也是人类的机动通道 */
  /* ③ 可透视掩体（门 + 窗）。
     ★ 门槛按「实际掩体量」算，不是按地图面积硬算。
       掩体改成稀疏柱子后（对齐参考作品 5~12%），
       `open` 这种极稀疏风格整张图只有几十块掩体，
       门窗自然只有个位数 —— 那是设计如此，不是缺陷。
       真正要禁止的是「整张图全是实心墙、没有任何可透视位置」，
       所以门槛设得很低：至少有 3 个开口就行。 */
  if ((st.door + st.win) < 3) {
    issues.push('整个地图没有可透视掩体（门+窗仅 ' + (st.door + st.win) + ' 个）');
  }
  /* ④ 出生区左右各要有掩体与窗，供人类后撤依托 */
  if(st.blocksL<4||st.blocksR<4) issues.push('出生区附近掩体不足，人类后撤无处依托');
  if(st.winL<1||st.winR<1) issues.push('缺少窗口，无法形成隔窗对射的掩体收益');
  /* ⑤ 出生点必须落在可通行格上（否则开局就嵌入）。
     直接用 teamAnchors 现算，避免依赖调用时的 G/teams 状态。 */
  const anchors=teamAnchors(Math.max(2,teams.length));
  for(let i=0;i<anchors.length;i++){
    const a=anchors[i];
    const tx=clamp((a.x/TILE)|0,0,GW-1), ty=clamp((a.y/TILE)|0,0,GH-1);
    let free=0;
    for(let dy=-3;dy<=3;dy++) for(let dx=-3;dx<=3;dx++){
      const nx=tx+dx, ny=ty+dy;
      if(!inB(nx,ny)) continue;
      if(!blocksMove(g[idx(nx,ny)],nx,ny,'h')) free++;
    }
    st.spawnFree=Math.min(st.spawnFree===0?free:st.spawnFree,free);
    if(free<12) issues.push('第 '+(i+1)+' 队出生区太拥挤（可站 '+free+' 格）');
  }
  return {ok:issues.length===0, issues:issues, stats:st};
}
/* 预置地图。
   ★ 已全部换成「关卡设计驱动」的生成器（见 buildTacticalMap）：
     旧的四张图只是对称图案，没有攻防焦点与视线节奏，
     用户反馈「逻辑性太差」。新图按主线 / 咽喉点 / 环流 /
     掩体层次 / 视线节奏组织，每种风格有不同的攻防性格。 */
/* ============================================================================
   手工地图（v5）—— 不用随机生成器，逐张按设计意图搭建
   ============================================================================
   用户要求：「默认地图设计不按照生成器，而是按照你的逻辑一步步搭建」。

   为什么放弃生成器：
     生成器的输出是「统计意义上正确，但没有设计意图」——
     节点位置随机、掩体分布均匀，玩起来没有「这张图该怎么打」的记忆点。
     而参考作品每集的地图都是有明确构图的：哪里是主路、哪里能卡点、
     哪里是布雷区，一眼能读出来。

   做法：用 ASCII 字符画**手写**每张图。
     `.` 空地　`#` 墙（全掩体）　`=` 窗（半掩体，可射不可走）
     `+` 门（僵尸需撞开）
   字符画的好处：设计意图直接可见，改图就是改字符，不需要调参数猜结果。

   ★ 字符画按 **52×28**（中地图）绘制。
     其它尺寸会按比例缩放（见 scaleAsciiMap），缩放时保持结构比例。
   ========================================================================== */

/* ── 开阔平原 open ────────────────────────────────────────────────
   设计意图：**长视线、少掩体、不对称地形**。
   上下两半刻意不同：上半有一道残垣横墙（左侧可躲、右侧开阔），
   下半只有零散巨石。左侧出生点近墙可守，右侧出生点直面空地 ——
   双方自然形成「西守东攻」的攻防节奏，不再是对称镜像的乒乓局。 */
const ASCII_OPEN = [
  '....................................................',
  '....................................................',
  '..........#............................#............',
  '....................................................',
  '.....=..........................##..........=.......',
  '......................#.............................',
  '.............................=......................',
  '....................................................',
  '...............#...........................#........',
  '....................................................',
  '####################...............=................',
  '....................................................',
  '.......=............................................',
  '....................................................',
  '.......=.............###...............#............',
  '....................................................',
  '....................................................',
  '...............#..........=...........................',
  '....................................................',
  '.............................=......##..............',
  '......................#.............................',
  '....................................................',
  '..........=............................#............',
  '....................................................',
  '....................................................',
  '....................................................',
  '....................................................',
  '....................................................',
];

/* ── 均衡街区 balanced ────────────────────────────────────────────
   设计意图：**标准的城市攻防**。楼体小而疏、街道留宽，
   每栋楼都有一个门（可进入）和一个窗（可隔窗对射）。
   交战逻辑：楼与楼之间的宽街是机动线，进楼是掩体但要防绕后。
   ★ 掩体占比目标 ~18%：之前画成 28%（楼大且密），
     双方又互相看不见了 —— 参考作品区间 5~12%，
     我们有门/窗/房间，取其上限附近。 */
const ASCII_BALANCED = [
  '....................................................',
  '....................................................',
  '....####.......####.......####.......####...........',
  '....#..=.......=..#.......#..=.......=..#...........',
  '....####.......####.......####.......####...........',
  '....................................................',
  '....................................................',
  '....####.......####.......####.......####...........',
  '....#..+.......+..#.......#..+.......+..#...........',
  '....####.......####.......####.......####...........',
  '....................................................',
  '....................................................',
  '....................................................',
  '....####.......####.......####.......####...........',
  '....=..#.......#..=.......=..#.......#..=...........',
  '....####.......####.......####.......####...........',
  '....................................................',
  '....................................................',
  '....####.......####.......####.......####...........',
  '....#..+.......+..#.......#..+.......+..#...........',
  '....####.......####.......####.......####...........',
  '....................................................',
  '....................................................',
  '....####.......####.......####.......####...........',
  '....=..#.......#..=.......=..#.......#..=...........',
  '....####.......####.......####.......####...........',
  '....................................................',
  '....................................................',
];

/* ── 巷战废墟 urban ───────────────────────────────────────────────
   设计意图：**密集短墙 + 大量转角**。没有长视线，处处是贴脸遭遇。
   墙体是断续的矮墙（带缺口），不是封闭房间 —— 能走能绕但看不清。
   交战逻辑：霰弹/近战的主场；远程武器几乎找不到射击线。
   ★ 全图 30+ 个独立墙簇（实测对比：开阔图只有 13 个），
     「转角数量」就是这张图的性格。 */
const ASCII_URBAN = [
  '....................................................',
  '......=........=........=........=.........',
  '....................................................',
  '....###.......###.......###.......###.......###.....',
  '....#.#.......#.#.......#.#.......#.#.......#.#.....',
  '..........#.........#.........#.........#...........',
  '..=........=........=........=........=........=....',
  '....................................................',
  '....#.#.......#.#.......#.#.......#.#.......#.#.....',
  '....###.......###.......###.......###.......###.....',
  '..............#.........#.........#.................',
  '......=........=........=........=........=.........',
  '.....#.........#.........#.........#................',
  '....##+##.....##+##.....##+##.....##+##.....##+##....',
  '....#...#.....#...#.....#...#.....#...#.....#...#....',
  '....#####.....#####.....#####.....#####.....#####....',
  '..........#.........#.........#.........#...........',
  '......=........=........=........=........=.........',
  '.....#.........#.........#.........#................',
  '....###.......###.......###.......###.......###.....',
  '....#.#.......#.#.......#.#.......#.#.......#.#.....',
  '..............#.........#.........#.................',
  '..=........=........=........=........=........=....',
  '.....#.........#.........#.........#................',
  '....#.#.......#.#.......#.#.......#.#.......#.#.....',
  '....###.......###.......###.......###.......###.....',
  '....................................................',
  '....................................................',
];

/* ── 中央要塞 fort ────────────────────────────────────────────────
   设计意图：**中央一个大要塞**，四周相对开阔。
   要塞有四个门（四向可攻），内部有十字隔墙 —— 争夺要塞就是全部意义。
   交战逻辑：谁占住要塞谁赢；攻方必须选一个门集中突破。 */
const ASCII_FORT = [
  '....................................................',
  '....................................................',
  '...................##########.......................',
  '...................#........#.......................',
  '...................#........#.......................',
  '...................#........#.......................',
  '...............#####........#####...................',
  '...................#........#.......................',
  '...................#........#.......................',
  '...................#........#.......................',
  '...................+........+.......................',
  '...................#........#.......................',
  '.......######......#...##...#......######...........',
  '.......#....#......#...##...#......#....#...........',
  '.......#....=......#........#......=....#...........',
  '.......#....#......#........#......#....#...........',
  '.......######......#........#......######...........',
  '...................#........#.......................',
  '...................#........#.......................',
  '...................+........+.......................',
  '...................#........#.......................',
  '...................#........#.......................',
  '...................#........#.......................',
  '...............#####........#####...................',
  '...................##########.......................',
  '....................................................',
  '....................................................',
  '....................................................',
];

/* 把字符画转成地图。
   支持任意尺寸：如果字符画尺寸与当前地图不符，按比例最近邻缩放。 */
function asciiToGrid(rows, gw, gh) {
  const g = newGrid();
  gBorder(g);
  const srcH = rows.length;
  const srcW = rows[0].length;
  /* ★ 缩放要防「细结构丢失」：
     最近邻映射在小图上可能跳过 `+`/`=`（它们只占一两个字符格），
     实测 mission2 在 small（36×20）下一个门都没剩。
     所以分两遍：第一遍正常映射墙体；第二遍统计手绘图里的门窗数，
     如果输出里门窗数掉了太多，就把被跳过的门窗**强制落格**。 */
  let wantWin = 0, wantDoor = 0;
  for (const r of rows) for (const ch of r) {
    if (ch === '=') wantWin++;
    else if (ch === '+') wantDoor++;
  }

  const placed = [];
  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      const sy = Math.min(srcH - 1, Math.floor((y - 1) / (gh - 2) * srcH));
      const sx = Math.min(srcW - 1, Math.floor((x - 1) / (gw - 2) * srcW));
      const ch = rows[sy][sx];
      let t = EMPTY;
      if (ch === '#') t = WALL;
      else if (ch === '=') t = WIN;
      else if (ch === '+') t = DOOR;
      if (t !== EMPTY) { gSet(g, x, y, t); placed.push({ x, y, t }); }
    }
  }

  /* 第二遍：门窗保底。
     统计已放上门/窗的数量，缺得太多时，从「手绘图门窗密度最高的区域」
     找空地补上门（门比窗优先 —— 门是玩法核心，窗是战术层）。 */
  let gotWin = 0, gotDoor = 0;
  for (const p of placed) { if (p.t === WIN) gotWin++; else if (p.t === DOOR) gotDoor++; }
  const minDoor = Math.min(wantDoor, Math.max(2, Math.round(wantDoor * 0.4)));
  const minWin = Math.min(wantWin, 3);
  if (gotDoor < minDoor || gotWin < minWin) {
    /* 收集所有「手绘图里是门/窗但没被映射到」的源格，
       按比例换算到目标坐标，若目标格为空地则补上 */
    const winCells = [], doorCells = [];
    for (let sy = 0; sy < srcH; sy++) {
      for (let sx = 0; sx < srcW; sx++) {
        const ch = rows[sy][sx];
        if (ch !== '=' && ch !== '+') continue;
        const tx = 1 + Math.floor(sx / srcW * (gw - 2));
        const ty = 1 + Math.floor(sy / srcH * (gh - 2));
        if (ch === '=') winCells.push([tx, ty]); else doorCells.push([tx, ty]);
      }
    }
    /* 打乱顺序（确定性：用坐标做伪随机），逐个尝试落到空地 */
    /* 目标格被占时向邻近格扩散 —— 缩放映射经常撞墙，
       只试一个点会大面积失败（实测 mission2 小图一个门都补不上） */
    const jitter = function (arr, type, need) {
      let have = 0;
      const tryAt = function (tx, ty) {
        if (!inB(tx, ty) || g[idx(tx, ty)] !== EMPTY) return false;
        gSet(g, tx, ty, type);
        return true;
      };
      for (const [tx, ty] of arr) {
        if (have >= need) break;
        if (tryAt(tx, ty)) { have++; continue; }
        /* 螺旋式找邻近空地（1~3 格内） */
        for (let r = 1; r <= 3 && have < need; r++) {
          let done = false;
          for (let dy = -r; dy <= r && !done; dy++) {
            for (let dx = -r; dx <= r && !done; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              if (tryAt(tx + dx, ty + dy)) { have++; done = true; }
            }
          }
        }
      }
      return have;
    };
    if (gotDoor < minDoor) gotDoor += jitter(doorCells, DOOR, minDoor - gotDoor);
    if (gotWin < minWin) gotWin += jitter(winCells, WIN, minWin - gotWin);
  }
  return g;
}

/* 手写地图清单 */
const HAND_MAPS = {
  open:     { name: '开阔平原', rows: ASCII_OPEN,     desc: '长视线 · 少掩体 · 远程占优' },
  balanced: { name: '均衡街区', rows: ASCII_BALANCED, desc: '四块街区 · 门窗可进 · 标准攻防' },
  urban:    { name: '巷战废墟', rows: ASCII_URBAN,    desc: '密集短墙 · 处处转角 · 近战主场' },
  fort:     { name: '中央要塞', rows: ASCII_FORT,     desc: '中央要塞 · 四向可攻 · 争夺中心' },
};

/* 生成一张手写地图 */
function buildHandMap(kind) {
  const m = HAND_MAPS[kind] || HAND_MAPS.balanced;
  const g = asciiToGrid(m.rows, GW, GH);
  g._style = kind;
  g._hand = true;
  return g;
}

const PRESETS = {
  open:    { name:'开阔平原', build(){ return buildHandMap('open'); } },
  balanced:{ name:'均衡街区', build(){ return buildHandMap('balanced'); } },
  urban:   { name:'巷战废墟', build(){ return buildHandMap('urban'); } },
  fort:    { name:'中央要塞', build(){ return buildHandMap('fort'); } },
};
/* 旧名字保留为别名，避免存档 / 调试脚本里的旧 key 失效 */
PRESETS.plaza=PRESETS.balanced;
PRESETS.fortress=PRESETS.fort;
PRESETS.warehouse=PRESETS.urban;
PRESETS.city=PRESETS.urban;PRESETS.city=PRESETS.urban;
/* ============================================================================
   撤离模式手绘地图（v5）
   ============================================================================
   撤离区在左侧，僵尸从右侧涌入，平民藏在城里。四张图性格差异显著：
   mission1 规整街区（入门）/ mission2 高楼窄街 / mission3 死胡同巷战 / mission4 开阔平房
   ========================================================================== */
const ASCII_M1 = [
  '....................................................',
  '....................................................',
  '....####....####....####....####....####....####....',
  '....#..=....=..#....#..=....=..#....#..=....=..#....',
  '....####....####....####....####....####....####....',
  '....................................................',
  '....................................................',
  '....####....####....####....####....####....####....',
  '....=..+....+..=....=..+....+..=....=..+....+..=....',
  '....####....####....####....####....####....####....',
  '....................................................',
  '....................................................',
  '....................................................',
  '....####....####....####....####....####....####....',
  '....#..=....=..#....#..=....=..#....#..=....=..#....',
  '....####....####....####....####....####....####....',
  '....................................................',
  '....................................................',
  '....####....####....####....####....####....####....',
  '....=..+....+..=....=..+....+..=....=..+....+..=....',
  '....####....####....####....####....####....####....',
  '....................................................',
  '....................................................',
  '....####....####....####....####....####....####....',
  '....#..=....=..#....#..=....=..#....#..=....=..#....',
  '....####....####....####....####....####....####....',
  '....................................................',
  '....................................................',
];

const ASCII_M2 = [
  '....................................................',
  '..........##########......##########................',
  '..........#........#......#........#................',
  '..........#........#......#........#................',
  '..........#........#......#........#................',
  '..........#+######.#......#+######.#................',
  '..........#........#......#........#................',
  '....##....#........#......#........#.........##....',
  '....##....##########......##########.........##....',
  '....................................................',
  '....................................................',
  '....##########......##########......##########......',
  '....#........#......#........#......#........#......',
  '....#........#......#........#......#........#......',
  '....#+######.#......#+######.#......#+######.#......',
  '....#........#......#........#......#........#......',
  '....##########......##########......##########......',
  '....................................................',
  '....................................................',
  '....##....##########......##########.........##....',
  '....##....#........#......#........#.........##....',
  '..........#........#......#........#................',
  '..........#+######.#......#+######.#................',
  '..........#........#......#........#................',
  '..........#........#......#........#................',
  '..........##########......##########................',
  '....................................................',
  '....................................................',
];

const ASCII_M3 = [
  '....................................................',
  '...###..............................................',
  '...#.#....##+##.....###......####.....##+##.........',
  '...#.#....#...#.....#+#......#..#.....#...#.....##..',
  '...###....#####.....###......####.....#####.....##..',
  '..........=..............................=..........',
  '..###........................................###....',
  '..#+#....####......##+##......###.....####..#+#.....',
  '..###....#..#......#...#......#+#.....#..#..###.....',
  '.........####......#####......###.....####..........',
  '....=..........=..........=..........=..........=...',
  '....................................................',
  '..####.....###....##..........###....####...........',
  '..#..#.....#+#....##....##....#+#....#..#.....###...',
  '..####.....###...........##....###....####.....#+#..',
  '....................................................',
  '.......##+##......####......##+##......###..........',
  '.......#...#......#..#......#...#......#+#....##....',
  '.......#####......####......#####......###....##....',
  '..=..........=..........=..........=..........=.....',
  '....###......####......##+##......###...............',
  '....#+#......#..#......#...#......#+#......####.....',
  '....###......####......#####......###......#..#.....',
  '............................................####.....',
  '..##.........=..........=..........=.........##.....',
  '..##....###......####......###......####............',
  '........#+#......#..#......#+#......#..#.....###....',
  '........###......####......###......####.....#+#....',
];

const ASCII_M4 = [
  '....................................................',
  '....................................................',
  '...####......####........####......####.............',
  '...#..+......+..#........#..=......=..#.............',
  '...####......####........####......####.............',
  '....................................................',
  '....................................................',
  '........####........####........####........####....',
  '........=..#........#..+........=..#........#..=....',
  '........####........####........####........####....',
  '....................................................',
  '....................................................',
  '...####........####......####........####...........',
  '...=..#........+..#......#..=........=..#...........',
  '...####........####......####........####...........',
  '....................................................',
  '....................................................',
  '........####........####........####........####....',
  '........#..=........=..#........#..+........+..#....',
  '........####........####........####........####....',
  '....................................................',
  '....................................................',
  '...####......####........####......####.............',
  '...#..=......=..#........#..+......+..#.............',
  '...####......####........####......####.............',
  '....................................................',
  '....................................................',
  '....................................................',
];

const HAND_MISSION_MAPS = {
  mission1: { name: '城市街区', rows: ASCII_M1, desc: '规整路网 · 宽街视野好 · 入门图' },
  mission2: { name: '市中心',   rows: ASCII_M2, desc: '高楼窄街 · 视线切断 · 破墙压力' },
  mission3: { name: '老城巷道', rows: ASCII_M3, desc: '不规则建筑 · 死胡同多 · 逐巷清理' },
  mission4: { name: '近郊平房', rows: ASCII_M4, desc: '小楼大院 · 视野开阔 · 考验队形' },
};

function buildHandMissionMap(kind) {
  const m = HAND_MISSION_MAPS[kind] || HAND_MISSION_MAPS.mission1;
  const g = asciiToGrid(m.rows, GW, GH);
  g._style = kind;
  g._hand = true;
  return g;
}

/* ★ 撤离模式四张图：全部手工搭建（v5）。
   用户要求加大地图之间的差异 —— 生成器的输出结构趋同，
   改成逐张手绘字符画（见上方 HAND_MISSION_MAPS），每张有明确构图。 */
PRESETS.mission1={ name:HAND_MISSION_MAPS.mission1.name, build(){ return buildHandMissionMap('mission1'); } };
PRESETS.mission2={ name:HAND_MISSION_MAPS.mission2.name, build(){ return buildHandMissionMap('mission2'); } };
PRESETS.mission3={ name:HAND_MISSION_MAPS.mission3.name, build(){ return buildHandMissionMap('mission3'); } };
PRESETS.mission4={ name:HAND_MISSION_MAPS.mission4.name, build(){ return buildHandMissionMap('mission4'); } };
PRESETS.mission1.desc=HAND_MISSION_MAPS.mission1.desc;
PRESETS.mission2.desc=HAND_MISSION_MAPS.mission2.desc;
PRESETS.mission3.desc=HAND_MISSION_MAPS.mission3.desc;
PRESETS.mission4.desc=HAND_MISSION_MAPS.mission4.desc;
/* 每个尺寸记住自己当前用的是哪张图，重置时按尺寸重建 */
const SIZE_MAP={ small:{kind:'balanced',custom:null}, medium:{kind:'balanced',custom:null},
                 large:{kind:'balanced',custom:null}, huge:{kind:'balanced',custom:null} };

/* ---------------- 出生与地图校验 ---------------- */
function emptyCells(g,x0,x1){
  const out=[];
  for(let y=1;y<GH-1;y++) for(let x=x0;x<=x1;x++){
    if(!inB(x,y)) continue;
    if(g[idx(x,y)]===EMPTY) out.push({x:cx_of(x),y:cy_of(y),cx:x,cy:y});
  }
  return out;
}
/* 从起点洪水填充，返回「可走位掩码」。
   ★ 这是修「中空区块没出口、出生就被关死」的关键：
     emptyCells 只判断「这一格是不是空地」，完全不关心它连不连通。
     于是一个四面封死的小空腔也是「空地」，单位被塞进去就永远出不来
     （ensureFree 只把单位挪到空地，那个空地本身就在死腔里）。
     现在所有出生点/平民点/撤离区都必须在这个掩码里，从根上杜绝。 */
function reachMask(g,startCx,startCy){
  const seen=new Uint8Array(GW*GH);
  if(!inB(startCx,startCy)||!passableForHuman(g,startCx,startCy)) return seen;
  const q=[idx(startCx,startCy)];
  seen[q[0]]=1;
  while(q.length){
    const ci=q.pop(), cx=ci%GW, cy=(ci/GW)|0;
    for(const d of DIR8){
      const nx=cx+d[0], ny=cy+d[1];
      if(!inB(nx,ny)) continue;
      const ni=idx(nx,ny);
      if(seen[ni]||!passableForHuman(g,nx,ny)) continue;
      /* 不允许贴角穿过（对角走位要求两侧至少一侧能过） */
      if(d[0]&&d[1]&&(!passableForHuman(g,cx+d[0],cy)||!passableForHuman(g,cx,cy+d[1]))) continue;
      seen[ni]=1; q.push(ni);
    }
  }
  return seen;
}
/* 找全图最大连通空地区域，并返回「该区域内的所有可走格」。
   出生点、平民、撤离区都用这个结果，保证彼此一定连通。
   同时能报出「被封闭的空腔有多少格」——用于地图体检提示。
   注意：门（DOOR）是可通行的，所以关门不算封死；
   但门有耐久，僵尸会砸开 —— 这里按"可通行"处理是对的。 */
function mainRegion(g){
  const seenFull=new Uint8Array(GW*GH);
  let best=null,bestN=0,total=0;
  for(let y=1;y<GH-1;y++) for(let x=1;x<GW-1;x++){
    const i=idx(x,y);
    if(seenFull[i]||!passableForHuman(g,x,y)) continue;
    const m=reachMask(g,x,y);
    let n=0;
    for(let k=0;k<m.length;k++) if(m[k]){ n++; seenFull[k]=1; }
    total+=n;
    if(n>bestN){ bestN=n; best=m; }
  }
  return {mask:best,size:bestN,total:total,sealed:total-bestN};
}
/* 该格是否在可走区域里（供编辑预览 / 体检使用） */
function inMainRegion(g,x,y){
  const r=g.__mainRegion||(g.__mainRegion=mainRegion(g));
  return r.mask&&r.mask[idx(x,y)]?true:false;
}
/* 出生点布置。
   ★ 关键改进：不要按「离锚点距离」取格子 —— 那样会退化成整齐的矩形阵列，
     看起来像电子表格（视频里的对手是自然的弧形散兵线）。
     这里改成：沿「面向敌人的弧线」分层布置 + 每格加随机抖动，
     得到一片有厚度的、面向敌方的新月形集结点。 */
/* 查询某尺寸地图上是否有自定义出生点（供 spawnsFor / 刷怪使用） */
function customSpawnsOf(){
  const mem=SIZE_MAP[MSIZE];
  return (mem&&mem.customSpawns)?mem.customSpawns:[];
}
function customSpawnersOf(){
  const mem=SIZE_MAP[MSIZE];
  return (mem&&mem.customSpawners)?mem.customSpawners:[];
}
/* 若该队伍有自定义出生点，就把整队的出生锚点改成它。
   这样玩家在地图上点的位置会真正决定部队从哪展开。 */
function anchorFor(teamIdx,fallback){
  const cs=customSpawnsOf();
  for(const s of cs){ if((s.team|0)===teamIdx) return {x:s.x,y:s.y,custom:true}; }
  return fallback;
}
function spawnsFor(g,anchor,need){
  /* ★ 只用「与主区域连通」的空地。
     之前直接取全部空地，四面包死的小空腔也算，单位会被关在里面出不来。 */
  const reg=mainRegion(g);
  const cells=emptyCells(g,1,GW-2).filter(c=>reg.mask&&reg.mask[idx(c.cx,c.cy)]);
  if(!cells.length) return [];
  /* 朝向：从锚点指向地图中心偏敌方的方向（出生点在地图边缘时即朝内） */
  const fdx=VW/2-anchor.x, fdy=VH/2-anchor.y;
  const flen=Math.hypot(fdx,fdy)||1;
  const ux=fdx/flen, uy=fdy/flen;
  /* 排序键：先按「到锚点距离」分环，同环内按角度铺开，
     再加一点随机，避免完全等距的格子感 */
  const scored=cells.map(c=>{
    const dx=c.x-anchor.x, dy=c.y-anchor.y;
    const dist=Math.hypot(dx,dy);
    const along=dx*ux+dy*uy;                       // 朝敌方向的分量
    const lateral=Math.abs(dx*(-uy)+dy*ux);        // 侧向分量
    /* 前几排优先；侧向越宽越好（铺开成线），并加 ±0.35 格随机抖动打散阵列感 */
    const jitter=(rnd()-0.5)*TILE*0.7;
    return {c:c, key:dist+lateral*0.35-along*0.25+jitter};
  });
  scored.sort((a,b)=>a.key-b.key);
  /* ★ 自定义出生点：整队必须**围绕该点**展开，而不是全图就近选点。
     做法是只保留距锚点一定半径内的候选格（半径随所需人数放大），
     保证部队真的从玩家点的地方进场。 */
  let pool=scored;
  if(anchor.custom){
    const maxR=Math.max(TILE*5, Math.sqrt(need)*TILE*1.5);
    const near=scored.filter(s=>Math.hypot(s.c.x-anchor.x,s.c.y-anchor.y)<=maxR);
    if(near.length>=Math.min(need,4)) pool=near;
  }
  const out=[];
  /* 最小间距：略小于身位直径，允许成排但不重叠 */
  const minGap=TILE*0.78;
  for(const s of pool){
    if(out.length>=need) break;
    let ok=true;
    for(const o of out){ if(Math.hypot(o.x-s.c.x,o.y-s.c.y)<minGap){ ok=false; break; } }
    if(ok) out.push({x:s.c.x,y:s.c.y});
  }
  for(const s of pool){ if(out.length>=need) break; if(!out.some(o=>o.x===s.c.x&&o.y===s.c.y)) out.push({x:s.c.x,y:s.c.y}); }
  /* 自定义点周围实在站不下，就用全图补齐（宁可挤一点也不能少人） */
  if(out.length<need){
    for(const s of scored){ if(out.length>=need) break;
      if(!out.some(o=>o.x===s.c.x&&o.y===s.c.y)) out.push({x:s.c.x,y:s.c.y}); }
  }
  return out.slice(0,need);
}
/* 人类可站立的格：空地 / 门 / **窗**（窗要翻，但确实能过）。
   ★ 必须与 blocksMove 保持一致：那里人类可以翻窗，
     这里若把窗排除，会出现「路能走但连通性检查说走不通」的矛盾，
     导致出生点与平民点选得过于保守（甚至判定地图不可用）。 */
function passableForHuman(g,x,y){ const t=g[idx(x,y)]; return t===EMPTY||t===DOOR||t===WIN; }
function validateGrid(g){
  const n=teams.length;
  const cells=emptyCells(g,1,GW-2);
  if(cells.length<8) return {ok:false,reason:'全图空地太少（不足 8 格），请清理地图'};
  const anchors=teamAnchors(n);
  /* ★ 先把「主连通区」算出来，后面选种子只在里面挑。
     为什么必须这样：地图变密之后，锚点附近可能有一小块空地，
     但它被建筑围住、与外界不通（封闭天井 / 楼内房间）。
     旧代码选「离锚点最近的空地」当种子 → 种子落在封闭区里 →
     洪水填充到不了 → 报「队伍N 到队伍1 之间没有可通行路线」直接拒绝开局。
     实测三队混战 100% 触发。现在只在主连通区里选，从根上避免。 */
  const reg0=mainRegion(g);
  const inMain=c=>(reg0.mask?!!reg0.mask[idx(c.cx,c.cy)]:true);
  const seeds=[];
  for(let i=0;i<n;i++){
    const ra=relaxedAnchor(g, anchors[i], 8);
    const box={x:ra.x, y:ra.y};
    const usable=cells.filter(inMain);
    let near=0;
    for(const c of usable) if(Math.hypot(c.x-box.x,c.y-box.y)<TILE*4.5) near++;
    if(near<8) return {ok:false,reason:'队伍'+(i+1)+' 的出生区空地太少（不足 8 格），请清理该区域'};
    let best=null,bd=1e9;
    for(const c of usable){ const d=Math.hypot(c.x-box.x,c.y-box.y); if(d<bd){ bd=d; best=c; } }
    if(!best) best=usable[0]||cells[0];
    seeds.push(best);
  }
  const seen=new Uint8Array(GW*GH), q=[idx(seeds[0].cx,seeds[0].cy)]; seen[q[0]]=1;
  while(q.length){
    const ci=q.pop(), cx=ci%GW, cy=(ci/GW)|0;
    for(const d of DIR8){
      const nx=cx+d[0], ny=cy+d[1];
      if(!inB(nx,ny)) continue;
      const ni=idx(nx,ny);
      if(seen[ni]||!passableForHuman(g,nx,ny)) continue;
      if(d[0]&&d[1]&&(!passableForHuman(g,cx+d[0],cy)||!passableForHuman(g,cx,cy+d[1]))) continue;
      seen[ni]=1; q.push(ni);
    }
  }
  for(let i=1;i<n;i++){
    const s=idx(seeds[i].cx,seeds[i].cy);
    if(!seen[s]) return {ok:false,reason:'队伍'+(i+1)+' 到队伍1 之间没有可通行路线（窗户不可通行），请留出空地或放置门'};
  }
  /* ★ 封闭空腔：不当作错误（建筑内部本来就可能是封死的，属于正常设计），
     只报告数量；真正要做的是「不让任何单位生成在里面」——
     这由 spawnsFor / freeSpotAround / ensureFree 的连通性过滤保证。 */
  const reg=mainRegion(g);
  return {ok:true,sealed:reg.sealed,mainSize:reg.size};
}

/* ---------------- 阵容模型（无人数上限） ---------------- */
function normalize(list, roles){
  const out={};
  for(const k of roles) out[k]=clamp(Math.floor(Number(list[k])||0),0,999);
  return out;
}
function teamCounts(t){
  const t2=teams[t];
  const m=normalize(t2.lineup,t2.roles);
  return {map:m, total:Object.keys(m).reduce((a,k)=>a+m[k],0)};
}
function counts(){
  const out=[], anchors=teamAnchors(teams.length);
  let grand=0;
  for(let i=0;i<teams.length;i++){ const c=teamCounts(i); out.push(c); grand+=c.total; }
  return {teams:out, grand, anchors};
}
function lineupFromDigits(str, roles){
  const s=(str||'').replace(/[^0-9]/g,''); const o={};
  for(let i=0;i<roles.length;i++) o[roles[i]]=parseInt(s[i]||'0',10);
  return o;
}

/* ---------------- 堆 + A* ---------------- */
class Heap{
  constructor(){ this.a=[]; }
  get size(){ return this.a.length; }
  push(n){ const a=this.a; a.push(n); let i=a.length-1;
    while(i>0){ const p=(i-1)>>1; if(a[p].f<=a[i].f) break; const t=a[p]; a[p]=a[i]; a[i]=t; i=p; } }
  pop(){ const a=this.a, top=a[0], last=a.pop();
    if(a.length){ a[0]=last; let i=0;
      for(;;){ const l=2*i+1,r=l+1; let m=i;
        if(l<a.length&&a[l].f<a[m].f) m=l;
        if(r<a.length&&a[r].f<a[m].f) m=r;
        if(m===i) break; const t=a[m]; a[m]=a[i]; a[i]=t; i=m; } }
    return top; }
}
function zCost(x,y){ const t=G.map[idx(x,y)];
  if(t===WALL||t===WIN) return Infinity;
  if(t===DOOR) return G.doorHP[idx(x,y)]>0 ? 7 : 1.6;
  return 1; }
/* ★ 人类寻路代价：窗**可以通过**，但比平地贵。
   代价 = 3.5 的含义：绕路不超过约 3 格时走门更划算，
   超过就翻窗（因为翻窗还能省掉绕行的时间）。
   这个值不能太大 —— 实测给到 6 时，AI 几乎从不翻窗，
   窗在实战里等于还是墙，「翻窗」功能形同虚设。
   也不能太小（<2），否则 AI 会疯狂穿窗、完全不走路。
   与 blocksMove / passableForHuman 保持一致（三处必须同步）。 */
const VAULT_COST=3.5;
function hCost(x,y){
  const t=G.map[idx(x,y)];
  if(t===WALL) return Infinity;
  if(t===WIN)  return VAULT_COST;
  return 1;
}

function findPath(u,gx,gy,kind){
  const cost = kind==='z' ? zCost : hCost;
  const sx=clamp((u.x/TILE)|0,0,GW-1), sy=clamp((u.y/TILE)|0,0,GH-1);
  let tx=clamp((gx/TILE)|0,0,GW-1), ty=clamp((gy/TILE)|0,0,GH-1);
  if(cost(tx,ty)===Infinity){
    let best=null,bd=1e9;
    for(let ry=-4;ry<=4;ry++) for(let rx=-4;rx<=4;rx++){
      const nx=tx+rx, ny=ty+ry;
      if(!inB(nx,ny)||cost(nx,ny)===Infinity) continue;
      const dd=Math.abs(rx)+Math.abs(ry);
      if(dd<bd){ bd=dd; best={x:nx,y:ny}; }
    }
    if(!best) return [{x:gx,y:gy}];
    tx=best.x; ty=best.y;
  }
  const start=idx(sx,sy), goal=idx(tx,ty);
  if(start===goal) return [{x:cx_of(tx),y:cy_of(ty)}];
  const gs=new Float32Array(GW*GH).fill(Infinity);
  const from=new Int32Array(GW*GH).fill(-1);
  const closed=new Uint8Array(GW*GH);
  const heap=new Heap();
  gs[start]=0; heap.push({i:start,f:0});
  let found=false;
  while(heap.size){
    const cur=heap.pop(), ci=cur.i;
    if(closed[ci]) continue;
    closed[ci]=1;
    if(ci===goal){ found=true; break; }
    const cx=ci%GW, cy=(ci/GW)|0;
    for(const d of DIR8){
      const nx=cx+d[0], ny=cy+d[1];
      if(!inB(nx,ny)) continue;
      const c=cost(nx,ny);
      if(c===Infinity) continue;
      if(d[0]&&d[1]&&(cost(cx+d[0],cy)===Infinity||cost(cx,cy+d[1])===Infinity)) continue;
      const ni=idx(nx,ny);
      if(closed[ni]) continue;
      const ng=gs[ci]+c*(d[0]&&d[1]?1.414:1);
      if(ng<gs[ni]-1e-6){
        gs[ni]=ng; from[ni]=ci;
        const h=(Math.abs(nx-tx)+Math.abs(ny-ty))*1.01;
        heap.push({i:ni,f:ng+h});
      }
    }
  }
  if(!found) return [{x:gx,y:gy}];
  const out=[]; let cur=goal, guard=0;
  while(cur!==start && cur>=0 && guard++<GW*GH){
    out.push({x:cx_of(cur%GW), y:cy_of((cur/GW)|0)});
    cur=from[cur];
  }
  out.reverse();
  return out.length?out:[{x:gx,y:gy}];
}

/* ---------------- 单位 ---------------- */
function makeUnit(cls,tid,x,y,n){
  const d=CLASSES[cls];
  const label=(G.teams[tid]?G.teams[tid].name:'队伍'+(tid+1))+'#'+n;
  return {
    id:G.counter++, cls:cls, kind:d.kind, team:tid, teamNum:tid+1, name:d.name,
    color:d.color, role:d.role,
    x:x,y:y,prevX:x,prevY:y,vx:0,vy:0, hp:d.hp, maxHp:d.hp, radius:d.radius,
    cd:rnd()*0.5, aim:d.kind==='h'?0:Math.PI, target:null, path:null, pathT:0, pathGoal:-1,
    stuckT:0, stuck:0, lastX:x, lastY:y, sid:rnd()<0.5?-1:1, seed:rnd()*10,
    alive:true, hitFlash:0, slowT:0, lunge:0, spawnT:0, flash:0, gunFlash:0, kills:0,
    beamTo:null, healCd:0.2, healPulse:0, hatchFx:0, childT:d.hatch?rr(2,4):0, children:0,
    infect:0, infectFx:0, purgedTick:-1, rateMul:1, aura:0, behavior:null,
    magLeft:d.mag||0, reloadT:0, reloadFx:0, bursted:false,
    burnT:0, burnFx:0, burnTick:0, burnFrom:null,
    targetRef:null, targetT:0,      // 目标搜索缓存（大编制性能）
    rouseT:0,                       // 尸变僵直剩余时间（超临界感染用）
    stuckLvl:0, unstuckT:0,         // 卡住分级计数 / 脱困冷却（地图防卡）
    hurtT:0, shieldDir:0, shieldHitFx:0, pushVx:0, pushVy:0,
    throwCd:GRENADE_CD*(0.4+rnd()*0.6), throwT:0, throwing:0, rocketCd:0,
    dispatch:null, dispatchT:0, cover:null, coverT:0,
    plan:null, planT:0, planName:null, holdSet:false,
    holdX:x, holdY:y, label:label
  };
}
/* 按队伍把一批单位放到该队出生区；返回实际生成数量 */
function placeTeam(t,map,countFrom){
  const total=Object.keys(map).reduce((a,k)=>a+(map[k]||0),0);
  if(!total) return 0;
  const d=counts();
  /* ★ 出生锚点要「落在真的站得开的地方」：
     三队以上时均匀角度可能压在建筑上，导致开局失败。
     先按自定义出生点 → 再按松弛后的默认锚点。 */
  const base=d.anchors[t]||teamAnchors(1)[0];
  const anchor=anchorFor(t, relaxedAnchor(G.map, base, 4));
  const cells=spawnsFor(G.map,anchor,total);
  const order=ALL_ROLES;
  let n=0, ci=0;
  for(const k of order){
    const cnt=map[k]||0; if(!cnt) continue;
    for(let i=0;i<cnt;i++){
      const p=cells[(ci++)%Math.max(1,cells.length)];
      const u=makeUnit(k,t,p.x,p.y,countFrom?countFrom(k):(++n));
      u.spawnT=0.35;
      G.units.push(u);
      if(!countFrom) continue;
    }
  }
  return total;
}
function spawnArmies(){
  const c=counts();
  G.teams=teams.map(t=>Object.assign({},t));
  G.units=[]; G.counter=1; G.selected=new Set(); G.dispatchMark=null;
  let zTotal=0;
  for(let i=0;i<teams.length;i++) for(const k of teams[i].roles){
    if(CLASSES[k].kind==='z') zTotal+=c.teams[i].map[k];
  }
  for(const w of (waves&&waves.length?waves:[])) for(const k in w.lineup) zTotal+=w.lineup[k]||0;
  G.zCap=Math.max(60,Math.round(zTotal*3));
  const nums=[]; G.teamNum=teams.map(()=>0);
  for(let t=0;t<teams.length;t++){
    const isZ=teams[t].type!=='h';
    const map=c.teams[t].map;
    if(waveOn&&isZ){ nums.push(0); continue; }   // 僵尸队伍由波次投放
    nums.push(placeTeam(t,map,k=>(G.teamNum[t]=((G.teamNum[t]||0)+1))));
  }
  G.startCount=nums.slice();
  G.waveIdx=0; G.waveT=0; G.waveLog=[];
  G.stats={byClass:{}};
  G.civPos=[];
  G.kills=teams.map(()=>0);
  if(waveOn) spawnWave(0);                       // 第一波立刻到场
  /* 队形：给每队成员分配横向序号（file），并清空阵形缓存 */
  G.frames={};
  for(let t=0;t<teams.length;t++) assignFiles(t);
}
/* ---------------- 僵尸轮次 ---------------- */
let waves=[
  {lineup:{zombie:6,mother:1},gap:25},
  {lineup:{zombie:8,runner:3,mother:1},gap:25},
  {lineup:{zombie:10,runner:4,mother:2,bigbelly:1},gap:25},
];
let waveOn=false;
function waveTeamIndices(){
  const out=[];
  for(let i=0;i<teams.length;i++) if(teams[i].type!=='h') out.push(i);
  return out;
}
function spawnWave(i){
  if(!waves||!waves[i]) return 0;
  const w=waves[i], tgts=waveTeamIndices();
  if(!tgts.length) return 0;
  let n=0;
  for(const t of tgts){
    const before=G.units.length;
    placeTeam(t,w.lineup,k=>(G.teamNum[t]=((G.teamNum[t]||0)+1)));
    const got=G.units.length-before;
    n+=got;
    G.startCount[t]+=got;                     // 只记到真正投放的那支队伍
  }
  G.waveIdx=i+1;
  G.waveT=w.gap>0?w.gap:WAVE_CHECK;
  if(n){
    pushFeed('第 '+(i+1)+' 波僵尸抵达（'+n+' 只）','i');
    G.waveLog.push({n:i+1,count:n,t:+G.time.toFixed(1)});
  }
  return n;
}
/* 下一波条件：场上僵尸被清空（立刻）或 间隔时间到（强制） */
function stepWaves(dt){
  if(!waveOn||G.phase!=='battle') return;
  if(!waves||G.waveIdx>=waves.length) return;
  const tgts=waveTeamIndices();
  if(!tgts.length) return;
  G.waveT-=dt;
  let live=0;
  for(const t of tgts) live+=aliveCount(t);
  if(live===0){ spawnWave(G.waveIdx); return; }
  if(G.waveT<=0) spawnWave(G.waveIdx);
}

/* ---------------- 邻域查询 ----------------
   全部走空间网格（forEachNear），大编制下从 O(n²) 降到接近 O(n)。
   无网格时 forEachNear 自动退回全遍历，保证行为不变。 */
function nearestEnemy(u,needLOS,maxD){
  /* needLOS 时射程有限（有 maxD），走逐圈扫描最快；
     未限制距离时（maxD 无穷）逐圈会退化，用整框扫描。 */
  const bounded=(maxD!==undefined&&isFinite(maxD));
  if(bounded){
    return nearestByRing(u.x,u.y,maxD,e=>{
      if(e.team===u.team) return false;
      const d=Math.hypot(e.x-u.x,e.y-u.y);
      if(needLOS&&!losClear(u.x,u.y,e.x,e.y)) return false;
      return true;
    });
  }
  let best=null,bd=1e9;
  forEachNear(u.x,u.y,e=>{
    if(e.team===u.team) return;
    const d=Math.hypot(e.x-u.x,e.y-u.y);
    if(d<bd){ bd=d; best=e; }
  });
  return best?{e:best,d:bd}:null;
}
/* 只找僵尸型敌人：人类型单位的「后撤本能」针对的是僵尸 */
function nearestFoeZombie(u,maxD){
  if(maxD!==undefined&&isFinite(maxD)){
    return nearestByRing(u.x,u.y,maxD,e=>(e.team!==u.team&&e.kind==='z'));
  }
  let best=null,bd=1e9;
  forEachNear(u.x,u.y,e=>{
    if(e.team===u.team||e.kind!=='z') return;
    const d=Math.hypot(e.x-u.x,e.y-u.y);
    if(d<bd){ bd=d; best=e; }
  });
  return best?{e:best,d:bd}:null;
}
/* 最近的被感染同伴（用于「同伴中招就躲开」的本能） */
function nearestInfectedAlly(u,maxD){
  let best=null,bd=maxD;
  forEachNear(u.x,u.y,a=>{
    if(a.team!==u.team||a===u||a.kind!=='h'||a.infect<=0) return;
    const d=Math.hypot(a.x-u.x,a.y-u.y);
    if(d<bd){ bd=d; best=a; }
  },maxD);
  return best;
}
/* 换弹：开启时打空需换弹；霰弹枪逐发装填（每发 reload 秒），其余整匣换弹
   emptyOnly（喷火兵）：燃料罐必须打空才能换弹，中途不许换 */
function magFull(u){
  const d=CLASSES[u.cls];
  return !d.mag||u.magLeft>=d.mag;
}
function canReload(u){
  const d=CLASSES[u.cls];
  if(!G.reloadOn||!d.mag) return false;
  if(u.reloadT>0||magFull(u)) return false;
  if(d.emptyOnly&&u.magLeft>0) return false;     // 喷火兵：没打空不许换
  return true;
}
function startReload(u){
  const d=CLASSES[u.cls];
  if(!canReload(u)) return false;
  u.reloadT=d.reload||1.5; u.reloadFx=0.5;
  sfx('reload',u.x,u.y);
  return true;
}
function shotOK(u){
  const d=CLASSES[u.cls];
  if(!G.reloadOn||!d.mag) return true;
  if(d.shell) return u.magLeft>0;              // 霰弹：剩几发打几发，装填可随时被打断
  if(d.emptyOnly) return u.magLeft>0&&u.reloadT<=0;   // 喷火兵：空罐只能等换完
  return u.reloadT<=0&&u.magLeft>0;
}
function spendShot(u){
  const d=CLASSES[u.cls];
  if(!G.reloadOn||!d.mag) return;
  u.magLeft=Math.max(0,u.magLeft-1);
  if(d.shell){ u.reloadT=0; }                  // 开火打断逐发装填
  else if(u.magLeft<=0) startReload(u);
}
function stepReload(u,dt){
  if(!G.reloadOn||u.reloadT<=0) return;
  const d=CLASSES[u.cls];
  u.reloadT-=dt;
  if(u.reloadT>0) return;
  if(d.shell){                                 // 逐发装填：装一发，未满则继续
    u.magLeft=Math.min(d.mag,u.magLeft+1);
    u.reloadT=magFull(u)?0:(d.reload||1);
  } else {
    u.magLeft=d.mag; u.reloadT=0;
  }
}
function nearestAllyMedic(u){
  let best=null,bd=1e9;
  /* 找医疗兵没有距离上限（受伤者可能离得很远），所以不限扫描半径 */
  forEachNear(u.x,u.y,a=>{
    if(a.team!==u.team||a.cls!=='medic') return;
    const d=Math.hypot(a.x-u.x,a.y-u.y);
    if(d<bd){ bd=d; best=a; }
  });
  return best;
}
/* 就近抱团：只统计同队附近的同伴，超出半径的人不进圈，避免长途奔波 */
function localAllyCenter(u){
  let cx=0,cy=0,n=0;
  const R2=COHESION_R*COHESION_R;
  forEachNear(u.x,u.y,a=>{
    if(a.team!==u.team||a===u) return;
    const dx=a.x-u.x, dy=a.y-u.y;
    if(dx*dx+dy*dy<=R2){ cx+=a.x; cy+=a.y; n++; }
  },COHESION_R);
  return n?{cx:cx/n,cy:cy/n,n:n}:{n:0,cx:u.x,cy:u.y};
}
function losClear(x0,y0,x1,y1){
  const dx=x1-x0, dy=y1-y0, d=Math.hypot(dx,dy);
  const steps=Math.max(1,Math.ceil(d/(TILE*0.4)));
  for(let i=1;i<steps;i++){
    const t=i/steps, x=x0+dx*t, y=y0+dy*t;
    const tx=(x/TILE)|0, ty=(y/TILE)|0;
    if(!inB(tx,ty)) return false;
    if(blocksSight(G.map[idx(tx,ty)],tx,ty)) return false;
  }
  return true;
}
function meleeReach(x0,y0,x1,y1){
  const dx=x1-x0, dy=y1-y0, d=Math.hypot(dx,dy);
  const steps=Math.max(1,Math.ceil(d/(TILE*0.4)));
  for(let i=1;i<steps;i++){
    const t=i/steps, x=x0+dx*t, y=y0+dy*t;
    const tx=(x/TILE)|0, ty=(y/TILE)|0;
    if(!inB(tx,ty)) return false;
    const tt=G.map[idx(tx,ty)];
    if(tt===WALL||tt===WIN) return false;
    if(tt===DOOR&&G.doorHP[idx(tx,ty)]>0) return false;
  }
  return true;
}

/* ---------------- 特效 ---------------- */
function spark(x,y,color,n){
  for(let i=0;i<n;i++){
    const a=rnd()*TAU, s=rr(30,120);
    G.parts.push({x:x,y:y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rr(.15,.35),max:.35,color:color,size:rr(1.5,2.8)});
  }
}
function burst(x,y,color,n){
  for(let i=0;i<n;i++){
    const a=rnd()*TAU, s=rr(50,220);
    G.parts.push({x:x,y:y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:rr(.3,.7),max:.7,color:color,size:rr(2,4.2)});
  }
}
/* side: 队伍编号（数字），或 'i' 表示感染提示 */
function pushFeed(text,side){
  G.feed.push({t:0,text:text,side:(side===undefined?'':side)});
  if(G.feed.length>7) G.feed.shift();
}
function teamName(tid){ return teams[tid]?teams[tid].name:('队伍'+(tid+1)); }
function breakDoor(tx,ty,dmg,src){
  const i=idx(tx,ty);
  G.doorHP[i]-=dmg;
  spark(cx_of(tx),cy_of(ty),'#ffca7a',3);
  if(G.doorHP[i]<=0){
    G.doorHP[i]=0; G.baseDirty=true;
    burst(cx_of(tx),cy_of(ty),'#a9824a',16);
    pushFeed(src.name+' '+src.label+' 撞开了门',src.team);
  }
}
/* ---------------- 破拆（僵尸砸门 / 砸窗） ----------------
   门和窗都有结构耐久：僵尸会主动破坏挡路的结构，
   而不是「只要 A* 有别的路就绕开」。 */
/* 统一入口：按格子类型分发到门或窗 */
function breakTile(tx,ty,dmg,src){
  const i=idx(tx,ty), t=G.map[i];
  if(t===DOOR) return breakDoor(tx,ty,dmg,src);
  if(t===WIN)  return breakWindow(tx,ty,dmg,src);
  return false;
}
function breakWindow(tx,ty,dmg,src){
  const i=idx(tx,ty);
  if(G.winHP[i]<=0) G.winHP[i]=WIN_MAX;
  G.winHP[i]-=dmg;
  spark(cx_of(tx),cy_of(ty),'#bfe6ff',3);
  if(G.winHP[i]<=0){
    G.winHP[i]=0; G.baseDirty=true;
    G.map[i]=EMPTY;                          // 窗被砸穿 → 变成可通行的缺口
    burst(cx_of(tx),cy_of(ty),'#9fd8ff',14);
    pushFeed(src.name+' '+src.label+' 砸穿了窗',src.team);
  }
  return true;
}
/* 卡住时用：找身边任意方向最近的可破坏结构（不限朝向） */
function nearestBreakableAny(u){
  const R=Math.ceil(BREAK_SCAN/TILE);
  const ctx=(u.x/TILE)|0, cty=(u.y/TILE)|0;
  let best=null, bs=1e9;
  for(let gy=cty-R;gy<=cty+R;gy++){
    for(let gx=ctx-R;gx<=ctx+R;gx++){
      if(!inB(gx,gy)) continue;
      const t=G.map[idx(gx,gy)];
      const isDoor=(t===DOOR&&G.doorHP[idx(gx,gy)]>0);
      const isWin =(t===WIN&&G.winHP[idx(gx,gy)]>0);
      if(!isDoor&&!isWin) continue;
      const od=Math.hypot(cx_of(gx)-u.x,cy_of(gy)-u.y);
      if(od>BREAK_SCAN*1.2) continue;
      const score=od+(isWin?TILE*0.8:0);
      if(score<bs){ bs=score; best={tx:gx,ty:gy,dist:od,isWin:isWin}; }
    }
  }
  return best;
}
/* 找「值得砸开」的结构：位于自己与目标之间、且就在附近的那一格。
   返回 {tx,ty,dist} 或 null。
   判定要点：
     · 门（关着）与窗都能砸；墙不行（墙不可破坏）
     · 只砸「朝向目标那一侧」的，避免僵尸乱砸身后的墙 */
function nearestBreakable(u,target){
  if(!target) return null;
  const dx=target.x-u.x, dy=target.y-u.y;
  const dist=Math.hypot(dx,dy);
  if(dist<1) return null;
  const ux=dx/dist, uy=dy/dist;
  /* 扫描自己周围几格，找朝目标方向、且离得最近的可破坏结构 */
  const R=Math.ceil(BREAK_SCAN/TILE);
  const ctx=(u.x/TILE)|0, cty=(u.y/TILE)|0;
  let best=null, bs=1e9;
  for(let gy=cty-R;gy<=cty+R;gy++){
    for(let gx=ctx-R;gx<=ctx+R;gx++){
      if(!inB(gx,gy)) continue;
      const t=G.map[idx(gx,gy)];
      const isDoor=(t===DOOR&&G.doorHP[idx(gx,gy)]>0);
      const isWin =(t===WIN&&G.winHP[idx(gx,gy)]>0);
      if(!isDoor&&!isWin) continue;
      const bx=cx_of(gx), by=cy_of(gy);
      const ox=bx-u.x, oy=by-u.y;
      const od=Math.hypot(ox,oy);
      if(od>BREAK_SCAN) continue;
      /* 必须大致在「朝向目标」的方向上（点积 > 0），否则会砸身后的结构 */
      if(od>1e-3 && (ox/od)*ux+(oy/od)*uy < BREAK_ARC_COS) continue;
      /* 优先级：门优先于窗（门砸开就是通道），其次看距离 */
      const score=od + (isWin?TILE*0.8:0);
      if(score<bs){ bs=score; best={tx:gx,ty:gy,dist:od,isWin:isWin}; }
    }
  }
  return best;
}

/* ---------------- 撤离模式（学 EP20「救援小队 vs 无尽尸潮」） ----------------
   玩法：地图上散布若干被困平民（civilian 兵种，但归中立/人类方），
   人类队伍要深入把他们带回「撤离区」；每带进一个算救出 1 人。
   平民会主动跟着最近的护送者走，被僵尸咬到也会被感染 → 双重压力。 */
const ESCORT_MAX=1;            // 每个护送者最多带几个平民（避免一堆人抢一个）
const CIV_FOLLOW_R=220;        // 平民主动跟随护送者的半径
const CIV_ZONE_R=TILE*1.6;     // 撤离区判定半径
const ESCORT_NEAR=64;          // 护送者要离平民多近才算「接管」
const CIV_FLEE_R=96;           // 平民察觉到僵尸的距离（求生本能）
const CIV_FLEE_T=1.4;          // 逃跑状态维持时间（避免抖动）
/* 找离平民最近、且还没带满人的护送者 */
function nearestEscort(c){
  let best=null,bd=CIV_FOLLOW_R;
  forEachNear(c.x,c.y,a=>{
    if(!a.alive||a.kind!=='h') return;
    if(a.cls==='civilian') return;                 // 平民不护送平民
    if((a.escortN||0)>=ESCORT_MAX) return;
    const d=Math.hypot(a.x-c.x,a.y-c.y);
    if(d<bd){ bd=d; best=a; }
  },CIV_FOLLOW_R);
  return best;
}
/* 每 tick 推进撤离逻辑 */
function stepMission(dt){
  const m=G.mission; if(!m||!m.on) return;
  let saved=0,left=0,escorting=0;
  for(const c of m.civs){
    if(c.extracted) continue;                    // 已撤离（已从地图移除）
    if(!c.alive) continue;                       // 死在路上
    /* ★ 撤离 = 直接离开：进入撤离区就被移出战场，不再是地图上的一个单位。
       之前只是打个 saved 标记、人还留在场上，看起来「救了但没走」。 */
    if(m.zone&&Math.hypot(c.x-m.zone.x,c.y-m.zone.y)<=CIV_ZONE_R){
      c.extracted=true;
      c.saved=true;
      c.alive=false;                              // 从战斗逻辑里彻底移除
      saved++;
      m.extractedList.push(c.label);
      burst(c.x,c.y,'#7dffa8',22);
      burst(c.x,c.y,'#c9ffe0',12);
      sfx('heal',c.x,c.y);
      pushFeed('平民 '+c.label+' 已登车撤离，离开战场','i');
      continue;
    }
    /* ★ 求生本能：附近有僵尸就**先跑**（优先级高于一切）。
       真实平民不会站着等死 —— 之前他们只会傻等护送者或直线走向撤离区，
       结果在城市街道上被僵尸成批咬死（8 人里死 6~7 个）。
       现在：有威胁就先远离，安全了再继续往撤离区走。 */
    const foe=nearestFoeZombie(c,CIV_FLEE_R);
    if(foe){
      const ddx=c.x-foe.x, ddy=c.y-foe.y;
      const fl=Math.hypot(ddx,ddy)||1;
      c.fleeT=CIV_FLEE_T;
      steer(c,ddx/fl,ddy/fl,dt,1.15);
      escorting++;
      continue;
    }
    if(c.fleeT>0) c.fleeT-=dt;
    /* 找护送者并跟随 */
    const esc=nearestEscort(c);
    if(esc){
      c.escort=esc;
      if((esc.escortN||0)<ESCORT_MAX&&!c.claimed){ c.claimed=true; esc.escortN=(esc.escortN||0)+1; }
      /* ★ 一旦被接管，平民就直接**寻路去撤离区**，而不是傻跟着护送者。
         原因是城市迷宫里有大量墙体与转角：直接朝护送者「直线走」
         会卡在墙角（实测 84 秒里 0 人撤离成功）。
         改成 A* 自己找路，护送者的作用变成「激活 + 掩护」。 */
      if(c.claimed&&m.zone){
        c.pathT=(c.pathT||0)-dt;
        if(!c.path||c.pathT<=0||c.pathGoal!=='z'){
          c.pathT=1.2+Math.random()*0.6; c.pathGoal='z';
          c.path=findPath(c,m.zone.x,m.zone.y,c.kind);
        }
        if(!followPath(c,dt,1)) steer(c,m.zone.x-c.x,m.zone.y-c.y,dt,1);
        escorting++;
        continue;
      }
      const dd=Math.hypot(esc.x-c.x,esc.y-c.y);
      if(dd>ESCORT_NEAR){
        steer(c,esc.x-c.x,esc.y-c.y,dt,1);
        escorting++;
        continue;
      }
      escorting++;
    } else {
      c.escort=null;
    }
    /* 没有护送者：原地小幅游走，但不乱跑（等着被接） */
    steer(c,0,0,dt);
  }
  /* ★ 必须**按 civs 重新统计**，不能用本帧的局部计数器回写。
     之前写成 m.saved=saved，而 saved 只记录「本帧新撤离的人数」，
     于是没有新撤离的帧就把累计值清成 0 —— 明明撤走了 6 个人，
     界面却一直显示 0。 */
  m.saved=m.civs.filter(c=>c.extracted).length;
  m.escorting=escorting;
  m.left=m.civs.filter(c=>c.alive&&!c.extracted).length;
  m.lost=m.civs.filter(c=>!c.alive&&!c.extracted).length;
}
/* 全部有结果（撤离成功或已牺牲）就算任务结束 */
function missionComplete(){
  const m=G.mission;
  if(!m||!m.on) return false;
  return m.civs.length>0 && m.civs.every(c=>c.extracted||!c.alive);
}

/* ---------------- 刷怪点（学 EP23/EP24 的「第 N/M 波」） ----------------
   与「僵尸轮次(waves)」的区别：轮次决定「什么时候、放什么」，
   刷怪点决定「从哪里出来」。开启后僵尸从洞口涌出，而不是摆在出生区。 */
function spawnerEmit(sp,n,cls,team){
  const made=[];
  for(let i=0;i<n;i++){
    const spot=freeSpotAround(sp.x,sp.y,sp.r||34,'z');
    if(!spot) break;
    const u=makeUnit(cls||'zombie',team,spot.x,spot.y,G.counter++);
    u.spawnT=0.7; u.prevX=u.x; u.prevY=u.y;
    G.units.push(u);
    made.push(u);
    spark(spot.x,spot.y,'#d9a4ff',8);
  }
  return made;
}
/* 按「兵种清单」批量投放（每个条目自带落点）。
   用于 QB.autoWave 这类按人类实力生成的混合波次。 */
function spawnerEmitMix(list){
  const made=[];
  for(const it of (list||[])){
    const spot=freeSpotAround(it.x,it.y,40,'z');
    if(!spot) continue;
    const u=makeUnit(it.cls||'zombie', it.team===undefined?1:it.team, spot.x, spot.y, G.counter++);
    u.spawnT=0.7; u.prevX=u.x; u.prevY=u.y;
    G.units.push(u);
    made.push(u);
    spark(spot.x,spot.y,'#d9a4ff',8);
  }
  return made;
}
/* 在编辑好的地图上按尺寸取几个默认刷怪点（角落 + 中轴两侧）。
   ★ 若玩家在地图上点过「僵尸刷怪点」，优先用玩家的。 */
function defaultSpawners(){
  const cs=customSpawnersOf();
  if(cs&&cs.length){
    return cs.map((s,i)=>({x:s.x,y:s.y,r:s.r||40,name:s.name||('洞口'+(i+1))}));
  }
  const out=[];
  const m=SIZE_MAP[MSIZE]||{};
  out.push({x:cx_of(2),y:cy_of(2),r:34,name:'西北洞口'});
  out.push({x:cx_of(GW-3),y:cy_of(2),r:34,name:'东北洞口'});
  out.push({x:cx_of(2),y:cy_of(GH-3),r:34,name:'西南洞口'});
  out.push({x:cx_of(GW-3),y:cy_of(GH-3),r:34,name:'东南洞口'});
  return out;
}

/* ---------------- 感染 / 治疗 / 伤害 ---------------- */
function infect(u,srcTeam){
  if(!u.alive||u.kind!=='h') return false;
  const first=u.infect<=0;
  u.infect=INFECT_TIME;                      // 每次被咬都刷新窗口
  u.infectFx=0.5;
  if(srcTeam!==undefined&&srcTeam!==null) u.infectFrom=srcTeam;
  if(first){
    G.infections++;
    sfx('infect',u.x,u.y);
    pushFeed(u.label+' 被感染，'+INFECT_TIME.toFixed(0)+' 秒后尸变','i');
  }
  return true;
}
function cure(u){
  if(u.infect>0){ u.infect=0; u.infectFx=0.6; spark(u.x,u.y,'#c9ffe0',8); sfx('heal',u.x,u.y); return true; }
  return false;
}
/* 盾牌是否挡住了来自 src 的这次攻击。
   与 shieldMitigate 共用同一套方向判定，保证「免伤」和「免感染」永远一致。 */
function shieldFrontal(u,src){
  if(u.cls!=='shieldman') return false;
  if(!src||src.x===undefined) return true;         // 来源不明：按正面算
  const a=Math.atan2(src.y-u.y,src.x-u.x);
  const dir=(u.shieldDir!==undefined?u.shieldDir:u.aim);
  const diff=Math.atan2(Math.sin(a-dir),Math.cos(a-dir));
  return Math.abs(diff)<=SHIELD_ARC;
}
/* 盾牌挡住攻击时的视觉反馈：正面溅出火星 + 记一次「格挡」 */
function shieldBlocked(defender,attacker){
  if(!defender||defender.cls!=='shieldman') return false;
  return shieldFrontal(defender,attacker);
}
function shieldSpark(defender,attacker){
  const a=Math.atan2(attacker.y-defender.y,attacker.x-defender.x);
  const r=defender.radius*1.7;
  const bx=defender.x+Math.cos(a)*r, by=defender.y+Math.sin(a)*r;
  spark(bx,by,'#dbe9ff',8);
  spark(bx,by,'#8fd0ff',4);
  defender.shieldHitFx=0.25;
  defender.blockedN=(defender.blockedN||0)+1;
  sfx('bash',bx,by);
}
/* 盾牌减伤：按「攻击来自哪个方向」决定。
   正面（盾牌朝向 ±SHIELD_ARC 内）→ 完全免疫（SHIELD_IMMUNE）。
   其余方向只吃 SHIELD_DR_SIDE 的护具减伤。非盾卫不受影响。 */
function shieldMitigate(u,amt,src){
  if(u.cls!=='shieldman'||!amt) return amt;
  if(shieldFrontal(u,src)) return SHIELD_IMMUNE?0:amt*(1-0.55);
  return amt*(1-SHIELD_DR_SIDE);
}
function damage(u,amt,src){
  if(!u.alive) return;
  amt=shieldMitigate(u,amt,src);
  u.hp-=amt; u.hitFlash=0.14;
  u.hurtT=SHIELD_HIT_WINDOW;                 // 盾卫「最近有没有挨打」判定窗口
  spark(u.x,u.y,u.kind==='h'?'#ff9d9d':'#9dffb0', amt>30?6:3);
  /* 受伤反馈：★ 只用「沉闷的命中声」，不再播真人惨叫。
     原因：战场上几十个单位同时受伤，真人痛呼会此起彼伏连成一片，
     既盖住枪声、又非常出戏（用户反馈「不现实感很强」）。
     真人惨叫只在**阵亡**时小概率出现一次，反而更有分量。 */
  /* ★ 命中反馈重做（用户反馈「游戏感 / 不现实感很强」）：
     旧做法是**每次受伤**都播一个肉响，实测 20 秒触发 245 次、
     占全部音效的三分之二 —— 既盖住枪声，又像在敲鼓，非常出戏。
     现在三条限制：
       ① 只有较重伤害（>=18）才反馈
       ② 冷却拉长到 0.18 秒（原来 0.05）
       ③ 走独立的 hit 总线（音量仅 0.30），退到枪声之下当「打中了」的暗示 */
  if(amt>=18) sfx('zhit',u.x,u.y);
  if(u.hp<=0) killUnit(u,src);
}
/* ---------------- 范围爆炸（唯一实现） ----------------
   大胃袋死亡爆裂 / 火箭弹 / 手雷 全部复用这一套。
   opts.falloff：按距离线性衰减到 0；opts.infect：波及人类型单位的感染概率。
   src 可为单位，也可传 {team:队伍号,name:...}，用于击杀归属。 */
/* 爆炸特效：冲击波环 + 闪白 + 火星 + 焦痕。
   ★ 之前范围伤害只有几十个粒子，在密集场面里几乎看不见，
     玩家根本分不清「哪里炸了、范围多大」。现在用多层视觉表达：
       ① 扩散的冲击波圆环（外圈）—— 一眼看出半径
       ② 中心闪白（内圈实心）—— 强调爆心
       ③ 大量火星粒子 + 烟尘
       ④ 地面焦痕（持续几秒淡出）—— 留下打击痕迹 */
function blastFx(x,y,r,color){
  color=color||'#ffb347';
  G.shocks.push({x:x,y:y,r0:r*0.15,r1:r*1.25,t:0,dur:0.45,color:color});
  G.shocks.push({x:x,y:y,r0:r*0.35,r1:r*0.95,t:0,dur:0.30,color:'#fff3d0'});
  G.scorches.push({x:x,y:y,r:r*0.85,t:0,max:7.0});
  if(G.scorches.length>90) G.scorches.shift();
  burst(x,y,color,34);
  burst(x,y,'#ffe9b0',20);
  spark(x,y,'#ffffff',18);
}
function areaBlast(x,y,r,dmg,src,opts){
  opts=opts||{};
  const team=(src&&src.team!==undefined)?src.team:null;
  const infectP=opts.infect||0;
  sfx('explode',x,y);
  blastFx(x,y,r,opts.color||'#ffb347');
  for(const o of G.units){
    if(!o.alive) continue;
    if(team!==null&&o.team===team) continue;         // 不误伤友军
    const dd=Math.hypot(o.x-x,o.y-y);
    if(dd>r) continue;
    let amt=dmg;
    if(opts.falloff) amt=dmg*clamp(1-dd/(r*1.15),0.35,1);   // 离爆心越远越轻，但不低于 35%
    damage(o,amt,src);
    if(o.alive&&o.kind==='h'&&infectP>0&&rnd()<infectP) infect(o,team);
  }
}
/* 冲击波 / 焦痕的推进与回收 */
function stepFx(dt){
  for(let i=G.shocks.length-1;i>=0;i--){
    const s=G.shocks[i]; s.t+=dt;
    if(s.t>=s.dur) G.shocks.splice(i,1);
  }
  for(let i=G.scorches.length-1;i>=0;i--){
    const s=G.scorches[i]; s.t+=dt;
    if(s.t>=s.max) G.scorches.splice(i,1);
  }
}
function deathBurst(u){
  const d=CLASSES[u.cls], b=d.deathBurst;
  if(!b||u.bursted) return;
  u.bursted=true;
  burst(u.x,u.y,'#d8c15a',26);
  spark(u.x,u.y,'#ffe9a0',14);
  areaBlast(u.x,u.y,b.r,b.dmg,u,{infect:b.infect});
  pushFeed(u.name+' '+u.label+' 胃袋爆裂，波及周围 '+Math.round(b.r)+' px','i');
}
/* ---------------- 灼烧（第①项：喷火兵） ----------------
   设计确认：可刷新时长、不叠加 —— 重复命中只把剩余时间重置为 BURN_TIME，不叠层。
   注意：灼烧是物理效果，人类型与僵尸型都会被点燃
   （不能照抄 infect() 的 kind==='h' 判定，否则喷火兵对僵尸完全无效）。 */
function ignite(u,srcTeam){
  if(!u.alive) return false;
  const first=!(u.burnT>0);
  if(BURN_REFRESH) u.burnT=BURN_TIME;
  else u.burnT=Math.min(BURN_TIME*3,(u.burnT||0)+BURN_TIME);
  u.burnFx=0.4;
  if(srcTeam!==undefined&&srcTeam!==null) u.burnFrom=srcTeam;
  if(first) u.burnTick=0;
  return true;
}
/* 每 tick 扣血。独立成一轮，和治疗/感染一样放在所有单位行动之后。 */
function stepBurns(dt){
  for(const u of G.units){
    if(!u.alive||!(u.burnT>0)) continue;
    u.burnT-=dt;
    u.burnFx=Math.max(u.burnFx||0,0.12);
    u.burnTick=(u.burnTick||0)+dt;
    if(u.burnTick>=0.25){                              // 每 0.25 秒结算一次，视觉上连续掉血
      u.burnTick-=0.25;
      const src=u.burnFrom===undefined?null:{team:u.burnFrom};
      damage(u,BURN_DPS*0.25,src);
      /* 被点燃时的噼啪声（严格限流，否则大群着火会刷屏） */
      if(G.burnSfxT===undefined||(G.time||0)-G.burnSfxT>0.7){
        G.burnSfxT=(G.time||0); sfx('burnDmg',u.x,u.y);
      }
    }
    if(u.burnT<=0){ u.burnT=0; u.burnTick=0; }
  }
}
function killUnit(u,src){
  u.alive=false; u.hp=0; gridMarkDirty();
  if(CLASSES[u.cls].deathBurst) deathBurst(u);
  G.selected.delete(u.id);
  G.corpses.push({x:u.x,y:u.y,r:u.radius,color:u.color,t:0,sq:u.kind==='z',tc:teamColor(u.team)});
  if(G.corpses.length>260) G.corpses.shift();
  burst(u.x,u.y,u.color,16);
  /* 阵亡音：僵尸哀嚎；人类 30% 概率发出惨叫（其余用倒地闷响，避免满场惨叫） */
  if(u.kind==='z'){
    if(G.zDieT===undefined||(G.time||0)-G.zDieT>0.4){ G.zDieT=(G.time||0); sfx('zombieDie',u.x,u.y); }
  } else {
    if(G.hDieT===undefined||(G.time||0)-G.hDieT>0.5){
      G.hDieT=(G.time||0);
      if(rnd()<0.30) sfx('humanDeath',u.x,u.y); else sfx('zhit',u.x,u.y);
    }
  }
  if(src&&src.alive!==false&&src.team!==undefined&&src.team!==u.team){
    src.kills++; G.kills[src.team]=(G.kills[src.team]||0)+1;
    G.stats.byClass[src.name]=(G.stats.byClass[src.name]||0)+1;
    pushFeed(src.name+' '+src.label+' 击杀 '+u.name+' '+u.label, src.team);
    /* ★ 击杀反馈音（只对玩家指挥的队伍播，且限流防止刷屏）
       3 秒内再次击杀算连杀，播放「连杀」播报。 */
    if(src.team===0){
      const now=(G.time||0);
      if(G.killSfxT===undefined||now-G.killSfxT>0.25){
        G.killSfxT=now;
        if(now-(G.lastKillT||-99)<3.0){
          G.killStreak=(G.killStreak||1)+1;
          if(G.killStreak>=3) sfx('killMulti',0,0); else sfx('kill',0,0);
        } else { G.killStreak=1; sfx('kill',0,0); }
        G.lastKillT=now;
      }
    }
  } else {
    pushFeed('环境击杀 '+u.name+' '+u.label, u.team);
  }
}
/* 尸变：变成僵尸并倒戈加入「咬它的那一方」 */
function convertUnit(u,tid){
  const d=CLASSES.zombie;
  u.kind='z'; u.cls='zombie'; u.num=d.num; u.name=d.name; u.color=d.color; u.role=d.role;
  if(tid!==undefined&&tid!==null&&tid!==u.team&&G.units.some(x=>x.team===tid)) u.team=tid;
  u.teamNum=u.team+1;
  u.maxHp=d.hp;
  /* 继承血量：超临界模式下给得更多（PLAGUE_ON），
     否则新僵尸刚站起来就被旁边的人秒掉，R0 被压到 1 以下、永远爆不起来。 */
  u.hp=Math.round(d.hp*(PLAGUE_ON?ZOMBIE_FRESH_HP:ZOMBIE_FRESH));
  u.radius=d.radius;
  u.aim=rnd()*TAU; u.path=null; u.pathGoal=-1; u.pathT=0; u.infect=0;
  /* 尸变后短暂僵直：rouseT 期间不行动，视觉上也更像「爬起来」 */
  u.rouseT=PLAGUE_ON?ZOMBIE_ROUSE:0;
  u.spawnT=0.45; u.cd=0.5; u.beamTo=null; u.healCd=0; u.rateMul=1; u.aura=0;
  u.vx=u.vy=0; u.label=teams[u.team].name+'#尸变'+u.id;
  u.magLeft=0; u.reloadT=0; u.reloadFx=0; u.bursted=false;
  u.behavior=null; u.dispatch=null; u.cover=null; u.coverT=0;
  G.selected.delete(u.id);
  G.converted++;
  ensureFree(u);
  burst(u.x,u.y,'#c07aff',20);
  sfx('convert',u.x,u.y);
  pushFeed(u.label+' 感染发作，尸变加入'+teams[u.team].name, u.team);
}

/* ---------------- 开火 ---------------- */
function fireWith(u,g,mul){
  const n=g.pellets||1;
  const d=CLASSES[u.cls]||{};
  /* 火箭兵：发射独立投射物，而不是普通子弹 */
  if(d.rocket||g.rocket){
    fireRocket(u,g);
    u.flash=0.09; u.gunFlash=0.09;
    return;
  }
  for(let i=0;i<n;i++){
    const a=u.aim+(rnd()*2-1)*(g.spread||0);
    const isBurn=!!(d.burn||g.burn);
    /* 喷火兵：登记一条「火舌」，由 drawJets 画成一条完整的线。
       子弹仍然照常生成（负责伤害与穿透），只是不再逐个绘制。 */
    if(isBurn){
      /* 持续火舌声：喷火间隔只有 0.12 秒，必须限流，
         否则同一个音一帧叠十几遍会变成噪音墙。 */
      if(G.flameSfxT===undefined||(G.time||0)-G.flameSfxT>0.10){
        G.flameSfxT=(G.time||0);
        sfx('flame',u.x,u.y);
      }
      const maxLen=(d.range||g.range||120);
      if(!G.jets) G.jets=[];
      G.jets.push({
        x:u.x+Math.cos(u.aim)*u.radius, y:u.y+Math.sin(u.aim)*u.radius,
        ang:u.aim, len:flameEnd(u.x,u.y,u.aim,maxLen),
        t:0.11, max:0.11, seed:rnd()*TAU,
      });
      if(G.jets.length>140) G.jets.shift();      // 上限保护
    }
    G.bullets.push({
      x:u.x+Math.cos(u.aim)*u.radius, y:u.y+Math.sin(u.aim)*u.radius,
      vx:Math.cos(a)*g.bspeed, vy:Math.sin(a)*g.bspeed,
      dmg:g.dmg, base:g.dmg, team:u.team, pierce:g.pierce||0, hits:0,
      pierceMul:g.pierceMul||0, suppress:!!g.suppress, burn:isBurn,
      color:u.color,
      life:isBurn?0.30:1.3, last:null, owner:u,
      len:isBurn?0:(g.long?20:9), w:isBurn?1.0:(g.long?2.6:1.5)
    });
  }
  u.flash=0.07;
}
/* ---------------- 火箭弹（第②项） ----------------
   设计确认：命中敌人或墙壁立即爆炸；打空则飞到最大射程自爆。 */
function fireRocket(u,g){
  sfx('rocket',u.x,u.y);                     // RPG 发射（3 变体随机）
  const range=(CLASSES[u.cls].range)||g.range||380;
  G.bullets.push({
    x:u.x+Math.cos(u.aim)*u.radius*1.2, y:u.y+Math.sin(u.aim)*u.radius*1.2,
    vx:Math.cos(u.aim)*g.bspeed, vy:Math.sin(u.aim)*g.bspeed,
    dmg:g.dmg, base:g.dmg, team:u.team, pierce:0, hits:0, pierceMul:0,
    color:'#ff9a5c', life:range/Math.max(1,g.bspeed)+0.05, last:null, owner:u,
    len:14, w:3.4, rocket:{r:ROCKET_R,dmg:ROCKET_DMG}, travelled:0, maxDist:range
  });
}
/* ---------------- 手雷（第③项：步兵投掷） ----------------
   抛物线：记录起终点与飞行时间，按 vt-0.5*g*t^2 的弧线绘制，落地即爆。 */
function throwGrenade(u,tx,ty){
  const d=CLASSES[u.cls];
  const dist=Math.hypot(tx-u.x,ty-u.y);
  const flight=clamp(0.42+dist/620,0.42,1.5);
  G.grenades=G.grenades||[];
  G.grenades.push({
    x:u.x, y:u.y, x0:u.x, y0:u.y, x1:tx, y1:ty,
    t:0, flight:flight, owner:u, team:u.team,
    r:GRENADE_R, dmg:GRENADE_DMG, spin:rnd()*TAU
  });
  u.throwT=0.45; u.throwing=0.45;
  u.throwCd=GRENADE_CD*(0.85+rnd()*0.3);
  u.flash=0.06;
}
function stepGrenades(dt){
  const gs=G.grenades;
  if(!gs||!gs.length) return;
  for(let i=gs.length-1;i>=0;i--){
    const g=gs[i];
    g.t+=dt;
    const k=clamp(g.t/g.flight,0,1);
    g.x=g.x0+(g.x1-g.x0)*k;
    g.y=g.y0+(g.y1-g.y0)*k;
    if(k>=1){
      areaBlast(g.x1,g.y1,g.r,g.dmg,g.owner,{falloff:true});
      burst(g.x1,g.y1,'#ffd08a',20);
      spark(g.x1,g.y1,'#fff0c0',12);
      pushFeed((g.owner?g.owner.label:'')+' 手雷爆炸',g.team);
      gs.splice(i,1);
    }
  }
}
function stepBullets(dt){
  const bs=G.bullets;
  for(let i=bs.length-1;i>=0;i--){
    const b=bs[i]; b.life-=dt;
    if(b.life<=0){
      if(b.rocket) rocketBoom(b);                 // 打空 → 飞到最大射程自爆
      bs.splice(i,1); continue;
    }
    const dx=b.vx*dt, dy=b.vy*dt, dd=Math.hypot(dx,dy);
    const sub=Math.max(1,Math.ceil(dd/6));
    let dead=false;
    for(let s=0;s<sub&&!dead;s++){
      b.x+=dx/sub; b.y+=dy/sub;
      if(b.rocket) b.travelled=(b.travelled||0)+dd/sub;
      const tx=(b.x/TILE)|0, ty=(b.y/TILE)|0;
      if(!inB(tx,ty)){ if(b.rocket) rocketBoom(b); dead=true; break; }
      if(blocksBullet(G.map[idx(tx,ty)],tx,ty)){
        if(b.rocket) rocketBoom(b); else spark(b.x,b.y,'#c8d6ea',3);
        dead=true; break;
      }
      for(const u of G.units){
        if(!u.alive||u.team===b.team||u===b.last) continue;
        if(Math.hypot(u.x-b.x,u.y-b.y)<u.radius+HIT_PAD){
          if(b.rocket){ rocketBoom(b); dead=true; break; }   // 命中即爆
          damage(u,b.dmg,b.owner);
          if(b.suppress) u.slowT=0.55;
          if(b.burn) ignite(u,b.team);                 // 喷火兵：穿过的每个敌人都会被点燃
          if(b.pierceMul&&b.pierceMul!==1){
            b.dmg*=b.pierceMul;                       // 每穿一个人伤害打折
            for(let q=0;q<3;q++) spark(u.x,u.y,'#9fd8ff',2);
          }
          b.hits++; b.last=u;
          if(b.pierce>=0&&b.hits>b.pierce) dead=true;  // pierce<0 = 无限穿透
          break;
        }
      }
    }
    if(dead) bs.splice(i,1);
  }
}
function rocketBoom(b){
  if(b.boomed) return;
  b.boomed=true;
  areaBlast(b.x,b.y,b.rocket.r,b.rocket.dmg,b.owner,{falloff:true});
  burst(b.x,b.y,'#ff9a5c',26);
  spark(b.x,b.y,'#ffe0a0',16);
  pushFeed((b.owner?b.owner.label:'火箭')+' 火箭弹爆炸',b.team);
}

/* ---------------- 动作音效（零依赖：WebAudio 现场合成，不加载任何音频文件） ----------------
   设计要点：
   1. 绝不引入外部资源 —— 构建脚本会拒绝 src=/href= 外链，所以声音必须用振荡器合成。
   2. 无头环境（_test.js 的 vm 沙箱）没有 AudioContext，全部降级为空操作。
   3. 同帧同类音效合并 + 全局节流，避免几十个单位同时开火造成的爆音与性能塌陷。 */
const SFX_ON_DEFAULT=true;
let sfxEnabled=SFX_ON_DEFAULT;
let actx=null, sfxMaster=null, sfxFailed=false;
const SFX_VOICES={};    // 每个音效类型的冷却计时
let sfxBudget=0;        // 每帧允许播出的音效数量（防爆音）

/* ================= 音频总线架构 =================
   ★ 之前所有声音（枪声 / 惨叫 / 僵尸吼 / 音乐）全部接在同一个 gain 上，
     谁也压不住谁 —— 几十个单位一开火，枪声就被惨叫和怒吼淹没了
     （用户反馈「枪械声音太容易被掩盖」）。
   现在分四条总线，各自有独立的音量与动态处理：

     weapon  ← 枪声、上膛、爆炸    : 最响，且加压缩器保持「冲击力」
     voice   ← 人声、僵尸吼、播报  : 中等，避免盖过枪声
     world   ← 脚步、砸门、燃烧     : 较轻
     music   ← 背景乐              : 最轻，并被「枪声闪避」压低

   母线上再挂一级压缩器（DynamicsCompressor），
   多个枪声同时响时自动压制，避免整体削波糊成一团。 */
let busWeapon=null, busVoice=null, busZombie=null, busWorld=null, busHit=null, busMusic=null, masterComp=null;
let duckT=0;                    // 音乐闪避剩余时间
function buildBuses(){
  if(!actx||busWeapon) return;
  try{
    /* ★ 母线压缩器改成「只削峰、不压动态」的限幅器。
       原因（用户反馈「枪声和僵尸音效互相挤占」）：
       原来 threshold=-16 / ratio=4 是**中等压缩**，而它挂在所有总线的汇合点 ——
       一排枪响把母线电平推高，压缩器立刻整体下压，
       **连僵尸的嘶吼一起被压下去**，听感就是「两边互相挤」。
       现在 threshold 抬到 -4dB、ratio 降到 12，只在接近削波时才动作，
       正常战斗电平时几乎透明，各总线之间不再互相影响。 */
    masterComp=actx.createDynamicsCompressor();
    masterComp.threshold.value=-4;
    masterComp.knee.value=6;
    masterComp.ratio.value=12;
    masterComp.attack.value=0.002;
    masterComp.release.value=0.12;
    sfxMaster=actx.createGain();
    sfxMaster.gain.value=0.55;
    masterComp.connect(sfxMaster);
    sfxMaster.connect(actx.destination);

    const mk=function(vol,comp){
      const g=actx.createGain();
      g.gain.value=vol;
      if(comp){
        const c=actx.createDynamicsCompressor();
        c.threshold.value=comp.threshold;
        c.knee.value=comp.knee;
        c.ratio.value=comp.ratio;
        c.attack.value=comp.attack;
        c.release.value=comp.release;
        g.connect(c); c.connect(masterComp);
      } else {
        g.connect(masterComp);
      }
      return g;
    };
    /* 武器：最响，且几乎不压缩 —— 枪声必须是混音的主角。
       ★ 之前给武器也挂了压缩器（threshold -14 / ratio 3），
         几十人开火时枪声被压得又平又软，再加上其他音效抢注意力，
         主观上就像「枪声丢了」。武器这一路现在只做极轻的限幅防削波。 */
    busWeapon=mk(1.35,{threshold:-3,knee:0,ratio:20,attack:0.001,release:0.08});
    /* ★ 僵尸音效单独一条总线（原来和人声共用 voice）。
       用户反馈「枪声和僵尸音效互相挤占」：
       僵尸嚎叫本来就低沉、能量集中在中低频，和枪声的瞬态抢同一频段；
       再和人声（痛呼、阵亡）挤在一条总线上互相压制，听感就糊了。
       拆出来之后 zombie 可以独立调音量与压缩，不再和人声抢。 */
    busZombie=mk(0.34,{threshold:-20,knee:12,ratio:5,attack:0.006,release:0.30});
    /* 人声（痛呼 / 阵亡）：低频少、更容易穿出来，音量再压低一点 */
    busVoice =mk(0.18,{threshold:-22,knee:14,ratio:8,attack:0.004,release:0.25});
    /* 环境 / 机械：更轻 */
    busWorld =mk(0.40,null);
    /* 命中反馈：最轻的一路 —— 它是「暗示」而不是「主角」，
       必须明显低于枪声，否则会盖住武器音（用户反馈的核心问题）。 */
    busHit   =mk(0.16,null);
    /* 音乐：独立，可被闪避 */
    busMusic =mk(1.00,null);
  }catch(e){ /* 建立失败则退回单总线 */ }
}
/* 音乐闪避：开火 / 爆炸时把音乐压下去，让枪声透出来。
   ★ 必须做「触发节流」：机枪 0.1 秒一发，如果每次开火都重新排一次
      ramp，增益会被反复 cancel + 重排，听感上是持续的抽气声（pumping）。
     现在 0.25 秒内只触发一次，且用更长的恢复时间让它平滑。 */
let lastDuck=0;
function musicDuck(amount,time){
  if(!busMusic||!actx) return;
  try{
    const t=actx.currentTime;
    if(t-lastDuck<0.25) return;          // 节流：250ms 内只闪避一次
    lastDuck=t;
    const g=busMusic.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value,t);
    g.linearRampToValueAtTime(Math.max(0.25,1-amount),t+0.05);
    g.linearRampToValueAtTime(1,t+(time||0.5));
  }catch(e){}
}
function sfxInit(){
  if(actx||sfxFailed) return actx;
  try{
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC){ sfxFailed=true; return null; }
    actx=new AC();
    buildBuses();
    if(!sfxMaster){                       // 兜底：压缩器建立失败
      sfxMaster=actx.createGain();
      sfxMaster.gain.value=0.32;
      sfxMaster.connect(actx.destination);
    }
  }catch(e){ sfxFailed=true; actx=null; }
  return actx;
}
/* 每个音效属于哪条总线 */
/* ★ 音效 → 总线映射。**必须覆盖 SFX_RECIPES 里的每一个键**，
   否则该音效会退回 master 总线，绕开这一路的压缩与音量控制
   （上一版就漏了 rifle / kill_confirm / zhit / zombieCall，
   导致步枪声和击杀播报不受总线控制、音量失衡）。
   注意键名要和配方表一致：配方里用 `rifle`，不是 `shoot`。 */
const SFX_BUS={
  /* 武器：最响，走压缩器 */
  rifle:'weapon', shoot:'weapon', sniper:'weapon', mg:'weapon', shotgun:'weapon',
  shot:'weapon', pistol:'weapon', flamer:'weapon', rocket:'weapon', flame:'weapon',
  flameIgnite:'weapon', rocketFly:'weapon', explode:'weapon', grenFire:'weapon',
  grenBeep:'weapon', grenade:'weapon', grenexp:'weapon', launch:'weapon', gl:'weapon',
  boom:'weapon', boom2:'weapon', boom3:'weapon', rpg_fire:'weapon',
  pumpkin:'weapon', heavy:'weapon', dmr:'weapon', boltgun:'weapon',
  /* 环境 / 机械：轻 */
  melee:'world', melee2:'world', melee3:'world', melee4:'world',
  bash:'world', zhit:'hit', richochet:'world', woodbreak:'world',
  burnDmg:'world', burn:'world', reload:'world', switch:'world', empty:'world',
  minigun:'weapon', pump:'weapon',
  /* 人声：痛呼 / 阵亡（真人语音） */
  hurt:'voice', humanPain:'voice', humanDeath:'voice',
  infect:'voice', heal:'voice', convert:'voice',
  /* ★ 僵尸音效走**独立总线**，与枪声、人声三方互不挤占 */
  zombieCall:'zombie', zombieDie:'zombie', zombieGrowl:'zombie', groan:'zombie',
  zpain:'zombie',
  /* 击杀播报已删除（空实现，保留键避免漏映射兜底） */
  kill:'voice', killHead:'voice', killMulti:'voice', killFirst:'voice',
  throw:'world', click:'world',
};
function busFor(name){
  const b=SFX_BUS[name];
  if(b==='weapon') return busWeapon||sfxMaster;
  if(b==='voice')  return busVoice ||sfxMaster;
  if(b==='zombie') return busZombie||sfxMaster;
  if(b==='world')  return busWorld ||sfxMaster;
  if(b==='hit')    return busHit   ||busWorld||sfxMaster;
  /* 兜底：漏映射的音效归到 world，而不是绕开总线控制直接接 master
     （那会让音量失衡）。 */
  return busWorld||sfxMaster;
}
function sfxResume(){ const a=sfxInit(); decodeClips(); if(a&&a.state==='suspended'&&a.resume) a.resume(); }
/* ================= 真实向枪声合成器 =================
   为什么要这么写：真实枪声不是一个「音调」，而是**宽带噪声脉冲**经过
   枪管/枪机/环境滤波后的结果。用振荡器（sine/square）永远做不出枪声，
   听起来一定像电子玩具 —— 这是上一版最大的问题。

   真实枪声的物理结构（按时间顺序）：
     ① 起爆瞬态（0~2ms）：火药爆燃，极宽带、极陡峭的上升沿 ——
        这是「啪」的来源，必须是噪声脉冲而不是振荡器
     ② 枪口爆音（2~15ms）：高压气体冲出枪口，中低频"砰"
     ③ 机械声（5~40ms）：套筒/枪机往复，金属中高频
     ④ 环境尾音（30~300ms）：声波在建筑间反射，指数衰减的低通噪声

   实现要点：
     · 用 AudioBufferSourceNode 播放**自己生成的噪声 buffer**（不是振荡器）
     · 用 BiquadFilter 做频段塑形：highpass 出"脆"，lowpass 出"闷"
     · 用多段指数衰减包络（setValueCurveAtTime）模拟真实衰减曲线
     · 每个枪械一套参数（口径、枪管长、机械结构不同 → 音色不同） */
function noiseBuffer(dur){
  const n=Math.max(1,Math.floor(actx.sampleRate*dur));
  const buf=actx.createBuffer(1,n,actx.sampleRate);
  const ch=buf.getChannelData(0);
  /* 白噪声 + 轻微低频调制，比纯白噪声更接近爆燃的质感 */
  let last=0;
  for(let i=0;i<n;i++){
    const w=Math.random()*2-1;
    last=last*0.28+w*0.72;                  // 轻微低通，去掉过于刺耳的纯白
    ch[i]=last;
  }
  return buf;
}
/* 播放一段经过滤波与包络塑形的噪声。这是枪声的「骨架」。 */
function noiseHit(opt){
  if(!sfxEnabled||!actx) return;
  const t0=actx.currentTime+(opt.delay||0);
  try{
    const dur=opt.dur;
    const src=actx.createBufferSource();
    src.buffer=opt.buf||noiseBuffer(dur);
    /* 频段塑形：hp 出「脆」、lp 出「闷」、peaking 做金属共振 */
    const chain=[];
    if(opt.hp){ const f=actx.createBiquadFilter(); f.type='highpass'; f.frequency.value=opt.hp; f.Q.value=opt.hpQ||0.7; chain.push(f); }
    if(opt.peak){ const f=actx.createBiquadFilter(); f.type='peaking'; f.frequency.value=opt.peak; f.Q.value=opt.peakQ||2.5; f.gain.value=opt.peakG||6; chain.push(f); }
    if(opt.lp){ const f=actx.createBiquadFilter(); f.type='lowpass'; f.frequency.value=opt.lp; f.Q.value=opt.lpQ||0.7; chain.push(f); }
    const g=actx.createGain();
    /* 多层指数衰减：真实枪声不是单一 exp 曲线 —— 前段极陡、尾段拖长 */
    const peak=opt.vol;
    const curve=new Float32Array(24);
    for(let i=0;i<24;i++){
      const k=i/23;
      /* 前 12% 冲到峰值，之后按 1/(1+at)^2 衰减，模拟实测枪声包络 */
      const a=k<0.06? k/0.06 : Math.pow(1-(k-0.06)/0.94, opt.decay||2.4);
      curve[i]=Math.max(0.0001,peak*a);
    }
    g.gain.setValueCurveAtTime(curve,t0,dur);
    let node=src;
    for(const f of chain){ node.connect(f); node=f; }
    node.connect(g); g.connect(sfxMaster);
    src.start(t0); src.stop(t0+dur);
  }catch(e){ /* 静默降级 */ }
}
/* 枪声配方：每把枪 = 起爆瞬态 + 枪口爆音 + 机械声（可选）+ 尾音
   参数含义：hp/lowpass 决定「脆/闷」，decay 决定余音长短，vol 是响度。 */
const GUN_SHOTS={
  /* 手枪（医疗兵/盾卫）：短枪管、小口径 → 脆、短、机械声明显 */
  pistol:{layers:[
    {dur:0.055,hp:900,lp:9000,peak:3200,vol:0.42,decay:2.8},
    {dur:0.12,hp:120,lp:1400,vol:0.20,decay:3.2,delay:0.002},
    {dur:0.05,hp:2200,lp:7000,peak:4200,vol:0.07,decay:4.5,delay:0.030},
  ]},
  /* 步枪：中口径、中等枪管 */
  rifle:{layers:[
    {dur:0.075,hp:700,lp:8000,peak:2400,vol:0.50,decay:2.5},
    {dur:0.19,hp:90, lp:1200,vol:0.28,decay:3.0,delay:0.002},
    {dur:0.07,hp:1800,lp:6000,peak:3600,vol:0.09,decay:4.0,delay:0.035},
  ]},
  /* 狙击枪：大口径、长枪管 → 低频重、尾音长 */
  sniper:{layers:[
    {dur:0.09,hp:500,lp:7000,peak:1600,vol:0.55,decay:2.0},
    {dur:0.45,hp:60, lp:900, vol:0.40,decay:2.6,delay:0.003},
    {dur:0.30,hp:400,lp:2600,vol:0.12,decay:3.6,delay:0.02},
  ]},
  /* 机枪：小口径高射速 → 短促、干脆、低音少 */
  mg:{layers:[
    {dur:0.055,hp:900,lp:9000,peak:3000,vol:0.40,decay:3.0},
    {dur:0.10,hp:140,lp:1500,vol:0.18,decay:3.4,delay:0.002},
  ]},
  /* 霰弹枪：大装药、宽枪口 → 最强的低频爆音 + 宽噪声带 */
  shotgun:{layers:[
    {dur:0.10,hp:380,lp:6500,peak:1200,vol:0.58,decay:1.9},
    {dur:0.38,hp:45, lp:700, vol:0.46,decay:2.4,delay:0.003},
    {dur:0.18,hp:900,lp:3400,vol:0.14,decay:3.2,delay:0.015},
  ]},
};
function playGun(kind){
  const rec=GUN_SHOTS[kind]||GUN_SHOTS.rifle;
  for(const L of rec.layers) noiseHit(L);
}
/* 单个合成音（仅用于非枪械的提示音：换弹、治疗、点击等） */
function tone(freq,freq2,dur,type,vol,delay){
  if(!sfxEnabled||!actx) return;
  const t0=actx.currentTime+(delay||0);
  try{
    if(type==='noise'){
      const n=Math.floor(actx.sampleRate*dur);
      const buf=actx.createBuffer(1,n,actx.sampleRate);
      const ch=buf.getChannelData(0);
      for(let i=0;i<n;i++) ch[i]=(Math.random()*2-1)*(1-i/n);
      const src=actx.createBufferSource(); src.buffer=buf;
      const f=actx.createBiquadFilter(); f.type='lowpass';
      f.frequency.setValueAtTime(freq,t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(60,freq2),t0+dur);
      const g=actx.createGain();
      g.gain.setValueAtTime(vol,t0);
      g.gain.exponentialRampToValueAtTime(0.0008,t0+dur);
      src.connect(f); f.connect(g); g.connect(sfxMaster);
      src.start(t0); src.stop(t0+dur);
      return;
    }
    const o=actx.createOscillator(), g=actx.createGain();
    o.type=type||'sine';
    o.frequency.setValueAtTime(freq,t0);
    if(freq2&&freq2!==freq) o.frequency.exponentialRampToValueAtTime(Math.max(20,freq2),t0+dur);
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.exponentialRampToValueAtTime(vol,t0+Math.min(0.012,dur*0.3));
    g.gain.exponentialRampToValueAtTime(0.0008,t0+dur);
    o.connect(g); g.connect(sfxMaster);
    o.start(t0); o.stop(t0+dur+0.02);
  }catch(e){ /* 音频上下文异常时静默降级，绝不影响游戏 */ }
}
/* 真实向音效配方。
   ★ 枪声的真实结构（想做得像就必须照这个来）：
     ① 瞬态爆音（crack）：极短、极响、高频，是「枪」而不是「咻」的关键
     ② 低频冲击（body）：几十~一百多 Hz 的短促推力，给了「重量感」
     ③ 尾音（tail）：枪声在环境里的反射，几十毫秒的噪声衰减
   旧配方只有单个振荡器「嘀」一声，听起来像电子玩具。
   现在每个枪声都是这三层叠加 + 用噪声模拟火药爆燃。 */
/* 音效配方表。
   ★ 枪械类（shoot/sniper/mg/shotgun/shot）**不再用 tone()**，
     全部改走 playGun() —— 用噪声脉冲 + 频段塑形 + 实测衰减曲线合成，
     这是「像真枪」和「像电子玩具」的分界。
     tone() 只留给非枪械的机械/提示音（换弹、治疗、点击等）。 */
/* ================= 真实枪声采样 =================
   ★ 用户明确要求「现实里对应武器的枪声」，不要合成音。
   下面的 SFX_CLIPS 是**真实录音**裁出的单发样本（Wikimedia Commons /
   Beeld en Geluid 档案，CC BY-SA / 公有领域），只做过裁剪、降采样与归一化，
   没有任何音色合成。运行时用 Web Audio 解码一次，之后直接播放。
   来源与授权见 发布/说明.txt。 */
let clipBuffers={}, clipsReady=false;
function decodeClips(){
  if(clipsReady||!actx||typeof SFX_CLIPS==='undefined') return;
  clipsReady=true;
  for(const k in SFX_CLIPS){
    try{
      const b64=SFX_CLIPS[k];
      const bin=atob(b64);
      const buf=new ArrayBuffer(bin.length);
      const u8=new Uint8Array(buf);
      for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
      /* decodeAudioData 在部分浏览器是回调式，这里兼容两种写法 */
      const done=function(a){ clipBuffers[k]=a; try{ musicKick(); }catch(e){} };
      const p=actx.decodeAudioData(buf,done,function(){});
      if(p&&p.then) p.then(done).catch(function(){});
    }catch(e){ /* 单个样本失败不影响其它 */ }
  }
}
/* 播放真实枪声样本。
   为了不听起来像复读机，每次播放做轻微的**播放速率**扰动（±4%）
   与音量扰动 —— 这是真实枪声也会有的差异，不是合成。 */
/* 从多个变体里随机挑一个，避免同一个音反复播放显得机械 */
function pickClip(list){
  if(!list||!list.length) return null;
  return list[(Math.random()*list.length)|0];
}
function playClip(kind,vol){
  if(vol&&vol>0&&actx&&busWeapon) musicDuck(vol*0.5,0.30);   // 开火时压低音乐
  const buf=clipBuffers[kind];
  if(!buf||!actx||!sfxEnabled) return false;
  try{
    const s=actx.createBufferSource();
    s.buffer=buf;
    const rate=0.96+Math.random()*0.08;
    s.playbackRate.value=rate;
    const g=actx.createGain();
    const v=(vol===undefined?1:vol)*(0.85+Math.random()*0.3);
    g.gain.value=Math.max(0.02,Math.min(1.4,v));
    s.connect(g);
    g.connect(busFor(kind)||sfxMaster);     // ★ 走对应总线，不再全挤在一条上
    s.start(0);
    return true;
  }catch(e){ return false; }
}
/* ================= 背景音乐 =================
   三条音轨（全部来自 OpenGameArt 的真实乐曲，非合成）：
     music_calm   Dark Ambient        —— 常规对局
     music_tense  Tension             —— 残局 / 人数劣势时切换
     music_wind   Scary Ambient Wind  —— 撤离模式的氛围层
   ★ 自定义音乐：玩家可以从本机选一个音频文件当背景乐
     （背景乐走上限 24 秒的循环播放；原始文件不会被上传，只在本机内存里）。
   µ-law 8bit / 8kHz 内嵌，浏览器原生可解，三首合计约 450KB。 */
let musicSrc=null;          // 当前音乐源（AudioBuffer）
let musicNode=null;         // 当前播放节点
let musicGain=null;
let musicOn=false;          // 是否开启音乐
let musicVol=0.32;          // 音量
let musicTrack='music_calm';
let musicCustom=null;       // 用户自定义音乐的 AudioBuffer
function musicCtx(){
  const a=sfxInit(); decodeClips();
  return a;
}
function stopMusic(){
  try{ if(musicNode){ musicNode.stop(); musicNode=null; } }catch(e){}
}
/* 循环播放一段 AudioBuffer */
function loopBuffer(buf){
  const a=musicCtx(); if(!a||!buf) return false;
  try{
    stopMusic();
    if(!musicGain){ musicGain=a.createGain(); musicGain.connect(sfxMaster); }
    musicGain.gain.value=musicVol;
    const s=a.createBufferSource();
    s.buffer=buf;
    s.loop=true;
    s.connect(musicGain);
    s.start(0);
    musicNode=s;
    musicOn=true;
    return true;
  }catch(e){ return false; }
}
function playMusic(track){
  track=track||musicTrack;
  musicTrack=track;
  if(track==='custom'){
    if(!musicCustom) return false;
    return loopBuffer(musicCustom);
  }
  const buf=clipBuffers[track];
  if(!buf) return false;                 // 尚未解码完成，稍后会由 decodeClips 补播
  return loopBuffer(buf);
}
function setMusicVolume(v){
  musicVol=clamp(Number(v)||0,0,1);
  try{ if(musicGain) musicGain.gain.value=musicVol; }catch(e){}
  return musicVol;
}
/* 自定义音乐：接收 File / Blob / ArrayBuffer */
function loadCustomMusic(file,onDone){
  const a=musicCtx();
  if(!a){ if(onDone) onDone(false,'音频系统未就绪'); return; }
  const fail=function(msg){ if(onDone) onDone(false,msg); };
  const ok=function(buf){
    musicCustom=buf;
    musicTrack='custom';
    playMusic('custom');
    if(onDone) onDone(true,null);
  };
  try{
    if(file&&file.arrayBuffer){
      file.arrayBuffer().then(function(ab){
        const p=a.decodeAudioData(ab,ok,function(){ fail('无法解码这个音频文件'); });
        if(p&&p.then) p.then(ok).catch(function(){ fail('无法解码这个音频文件'); });
      }).catch(function(){ fail('读取文件失败'); });
    } else if(file instanceof ArrayBuffer){
      const p=a.decodeAudioData(file,ok,function(){ fail('无法解码'); });
      if(p&&p.then) p.then(ok).catch(function(){ fail('无法解码'); });
    } else fail('不支持的来源');
  }catch(e){ fail(e.message||'加载失败'); }
}
/* 解码完成后自动开始播放（开局时样本可能还没解码好，
   所以 decodeClips 完成时会回调这里补播一次）。 */
function musicKick(){
  if(musicOn) return;
  const cb=(typeof document!=='undefined')&&document.getElementById?document.getElementById('chkMusic'):null;
  if(cb&&cb.checked===false) return;             // 用户关了音乐
  if(G&&G.phase!=='battle') return;              // 还没开战就不放
  playMusic(musicTrack);
}
/* 按战场态势自动切换音乐情绪（不需要玩家操心） */
function musicAuto(){
  if(musicTrack==='custom') return;
  if(!musicOn){ musicKick(); return; }           // 还没开始放 → 尝试补播
  if(G.mission&&G.mission.on){ if(musicTrack!=='music_wind') playMusic('music_wind'); return; }
  const c=counts();
  const h=G.teams&&G.teams[0]?c.teams[0].total:0;
  const z=G.teams&&G.teams[1]?c.teams[1].total:0;
  /* 紧张音乐只在「人数劣势」时切 —— 原来还有个「最后 45 秒也紧张」的条件，
     时间限制移除后那个条件没有意义了，去掉。 */
  const tense=(h>0&&z>0&&h/Math.max(1,z)<0.55);
  const want=tense?'music_tense':'music_calm';
  if(musicTrack!==want) playMusic(want);
}
const SFX_RECIPES={
  /* ---- 枪械：**优先播放真实录音样本**；样本不可用时才退回合成噪声 ---- */
  shoot:   ()=>{ if(!playClip('rifle'))   playGun('rifle'); },
  sniper:  ()=>{ if(!playClip('sniper'))  playGun('sniper'); },
  /* 机枪：优先播「扫射段」（连续连发录音），单发音没有压制感 */
  mg:      ()=>{ if(!playClip('minigun',0.85)){ if(!playClip('mg')) playGun('mg'); } },
  /* 霰弹枪：枪声 + 紧接着的泵动上膛咔嚓（霰弹枪的灵魂） */
  shotgun: ()=>{ if(!playClip('shotgun',1.0)) playGun('shotgun');
                 setTimeout(function(){ try{ playClip('pump',0.45); }catch(e){} }, 250); },
  shot:    ()=>{ if(!playClip('pistol'))  playGun('pistol'); },
  pistol:  ()=>{ if(!playClip('pistol'))  playGun('pistol'); },
  /* 喷火：Red Eclipse 真实喷火器（点火 + 持续火舌） */
  flame:   ()=>{ if(!playClip('flame_loop')) playClip('flamer'); },
  flameIgnite: ()=>{ playClip('flame_ignite'); },
  burnDmg: ()=>{ if(!playClip('burn_damage')) playClip('flame_loop'); },
  /* 火箭筒：RPG 发射（3 个变体随机）+ 飞行呼啸 + 大爆炸 */
  rocket:  ()=>{ if(!playClip(pickClip(['rpg_fire','rpg_fire2','rpg_fire3']))) playClip('rocket'); },
  rocketFly: ()=>{ playClip('rpg_flight'); },
  /* 近战：真实拳击/命中录音（4 变体随机） */
  melee:   ()=>{ playClip(pickClip(['melee','melee2','melee3','melee4'])); },
  /* 盾击：金属命中录音。`metalhit` 不存在 → 用真实拳击样本兜底 */
  bash:    ()=>{ if(!playClip('melee3')) playClip('melee4'); },
  /* 爆炸：真实录音 */
  explode: ()=>{ if(!playClip(pickClip(['boom','boom2','boom3']))) playClip('explode'); },
  /* ---- 动作 / 投掷物 / 僵尸（全部真实录音）---- */
  throw:   ()=>{ playClip('switch'); },            // 手雷投掷
  grenexp: ()=>{ if(!playClip('grenexp')) playClip('grenade'); },
  launch:  ()=>{ if(!playClip('launch')) playClip('rocket'); },
  empty:   ()=>{ playClip('empty'); },             // 弹匣打空
  groan:   ()=>{ playClip('groan'); },             // 僵尸嘶吼
  /* ★ 击中肉响。原来引用了 `fleshhit`，但 SFX_CLIPS 里**没有这个样本** ——
     于是每次命中都是静音（玩家感觉「打击没反馈」）。
     现在改成用真实存在的样本：zpain（僵尸痛呼）→ melee4（拳击）双兜底。 */
  zhit:    ()=>{ if(!playClip(pickClip(['zpain','groan']))) playClip('melee4'); },
  /* ★ 子弹打墙。`stonehit` 不存在 → 改用真实存在的 melee3 作质感兜底。
     命中墙面用「短促硬质敲击」，melee3 是最接近的可用样本。 */
  richochet:()=>{ if(!playClip('melee3')) playClip('melee2'); },
  /* ★ 砸门砸窗。`woodhit` 不存在 → 这是**最常触发**的音效之一
     （僵尸一直在砸门），缺了它整场几乎听不到破坏声。
     用 melee 系列（真实拳击/撞击录音）兜底。 */
  woodbreak:()=>{ if(!playClip('melee2')) playClip('melee'); },
  /* ★ 以下原本是 tone() 合成音 —— 全部换成真实录音。
     这些音效触发极频繁（灼烧 0.8s 一次、受伤、感染、尸变、治疗、换弹），
     几十个单位同时触发时，一大堆振荡器叠加就是用户听到的「嘈杂声」。
     现在：有真实样本就用样本，没有就**静音**（宁可不出声，也不出电子音）。 */
  burn:    ()=>{ playClip('burn_damage'); },
  reload:  ()=>{ playClip('switch'); },
  /* ★ 受伤。`fleshhit` 不存在 → 改用真实存在的人类痛呼样本。 */
  hurt:    ()=>{ if(!playClip(pickClip(['human_pain','human_pain2']))) playClip('melee4'); },
  infect:  ()=>{ playClip('zpain'); },
  convert: ()=>{ playClip('zdie0'); },
  heal:    ()=>{},                                 // 治疗不再出声（原为柔和合成音）
  click:   ()=>{},                                 // UI 点击音删除（典型电子感）

  /* ---- 大战场：击杀反馈播报 ---- */
  /* ★ 击杀播报音已**全部删除**。
     它们是从开源 FPS 里借来的「播报员语音」（fragged / headshot /
     multikill / firstblood），听起来像电子提示音、游戏 UI 感极强，
     与「真实战场」的基调冲突（用户明确要求删掉这类电子/激光感反馈）。
     击杀反馈改为**完全依赖视觉**（击杀特效 + 战报条目），不再出声。 */
  kill:      ()=>{},
  killHead:  ()=>{},
  killMulti: ()=>{},
  killFirst: ()=>{},
  /* ---- 真人受伤 / 阵亡 ---- */
  humanPain:  ()=>{ if(!playClip(pickClip(['human_pain','human_pain2']))) playClip('melee4'); },
  humanDeath: ()=>{ playClip('human_death'); },
  /* ---- 僵尸：嚎叫（6 变体）/ 死亡（3 变体）/ 低吼（4 变体） ---- */
  zombieCall:  ()=>{ playClip(pickClip(['zcall0','zcall1','zcall2','zcall3','zcall4','zcall5'])); },
  zombieDie:   ()=>{ playClip(pickClip(['zdie0','zdie1','zdie2'])); },
  zombieGrowl: ()=>{ playClip(pickClip(['growl0','growl1','growl2','growl3'])); },
  /* ---- 榴弹 ---- */
  grenFire:  ()=>{ playClip('gren_fire'); },
  grenBeep:  ()=>{ playClip('gren_beep'); }
};
/* 播放一个动作音效。同名音效在 SFX_VOICES 冷却内不会重复触发。 */
function sfx(name,x,y){
  if(!sfxEnabled||sfxFailed) return;
  const rec=SFX_RECIPES[name];
  if(!rec) return;
  /* 三路独立配额：枪声 / 僵尸 / 其它互不挤占 */
  const busName=SFX_BUS[name];
  if(busName==='weapon'){ if(sfxQuotaW<=0) return; }
  else if(busName==='zombie'){ if(sfxQuotaZ<=0) return; }
  else { if(sfxQuotaO<=0) return; }
  /* ★ 冷却基准用**游戏时间 G.time**，不是墙钟 performance.now()。
     用墙钟的后果：加速播放（2×/4×）或快进模拟时，一瞬间涌入大量音效，
     除第一个外全被冷却拦掉 —— 实测 20 秒交火只有约 5% 的枪声能播出来，
     听起来就是「枪声很哑、几乎没有」，正是用户反馈的问题。
     改用游戏时间后，冷却与对局节奏一致，加速时音效密度也正确。 */
  const now=sfxClock();
  const cool=SFX_COOLDOWN[name]||0;
  if(SFX_VOICES[name]!==undefined&&now-SFX_VOICES[name]<cool) return;
  SFX_VOICES[name]=now;
  if(busName==='weapon') sfxQuotaW--;
  else if(busName==='zombie') sfxQuotaZ--;
  else sfxQuotaO--;
  sfxInit();
  rec();
}
/* 音效时钟：对局中用游戏时间；菜单阶段（点击/切页）退回墙钟。 */
function sfxClock(){
  if(typeof G!=='undefined'&&G&&G.phase==='battle'&&typeof G.time==='number') return G.time;
  return (typeof performance!=='undefined'&&performance.now)?performance.now()/1000:Date.now()/1000;
}
/* 每个音效的最小重播间隔。
   ★ 之前只定义了 18 个，而配方表里用了 39 个键 ——
     缺冷却的音效 SFX_VOICES[name] 未定义 → cool=0 → **完全无冷却**，
     僵尸嚎叫、受伤、击杀播报会无限叠加，把枪声彻底淹没。
     现在全部补齐，且给「人声类」更长的冷却（避免惨叫此起彼伏）。 */
const SFX_COOLDOWN={
  /* 武器：间隔略小于武器 cd，保证每次开火都听得见 */
  shoot:0.085, mg:0.075, sniper:0.30, shotgun:0.22, shot:0.10,
  pistol:0.10, flamer:0.11, rocket:0.40, flame:0.09,
  flameIgnite:0.30, rocketFly:0.25, explode:0.06, grenFire:0.20,
  grenBeep:0.25, grenexp:0.08, launch:0.30, gl:0.20,
  /* 环境 / 机械 */
  bash:0.09, melee:0.07, zhit:0.18, richochet:0.06, woodbreak:0.12,
  burnDmg:0.80, burn:0.40, reload:0.30, switch:0.25, empty:0.40,
  /* 人声：冷却都拉长，避免密集惨叫 */
  hurt:0.45, humanPain:0.55, humanDeath:0.70,
  zombieCall:0.60, zombieDie:0.50, zombieGrowl:0.80, groan:0.90,
  kill:0.30, killHead:0.30, killMulti:0.60, killFirst:1.20,
  infect:0.50, heal:0.60, convert:0.45,
  throw:0.25, click:0.03,
};
/* 每 tick 重置音效预算，避免一帧内几十个单位同时开火 */
/* 每 tick 重置预算。
   ★ 分三路配额，互不挤占（用户反馈「枪声和僵尸音效互相挤占」的根因之一）：
     weapon 14/帧  —— 枪声必须响亮密集，绝不能被人声挤掉
     zombie  3/帧  —— 僵尸嚎叫本来刺耳，少量点缀即可；给独立配额后
                      它既不会挤掉枪声，也不会被枪声的配额耗尽而消失
     other   4/帧  —— 人声 / 环境 / 命中反馈共享
   之前的做法是「武器 14、其余全部 5」，僵尸和枪声抢同一个池子，
   火力一猛就把僵尸音挤没了，安静下来又突然冒出来 —— 听感忽大忽小。 */
const SFX_BUDGET_WEAPON=14, SFX_BUDGET_ZOMBIE=3, SFX_BUDGET_OTHER=4;
let sfxQuotaW=0, sfxQuotaZ=0, sfxQuotaO=0;
function sfxStep(dt){ sfxQuotaW=SFX_BUDGET_WEAPON; sfxQuotaZ=SFX_BUDGET_ZOMBIE; sfxQuotaO=SFX_BUDGET_OTHER; }
function setSfxEnabled(v){
  sfxEnabled=!!v;
  if(sfxEnabled) sfxResume();
  return sfxEnabled;
}

/* ---------------- 移动 ---------------- */
function steer(u,dx,dy,dt,mul){
  const d=CLASSES[u.cls];
  mul=mul===undefined?1:mul;
  const len=Math.hypot(dx,dy);
  let tx=0, ty=0;
  if(len>1e-6){ dx/=len; dy/=len; tx=dx*d.speed*mul; ty=dy*d.speed*mul; }
  if(u.slowT>0){ tx*=0.72; ty*=0.72; }
  /* ★ 翻窗：翻越期间速度大幅下降（VAULT_SPEED）。
     这是「翻窗有代价」的核心 —— 走门才是首选，翻窗是应急。
     同时翻越中的单位不能开枪（在 tickHuman 里判断）。 */
  if(u.vaultT>0){ tx*=VAULT_SPEED; ty*=VAULT_SPEED; }
  /* 盾击击退：叠加一个快速衰减的瞬时速度，僵尸会被明显推开 */
  if(u.pushVx||u.pushVy){
    tx+=u.pushVx; ty+=u.pushVy;
    const dec=Math.exp(-dt*7.5);
    u.pushVx*=dec; u.pushVy*=dec;
    if(Math.abs(u.pushVx)<2) u.pushVx=0;
    if(Math.abs(u.pushVy)<2) u.pushVy=0;
  }
  const k=Math.min(1,dt*9);
  u.vx+=(tx-u.vx)*k; u.vy+=(ty-u.vy)*k;
  u.x+=u.vx*dt; u.y+=u.vy*dt;
}
function followPath(u,dt,mul){
  const p=u.path;
  if(!p||!p.length) return false;
  let guard=0;
  while(p.length>1 && Math.hypot(p[0].x-u.x,p[0].y-u.y)<15 && guard++<40) p.shift();
  const w=p[0];
  if(Math.hypot(w.x-u.x,w.y-u.y)<11){ p.shift(); if(!p.length) return false; }
  steer(u,w.x-u.x,w.y-u.y,dt,mul);
  return true;
}
/* 翻窗检查：人类单位站在窗户格上时进入「翻越」状态。
   · 进入窗格 → 开始计时 VAULT_TIME
   · 期间 steer 会把速度乘 VAULT_SPEED，并且不能开枪（见 tickHuman）
   · 翻完（计时结束）恢复正常
   僵尸不走这条路 —— blocksMove 对它们仍然把窗当墙。 */
function updateVault(u){
  if(u.kind!=='h'){ u.vaultT=0; return; }
  const tx=clamp((u.x/TILE)|0,0,GW-1), ty=clamp((u.y/TILE)|0,0,GH-1);
  const onWin = G.map[idx(tx,ty)]===WIN;
  if(onWin){
    if(!u.vaultT){ u.vaultT=VAULT_TIME; sfx('woodbreak',u.x,u.y); }
    else u.vaultT=Math.max(0,u.vaultT);
  } else if(u.vaultT>0){
    /* 离开窗格就正常结束（而不是把剩余时间耗完） */
    u.vaultT=0;
  }
}
/* 当前是否处于翻越中（速度受限 + 不能开火） */
function isVaulting(u){ return !!(u&&u.vaultT>0); }

function resolveCollisions(u){
  const r=u.radius;
  const prevX=u.prevX===undefined?u.x:u.prevX, prevY=u.prevY===undefined?u.y:u.prevY;
  for(let pass=0;pass<2;pass++){
    const x0=Math.max(0,((u.x-r)/TILE)|0), x1=Math.min(GW-1,((u.x+r)/TILE)|0);
    const y0=Math.max(0,((u.y-r)/TILE)|0), y1=Math.min(GH-1,((u.y+r)/TILE)|0);
    let hit=false;
    for(let ty=y0;ty<=y1;ty++) for(let tx=x0;tx<=x1;tx++){
      if(!blocksMove(G.map[idx(tx,ty)],tx,ty,u.kind)) continue;
      const rx=tx*TILE, ry=ty*TILE;
      const px=clamp(u.x,rx,rx+TILE), py=clamp(u.y,ry,ry+TILE);
      const dx=u.x-px, dy=u.y-py, d=Math.hypot(dx,dy);
      if(d>=r) continue;
      if(d>1e-4){
        const push=(r-d)/d;
        u.x+=dx*push; u.y+=dy*push;
      } else {
        const fromL=prevX<=rx, fromR=prevX>=rx+TILE, fromT=prevY<=ry, fromB=prevY>=ry+TILE;
        if(fromL&&!fromR)      u.x=rx-r;
        else if(fromR)         u.x=rx+TILE+r;
        else if(fromT&&!fromB) u.y=ry-r;
        else if(fromB)         u.y=ry+TILE+r;
        else {
          const l=u.x-rx, ri=rx+TILE-u.x, tp=u.y-ry, bt=ry+TILE-u.y;
          const m=Math.min(l,ri,tp,bt);
          if(m===l) u.x=rx-r; else if(m===ri) u.x=rx+TILE+r;
          else if(m===tp) u.y=ry-r; else u.y=ry+TILE+r;
        }
      }
      hit=true;
    }
    if(!hit) break;
  }
  u.x=clamp(u.x,u.radius,VW-u.radius);
  u.y=clamp(u.y,u.radius,VH-u.radius);
  const ti=idx(clamp((u.x/TILE)|0,0,GW-1),clamp((u.y/TILE)|0,0,GH-1));
  if(blocksMove(G.map[ti],ti%GW,(ti/GW)|0,u.kind)){
    const ri=idx(clamp((prevX/TILE)|0,0,GW-1),clamp((prevY/TILE)|0,0,GH-1));
    if(!blocksMove(G.map[ri],ri%GW,(ri/GW)|0,u.kind)){ u.x=prevX; u.y=prevY; }
  }
}
/* ---------------- 空间网格（大规模性能地基） ----------------
   原实现里 separation / 各种 nearest* 都是 O(n²) 全遍历：
   500 单位时单帧要 54ms（60fps 预算只有 16.7ms），必卡。
   这里按格子分桶，把「找附近单位」降到只看 3×3 个桶。
   桶边长取 CELL，必须 >= 两倍最大半径，这样邻居查询覆盖 3×3 就够。 */
const CELL=28;                       // 网格边长（像素），略大于最大直径
let GRID=null, GRID_COLS=0, GRID_ROWS=0;
let gridDirty=true;                  // 单位位置/列表一变就置脏，下次查询前重建
function gridMarkDirty(){ gridDirty=true; }
/* 查询前调用：脏了才重建，避免同一帧内重复构建 */
function gridEnsure(){
  if(gridDirty||!GRID){ gridBuild(); gridDirty=false; }
}
function gridBuild(){
  const cols=Math.ceil(VW/CELL)+1, rows=Math.ceil(VH/CELL)+1;
  if(!GRID||GRID_COLS!==cols||GRID_ROWS!==rows){
    GRID=new Array(cols*rows);
    for(let i=0;i<GRID.length;i++) GRID[i]=[];
    GRID_COLS=cols; GRID_ROWS=rows;
  } else {
    for(let i=0;i<GRID.length;i++) if(GRID[i].length) GRID[i].length=0;
  }
  const us=G.units;
  for(let i=0;i<us.length;i++){
    const u=us[i];
    if(!u.alive) continue;
    let cx=(u.x/CELL)|0, cy=(u.y/CELL)|0;
    if(cx<0) cx=0; else if(cx>=GRID_COLS) cx=GRID_COLS-1;
    if(cy<0) cy=0; else if(cy>=GRID_ROWS) cy=GRID_ROWS-1;
    u._gx=cx; u._gy=cy;
    GRID[cy*GRID_COLS+cx].push(u);
  }
  gridDirty=false;
}
/* 遍历 (x,y) 周围、覆盖半径 R 的所有桶里的存活单位。
   ★ 关键：不能只扫 3×3 桶！
     CELL=28 时 3×3 只覆盖 ~42px，但调用方会传 maxD=620，
     甚至有 maxD=undefined（无限远）。只扫 3×3 会让远处敌人「凭空消失」，
     表现为单位不移动、不开火、不后撤（曾导致 18 项回归失败）。
     这里按 R 反算要扫几圈桶；R 无限时退化为全表遍历以保证正确性。 */
function forEachNear(x,y,fn,R){
  gridEnsure();
  const all=()=>{ for(const u of G.units) if(u.alive) fn(u); };
  if(!GRID){ all(); return; }
  if(R===undefined||R===null||!isFinite(R)){ all(); return; }
  const cx=(x/CELL)|0, cy=(y/CELL)|0;
  const ring=Math.max(1,Math.ceil(R/CELL));
  const x0=Math.max(0,cx-ring), x1=Math.min(GRID_COLS-1,cx+ring);
  const y0=Math.max(0,cy-ring), y1=Math.min(GRID_ROWS-1,cy+ring);
  /* 大半径时格子很多（620px ≈ 22×22=484 格），但绝大多数是空的。
     利用 rowLen 一次取出整行，并跳过空桶，减少内层判断开销。 */
  for(let gy=y0;gy<=y1;gy++){
    const base=gy*GRID_COLS;
    for(let gx=x0;gx<=x1;gx++){
      const bucket=GRID[base+gx];
      if(bucket.length===0) continue;
      for(let i=0;i<bucket.length;i++){
        const u=bucket[i];
        if(u.alive) fn(u);
      }
    }
  }
}
/* 逐圈由内向外找最近目标：本圈命中即停。
   ★ 这是大编制下的关键优化：地图上 620px 半径的方框有 ~484 格，
     但「最近的敌人」几乎总在头 1~3 圈（~10 格）里，扫满整个方框纯属浪费。
   pred(u) 判断候选；返回 {e,d} 或 null。 */
function nearestByRing(x,y,R,pred){
  gridEnsure();
  if(!GRID||!isFinite(R)||R<=0) return null;
  const cx=(x/CELL)|0, cy=(y/CELL)|0;
  const maxRing=Math.max(1,Math.ceil(R/CELL));
  const R2=R*R;
  for(let ring=0;ring<=maxRing;ring++){
    const gx0=Math.max(0,cx-ring), gx1=Math.min(GRID_COLS-1,cx+ring);
    const gy0=Math.max(0,cy-ring), gy1=Math.min(GRID_ROWS-1,cy+ring);
    let best=null, bd=Infinity;
    for(let gy=gy0;gy<=gy1;gy++){
      const edgeRow=(gy===gy0||gy===gy1);
      const base=gy*GRID_COLS;
      for(let gx=gx0;gx<=gx1;gx++){
        /* 只扫这一圈的边框；内部格子在前几圈已经扫过 */
        if(!edgeRow&&gx!==gx0&&gx!==gx1) continue;
        const b=GRID[base+gx];
        const n=b.length;
        for(let i=0;i<n;i++){
          const u=b[i];
          if(!u.alive||!pred(u)) continue;
          const dx=u.x-x, dy=u.y-y, d2=dx*dx+dy*dy;
          if(d2<=R2&&d2<bd){ bd=d2; best=u; }
        }
      }
    }
    if(best) return {e:best,d:Math.sqrt(bd)};
  }
  return null;
}
/* 半径 R 内最近的单位（供 AI 查询用） */
function nearestNear(x,y,R,filter){
  let best=null, bd=R*R;
  forEachNear(x,y,u=>{
    if(filter&&!filter(u)) return;
    const dx=u.x-x, dy=u.y-y, d2=dx*dx+dy*dy;
    if(d2<bd){ bd=d2; best=u; }
  },R);
  return best?{e:best,d:Math.sqrt(bd)}:null;
}
/* 单位分离：用网格只检查同桶相邻，整体 O(n)。
   ★ 必须用「数组下标」而不是 id 来保证每对只处理一次：
     用 id 时结果会随 G.counter 的分配漂移（同一场景第一次与后续调用不同，
     id 大小关系变了 → 处理的先后/方向变了 → 物理轨迹分叉）。
     下标是本次 gridBuild 时的稳定顺序，可复现。 */
function separation(){
  gridEnsure();
  const us=G.units;
  /* 先给每个单位标记它在数组里的下标（gridBuild 时已按数组顺序入桶） */
  for(let i=0;i<us.length;i++) us[i]._sepIdx=i;
  for(let i=0;i<us.length;i++){
    const a=us[i]; if(!a.alive) continue;
    const ar=a.radius;
    let cx=a._gx, cy=a._gy;
    if(cx===undefined){ cx=(a.x/CELL)|0; cy=(a.y/CELL)|0; }
    /* 只看自己所在桶 + 四个「后向」邻桶，避免同一对被处理两次 */
    const offs=[[0,0],[1,0],[-1,1],[0,1],[1,1]];
    for(let k=0;k<5;k++){
      const gx=cx+offs[k][0], gy=cy+offs[k][1];
      if(gx<0||gy<0||gx>=GRID_COLS||gy>=GRID_ROWS) continue;
      const bucket=GRID[gy*GRID_COLS+gx], n=bucket.length;
      for(let j=0;j<n;j++){
        const b=bucket[j];
        if(!b.alive||b===a) continue;
        /* 同桶时只处理下标更大的，保证每对只算一次（与 id 无关） */
        if(k===0&&b._sepIdx<a._sepIdx) continue;
        const dx=b.x-a.x, dy=b.y-a.y;
        const rr2=ar+b.radius, d2=dx*dx+dy*dy;
        if(d2>=rr2*rr2||d2<1e-6) continue;
        const d=Math.sqrt(d2), pen=(rr2-d)/(2*d);
        const px=dx*pen, py=dy*pen;
        a.x-=px; a.y-=py; b.x+=px; b.y+=py;
      }
    }
  }
}
function freeSpotAround(x,y,baseR,kind){
  kind=kind||'z';
  /* 只挑「与主区域连通」的格子：否则单位会从死腔挪到另一个死腔，
     看起来没被卡在墙里，实际上永远走不出去。 */
  const reg=G.__mainRegion||(G.__mainRegion=mainRegion(G.map));
  for(let ring=0;ring<3;ring++){
    const R=baseR+ring*13;
    for(let i=0;i<12;i++){
      const a=(i/12)*TAU+rnd()*0.3;
      const nx=x+Math.cos(a)*R, ny=y+Math.sin(a)*R;
      const tx=(nx/TILE)|0, ty=(ny/TILE)|0;
      if(!inB(tx,ty)) continue;
      if(blocksMove(G.map[idx(tx,ty)],tx,ty,kind)) continue;
      if(reg.mask&&!reg.mask[idx(tx,ty)]) continue;      // 排除封闭空腔
      let ok=true;
      /* 用网格查邻居，避免大编制下全遍历；扫描半径要覆盖 u2.radius+rr 的最大值 */
      const rr=11;
      forEachNear(nx,ny,u2=>{ if(u2.alive&&Math.hypot(u2.x-nx,u2.y-ny)<u2.radius+rr) ok=false; },18);
      if(ok) return {x:nx,y:ny};
    }
  }
  return null;
}
function ensureFree(u){
  const tx=(u.x/TILE)|0, ty=(u.y/TILE)|0;
  if(inB(tx,ty)&&!blocksMove(G.map[idx(tx,ty)],tx,ty,u.kind)) return;
  const spot=freeSpotAround(u.x,u.y,u.radius+3,u.kind);
  if(spot){ u.x=spot.x; u.y=spot.y; u.vx=u.vy=0; u.prevX=u.x; u.prevY=u.y; return; }
  const reg=G.__mainRegion||(G.__mainRegion=mainRegion(G.map));
  for(let r=1;r<=10;r++){
    for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r) continue;
      const nx=clamp(tx+dx,0,GW-1), ny=clamp(ty+dy,0,GH-1);
      if(blocksMove(G.map[idx(nx,ny)],nx,ny,u.kind)) continue;
      if(reg.mask&&!reg.mask[idx(nx,ny)]) continue;      // 不进封闭空腔
      u.x=cx_of(nx); u.y=cy_of(ny); u.vx=u.vy=0; u.prevX=u.x; u.prevY=u.y;
      return;
    }
  }
}
