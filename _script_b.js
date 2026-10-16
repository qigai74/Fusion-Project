/* ---------------- 卡住检测与自愈 ----------------
   地图「卡住角色」有三种真实成因，必须分别处理：
     ① 路径被堵（临时）：反向绕行即可 → 翻 sid + 清路径
     ② 被挤在狭窄夹角里（分离力与墙同时推）：需要给一个「随机侧向冲量」脱困
     ③ 出生/传送落在不可通行格：由 ensureFree 兜底
   旧实现只做了 ①，所以单位在死角里会永久卡住（用户反馈的问题）。
   现在按 stuck 的严重程度升级处理：轻微→绕行；持续→推离；很久→就近传送到空地。 */
function trackStuck(u,dt){
  u.stuckT+=dt;
  if(u.stuckT<0.4) return;
  const moved=Math.hypot(u.x-u.lastX,u.y-u.lastY);
  const want=Math.hypot(u.vx,u.vy)>6;
  u.stuck=(want&&moved<2.5)?u.stuck+0.4:0;
  u.lastX=u.x; u.lastY=u.y; u.stuckT=0;
  if(u.stuck>0.8){
    /* ① 轻微卡顿：换个横向方向 + 丢弃旧路径，重新规划 */
    u.sid=-u.sid; u.path=null; u.pathGoal=-1; u.stuck=0.2;
    u.stuckLvl=(u.stuckLvl||0)+1;
  }
  if(u.stuckLvl>=3&&u.unstuckT<=0){
    /* ② 反复卡：给一个朝向「附近最空方向」的冲量，把它从夹角里顶出来 */
    const spot=freeSpotAround(u.x,u.y,u.radius+6,u.kind);
    if(spot){
      const a=Math.atan2(spot.y-u.y,spot.x-u.x);
      const power=120;
      u.vx+=Math.cos(a)*power; u.vy+=Math.sin(a)*power;
      u.pushVx=(u.pushVx||0)+Math.cos(a)*power*0.6;
      u.pushVy=(u.pushVy||0)+Math.sin(a)*power*0.6;
    }
    u.unstuckT=1.2;                       // 冷却，避免每帧都推
  }
  if(u.stuckLvl>=6){
    /* ③ 长期卡死：直接挪到最近的可站立空地（保底，保证不会永久卡） */
    const spot=freeSpotAround(u.x,u.y,u.radius+14,u.kind);
    if(spot){
      u.x=spot.x; u.y=spot.y; u.vx=u.vy=0; u.prevX=u.x; u.prevY=u.y;
      u.pushVx=u.pushVy=0;
    }
    u.path=null; u.pathGoal=-1; u.stuckLvl=0; u.stuck=0;
  }
}
/* 医疗兵：每 3 秒治疗一名同队单位（优先被感染者，其次血线最低），范围内无人则自愈 */
function medicTick(u,d,dt){
  u.healCd-=dt;
  u.healPulse=Math.max(0,u.healPulse-dt);
  if(u.healCd>0) return null;
  let best=null, score=-1;
  for(const a of G.units){
    if(!a.alive||a.team!==u.team||a===u) continue;
    if(Math.hypot(a.x-u.x,a.y-u.y)>d.healR) continue;
    const need=(1-a.hp/a.maxHp);
    let s=need;
    if(a.infect>0) s+=3;                            // 感染优先级远高于残血
    if(s<=0.02&&a.infect<=0) continue;              // 满血且没感染的不占用名额
    if(s>score){ score=s; best=a; }
  }
  if(!best){
    if(u.hp<u.maxHp){ u.hp=Math.min(u.maxHp,u.hp+HEAL_BURST); u.healCd=HEAL_INTERVAL; u.healPulse=0.6; u.beamTo=null; }
    else u.healCd=0.5;
    return null;
  }
  u.healCd=HEAL_INTERVAL;
  u.healPulse=0.6;
  u.beamTo=best;
  best.hp=Math.min(best.maxHp,best.hp+HEAL_BURST);
  if(best.infect>0){
    cure(best);
    best.purgedTick=G.tick;
    pushFeed('医疗兵 '+u.label+' 治好了 '+best.label,u.team);
  }
  spark(best.x,best.y,'#b6ffd0',10);
  return best;
}
/* 平民光环：身边有同队平民时射速 +25%（不叠加） */
function civilianAuraMul(u){
  if(u.cls==='civilian') return 1;
  for(const c of G.civPos){
    if(c.team===u.team&&Math.hypot(c.x-u.x,c.y-u.y)<=CIVILIAN_AURA_R) return CIVILIAN_AURA;
  }
  return 1;
}
/* 母体孵化。
   ★ 孵出兵种规则：
     · 普通母体：固定孵 `zombie`（spawnCls）
     · 终极母体：`randomSpawn:true` → **在所有僵尸型兵种里随机**，
       但**排除终极母体自己**（否则会指数级自我复制，直接崩盘）。
   随机池是动态算的，将来加了新僵尸兵种会自动纳入。 */
function hatchCls(d){
  if(d.randomSpawn){
    const pool=ROLES_Z.filter(k=>k!=='umother'&&CLASSES[k]&&CLASSES[k].kind==='z');
    return pool.length?pool[(rnd()*pool.length)|0]:'zombie';
  }
  return d.spawnCls||'zombie';
}
function tryHatch(u,d){
  let zc=0;
  for(const x of G.units) if(x.alive&&x.kind==='z') zc++;
  if(zc>=G.zCap||u.children>=d.maxChild){ u.childT=1.5; return; }
  const spot=freeSpotAround(u.x,u.y,30,'z');
  if(!spot){ u.childT=1.2; return; }
  const cls=hatchCls(d);
  if(!CLASSES[cls]){ u.childT=2.0; return; }
  u.childT=d.hatch; u.children++; u.hatchFx=0.75;
  const twins=Math.max(1,d.twins||1);
  let made=0;
  for(let i=0;i<twins&&u.children<=d.maxChild;i++){
    const sp=i===0?spot:freeSpotAround(u.x,u.y,30,'z');
    if(!sp) break;
    if(i>0) u.children++;
    const nu=makeUnit(cls,u.team,sp.x,sp.y,G.counter++);
    nu.spawnT=0.7; nu.prevX=nu.x; nu.prevY=nu.y;
    G.units.push(nu);
    made++;
    spark(sp.x,sp.y,'#d9a4ff',10);
  }
  pushFeed(teams[u.team].name+'的母体 '+u.label+' 孵化出 '+made+' 只'+CLASSES[cls].name,u.team);
}

/* ---------------- 掩体系统 ----------------
   一次射线采样给出：能不能打、有没有穿过窗户、路上有几道门 */
function rayScan(x0,y0,x1,y1){
  const dx=x1-x0, dy=y1-y0, d=Math.hypot(dx,dy);
  const steps=Math.max(1,Math.ceil(d/(TILE*0.4)));
  let win=0, door=0, wall=0;
  for(let i=1;i<steps;i++){
    const t=i/steps, x=x0+dx*t, y=y0+dy*t;
    const tx=(x/TILE)|0, ty=(y/TILE)|0;
    if(!inB(tx,ty)) return {clear:false,win:0,door:0,wall:9};
    const tt=G.map[idx(tx,ty)];
    if(tt===WALL) wall++;
    else if(tt===WIN) win++;
    else if(tt===DOOR&&G.doorHP[idx(tx,ty)]>0) door++;
  }
  return {clear:wall===0&&door===0, win:win, door:door, wall:wall};
}
/* 供开火使用：隔窗能打（窗户透射），门关着打不到 */
function shootLanes(x,y,e){
  const r=rayScan(x,y,e.x,e.y);
  return {ok:r.clear, win:r.win, door:r.door};
}
/* 这个落点算不算好掩体？越贴近挡视线的方块分越高，隔窗射击额外加分 */
const COVER_SCAN=TILE*2.6;
const COVER_RAYS=[-1.25,-0.8,-0.35,0.35,0.8,1.25];
function coverAt(u,x,y,e,range){
  const tx=(x/TILE)|0, ty=(y/TILE)|0;
  if(!inB(tx,ty)) return -1e9;
  if(blocksMove(G.map[idx(tx,ty)],tx,ty,u.kind)) return -1e9;
  const lane=shootLanes(x,y,e);
  if(!lane.ok) return -1e9;                               // 打不到就不算掩体
  const dd=Math.hypot(e.x-x,e.y-y);
  if(dd>range*1.02) return -1e9;
  /* ① 侧后方贴近实体方块 = 有掩体可缩 */
  const base=Math.atan2(e.y-y,e.x-x);
  let gain=0;
  for(const off of COVER_RAYS){
    const a=base+off;
    let hit=COVER_SCAN;
    for(let r=TILE*0.3; r<=COVER_SCAN; r+=TILE*0.28){
      const sx=x+Math.cos(a)*r, sy=y+Math.sin(a)*r;
      const gx=(sx/TILE)|0, gy=(sy/TILE)|0;
      if(!inB(gx,gy)||blocksSight(G.map[idx(gx,gy)],gx,gy)){ hit=r; break; }
    }
    gain+=1-hit/COVER_SCAN;
  }
  let score=gain*10-dd*0.02;
  /* ② 隔窗射击：身体在墙后、子弹从窗户出去，收益极高 */
  if(lane.win) score+=WIN_SHOOT_BONUS*12;
  /* ③ 门边：僵尸要撞门、人类型能随时推门跑，靠门站也算掩体 */
  const nearDoor=nearestTileWithin(x,y,DOOR,DOOR_DODGE_R);
  if(nearDoor) score+=(1-Math.hypot(x-nearDoor.x,y-nearDoor.y)/(DOOR_DODGE_R+1))*8;
  return score;
}
/* 在半径内找最近的某类方块（返回中心点） */
function nearestTileWithin(x,y,type,R){
  const x0=Math.max(0,((x-R)/TILE)|0), x1=Math.min(GW-1,((x+R)/TILE)|0);
  const y0=Math.max(0,((y-R)/TILE)|0), y1=Math.min(GH-1,((y+R)/TILE)|0);
  let best=null,bd=R+1;
  for(let ty=y0;ty<=y1;ty++) for(let tx=x0;tx<=x1;tx++){
    if(G.map[idx(tx,ty)]!==type) continue;
    if(type===DOOR&&G.doorHP[idx(tx,ty)]<=0) continue;
    const d=Math.hypot(x-cx_of(tx),y-cy_of(ty));
    if(d<bd){ bd=d; best={x:cx_of(tx),y:cy_of(ty),tx:tx,ty:ty}; }
  }
  return best;
}
function findCover(u,e,range){
  if(!e) return null;
  const cur=coverAt(u,u.x,u.y,e,range);
  if(cur<=-1e8) return null;                               // 当前位置打不到，交给推进逻辑
  let best=null, bs=cur+2.5;                               // 必须明显更好才挪窝（防抖）
  for(const R of [TILE*0.9,TILE*1.7,TILE*2.6]){
    for(let i=0;i<10;i++){
      const a=u.seed*0.7+i*(TAU/10);
      const x=u.x+Math.cos(a)*R, y=u.y+Math.sin(a)*R;
      const sc=coverAt(u,x,y,e,range);
      if(sc>bs){ bs=sc; best={x:x,y:y}; }
    }
  }
  return best;
}

/* ---------------- 好守的地方（地图层面识别） ----------------
   给每个格子打分：附近挡视线的方块越多、通道越窄、离己方越近，越好守 */
function holdScoreAt(tx,ty){
  if(!inB(tx,ty)) return -1e9;
  if(blocksMove(G.map[idx(tx,ty)],tx,ty,'h')) return -1e9;
  const cx=cx_of(tx), cy=cy_of(ty);
  let blockers=0, windows=0, doors=0;
  /* 取样半径与咽喉探测距离都必须随角色缩放联动：
     否则 RS 一变，同一张地图上「最高分的格子」会整片搬家，坚守点漂到敌方跟前。
     HOLD_SCORE_W = 期望覆盖的像素半径，换算成格数。 */
  const R=Math.max(2,Math.round(HOLD_SCORE_W/TILE));
  for(let dy=-R;dy<=R;dy++) for(let dx=-R;dx<=R;dx++){
    const nx=tx+dx, ny=ty+dy;
    if(!inB(nx,ny)) continue;
    const t=G.map[idx(nx,ny)], w=1/(Math.abs(dx)+Math.abs(dy)+1);
    if(t===WALL) blockers+=w;
    else if(t===WIN){ blockers+=w; windows+=w; }
    else if(t===DOOR&&G.doorHP[idx(nx,ny)]>0) doors+=w;
  }
  /* 通道越窄越好守：数一下四个方向多少格内会撞墙 */
  const SPAN=Math.max(3,Math.round(HOLD_CHOKE_SPAN/TILE));
  let open=0;
  for(const d of [[1,0],[-1,0],[0,1],[0,-1]]){
    let r=1;
    for(;r<=SPAN;r++){
      const nx=tx+d[0]*r, ny=ty+d[1]*r;
      if(!inB(nx,ny)) break;
      if(blocksSight(G.map[idx(nx,ny)],nx,ny)) break;
    }
    open+=r;
  }
  const choke=Math.max(0,(SPAN+1)*4-open);                // open 越小越是咽喉
  return blockers*3.2+choke*0.5+windows*1.6+doors*2.2;
}
/* 给某支队伍挑一个「好守的位置」：靠近己方、面向敌人、掩体多。结果缓存几秒 */
const HOLD_CACHE={};
let HOLD_SPOT_ON=true;          // 测试用开关：关掉后「坚守」就在原地布防
function bestHoldSpot(team){
  if(!HOLD_SPOT_ON) return null;
  const now=G.time;
  const c=HOLD_CACHE[team];
  /* 缓存必须绑定「当前地图 + 当前时间」：
     换了地图（或探针里 G.time 归零）后，旧的守点已经不再适用，
     否则会返回上一张图的位置，甚至返回新图上的非法点。 */
  if(c&&now-c.t<3.0&&c.gw===GW&&c.gh===GH&&c.map===G.map) return c.spot;
  const my=counts().anchors[team]||{x:VW/2,y:VH/2};
  const foe=foeAnchor(team);
  const dx=foe.x-my.x, dy=foe.y-my.y, len=Math.hypot(dx,dy)||1;
  let best=null, bs=-1e9;
  for(let ty=1;ty<GH-1;ty+=1){
    for(let tx=1;tx<GW-1;tx+=1){
      const s=holdScoreAt(tx,ty);
      if(s<=-1e8) continue;
      const cx=cx_of(tx), cy=cy_of(ty);
      const t=( (cx-my.x)*dx+(cy-my.y)*dy )/len;          // 朝敌人推进的投影
      const lateral=Math.abs((cx-my.x)*(-dy/len)+(cy-my.y)*(dx/len));
      if(t<0||t>len*0.75) continue;                        // 只在己方到敌方的前 3/4 段里选
      const sc=s-t*0.02+lateral*0.006;                     // 别离己方太远，也别贴边
      if(sc>bs){ bs=sc; best={x:cx,y:cy,tx:tx,ty:ty}; }
    }
  }
  HOLD_CACHE[team]={t:now,spot:best,gw:GW,gh:GH,map:G.map};
  return best;
}
function foeAnchor(team){
  const d=counts().anchors;
  let best=null, bd=-1;
  for(let i=0;i<d.length;i++){
    if(i===team) continue;
    const n=aliveCount(i);
    if(n<=0) continue;
    if(n>bd){ bd=n; best=d[i]; }
  }
  return best||d[0]||{x:VW/2,y:VH/2};
}

/* ---------------- 人类行为 ---------------- */
/* 自由行动：按当前态势自己挑一个站位策略。
   ★ 这里修的是「AI 突然抽风送死」，根因有三个：
     ① 旧判定 `outnumbered = allies<2 && dd<range*1.3`：
        远处落单的单位 allies=0，但 dd 很大 → outnumbered=false，
        于是走 `dd>range*0.95 → push` 分支 —— **一个人朝整群僵尸冲**。
        现在改成：只要「我附近敌人比友军多」，无论距离多远都算劣势，不许推进。
     ② 旧逻辑只看「够不够得着」就推进，不看「打不打得过」。
        现在推进前必须满足「局部数量不吃亏」，否则先靠拢队友。
     ③ 计划每 1.2 秒重roll一次 + 随机量，导致 push/cover 反复横跳（看起来像抽搐）。
        现在加了「滞回」：只有在态势明显变化时才换计划，否则保持上一个。
   目标是让自由模式的部队像真实步兵班：不落单、不硬冲、有依托才推进。 */
function freeStance(u,e,dd,range,dt){
  const d=CLASSES[u.cls];
  u.planT-=dt;
  if(u.planT>0&&u.plan) return u.plan;
  u.planT=FREE_REPLAN+rnd()*0.6;
  /* 统计「局部势力对比」：半径内友军数 vs 敌人数 */
  let allies=0, foes=0;
  const R=COHESION_R;
  forEachNear(u.x,u.y,a=>{
    if(a===u||!a.alive) return;
    if(Math.hypot(a.x-u.x,a.y-u.y)>R) return;
    if(a.team===u.team) allies++; else foes++;
  },R);
  const hpFrac=u.maxHp>0?u.hp/u.maxHp:1;
  const hurt=hpFrac<0.45;
  /* 局部劣势：敌人比友军多（含我自己），或者我压根没队友 */
  const localLosing=(foes+1)>allies;
  const alone=allies===0;
  let plan;
  if(d.melee||u.cls==='shotgun'){
    /* 近战/霰弹本来就该贴脸，但也不能一个人冲一群 */
    plan=(alone&&foes>=2)?'cover':((dd>standoffOf(u,d)*1.1)?'push':'cover');
  } else if(hurt||localLosing||alone){
    plan='cover';                                  // 劣势/落单 → 先找掩体，绝不推进
  } else if(dd>range*0.95){
    plan='push';                                   // 够不着且人数不吃亏 → 才推进
  } else {
    plan='cover';
  }
  /* 滞回：任何时刻只要态势不利，一律不许「推进」——
     避免刚从 cover 切到 push 就撞上敌群送死。 */
  if(plan==='push'&&(localLosing||hurt||alone)) plan='cover';
  u.plan=plan;
  return plan;
}
/* 坚守要点：先找出本队「好守的地方」，再往那儿收 */
function holdStance(u,d,e,dt){
  if(!u.holdSet){ u.holdSet=true; u.holdX=u.x; u.holdY=u.y; }
  const dd=e?Math.hypot(e.x-u.x,e.y-u.y):1e9;
  /* 敌人已经打得到 → 就地交火，不为占点位而迎上去 */
  if(e&&dd<=Math.max(d.range||0,standoffOf(u,d))*1.05){
    const ux=(e.x-u.x)/dd, uy=(e.y-u.y)/dd;
    if(dd<standoffOf(u,d)*0.72) return {dx:-ux,dy:-uy,mul:0.7,moving:true};
    return {dx:-uy*u.sid,dy:ux*u.sid,mul:0.45,moving:true};
  }
  const spot=bestHoldSpot(u.team);
  let tx=u.holdX, ty=u.holdY;
  if(spot&&Math.hypot(spot.x-u.holdX,spot.y-u.holdY)>TILE*2){  // 要点变了才动身
    tx=spot.x; ty=spot.y;
  }
  const hx=tx-u.x, hy=ty-u.y, hd=Math.hypot(hx,hy);
  /* 敌人不在视野内（守卫射程内没敌人）时，坚守就该钉在原地等它来，
     绝不为「占一个更漂亮的点位」而自己挪窝 —— 那看起来就是主动迎敌。
     只有确实看见了敌人、且守点位于己方一侧（不朝敌人方向）才动身。 */
  if(hd>26){
    if(!e) return {dx:0,dy:0,mul:1,moving:false};
    const toFoe={x:e.x-u.x,y:e.y-u.y};
    const foeD=Math.hypot(toFoe.x,toFoe.y);
    const toward=hx*toFoe.x+hy*toFoe.y;
    if(toward>0) return {dx:0,dy:0,mul:1,moving:false};   // 守点在敌人那一侧 → 不挪
    if(foeD<hd) return {dx:0,dy:0,mul:1,moving:false};    // 守点比敌人还远 → 没意义
    return {dx:hx,dy:hy,mul:0.85,moving:true};
  }
  if(e&&dd<standoffOf(u,d)*0.72){
    const ux=(e.x-u.x)/dd, uy=(e.y-u.y)/dd;
    return {dx:-ux,dy:-uy,mul:0.7,moving:true};
  }
  if(d) return {dx:-Math.sin(u.aim)*u.sid*standoffOf(u,d)*0.2,dy:Math.cos(u.aim)*u.sid*standoffOf(u,d)*0.2,mul:0.5,moving:true};
  return {dx:0,dy:0,mul:1,moving:false};
}
/* 该单位的「理想交战距离」。
   ★ 把队形排号折算进来：排号越大（盾兵 0 → 狙击 5）站得越靠后。
     这样远程单位不会因为自己的 pref 数值而挤到前排，
     队形的纵深也就真正体现在站位上，而不是只靠一个微弱的引力。
     例：机枪手 pref=215、排号 3 → 实际站到 215+3*27≈296px 处。 */
function standoffOf(u,d){
  const rank=RANK_DEPTH[u.cls]||0;
  const RS=G.radScale||1;
  return (d.pref||0)+rank*RANK_STEP*RS*0.85;
}
/* 借掩体：窗户射击 / 门边躲避都在 coverAt 里算分 */
function coverStance(u,d,e,range,dt){
  u.coverT-=dt;
  if(!u.cover||u.coverT<=0){ u.coverT=COVER_REFRESH+rnd()*0.4; u.cover=findCover(u,e,range); }
  const c=u.cover;
  if(!c){
    if(!e) return {dx:0,dy:0,mul:1,moving:false};
    const dd=Math.hypot(e.x-u.x,e.y-u.y);
    const ux=(e.x-u.x)/dd, uy=(e.y-u.y)/dd;
    if(dd>range*0.9) return {dx:ux,dy:uy,mul:0.8,moving:true};
    return {dx:0,dy:0,mul:1,moving:false};
  }
  const cd=Math.hypot(c.x-u.x,c.y-u.y);
  if(cd>Math.max(6,u.radius*0.8)) return {dx:c.x-u.x,dy:c.y-u.y,mul:0.9,moving:true};
  return {dx:-Math.sin(u.aim)*u.sid*14,dy:Math.cos(u.aim)*u.sid*14,mul:0.4,moving:true};
}
function gunRangeOf(u){
  const d=CLASSES[u.cls], g=mainGunOf(u);
  return g.range||d.range||0;
}
/* 选择当前该用哪把武器。
   ★ 狙击手配了手枪副武器（sidearm）：敌人贴近时换手枪。
   ★★ 关键：带 sidearm 的单位，主武器是**顶层字段**（dmg/cd/range/bspeed），
      而 d.gun 是那把副武器手枪。所以不能写 `d.gun||d` ——
      那会让狙击手整个丢掉狙击枪、只剩手枪（曾导致 215px 外的敌人永远打不到）。
      区分规则：
        · 有 sidearm → 主武器 = 顶层字段；近距离(<=手枪射程) = d.gun
        · 无 sidearm → 主武器 = d.gun||d（医疗兵/盾卫这类只有 d.gun 的照旧） */
function weaponOf(u,dist){
  const d=CLASSES[u.cls];
  if(d.sidearm&&d.gun){
    return (dist!==undefined&&dist<=d.gun.range)?d.gun:d;
  }
  return d.gun||d;
}
/* 该单位的主武器（不考虑切枪），用于决定索敌半径与站位 */
function mainGunOf(u){
  const d=CLASSES[u.cls];
  return d.sidearm?d:(d.gun||d);
}
function pushStance(u,d,e,dt){
  if(!e) return {dx:0,dy:0,mul:1,moving:false};
  const dd=Math.hypot(e.x-u.x,e.y-u.y);
  const ux=(e.x-u.x)/dd, uy=(e.y-u.y)/dd;
  if(dd>standoffOf(u,d)*0.55) return {dx:ux,dy:uy,mul:1,moving:true};
  return {dx:-uy*u.sid,dy:ux*u.sid,mul:0.75,moving:true};
}

/* 每个兵种用对应的枪声：口径 / 射速不同，音色必须区分开，
   否则几十个人一起开火全是同一个「哒」，听感很假。
   dist 给了的话，狙击手在近距离（用手枪）时也发手枪声。 */
/* 每个兵种都有**专属**的真实枪声样本，不再是「几种枪共用一套」：
     步枪手  AR-15           → rifle
     狙击手  Mosin Nagant    → sniper（近距离换成手枪样本）
     机枪手  PPSh 冲锋枪      → mg
     霰弹枪  Mossberg        → shotgun
     喷火兵  Carl Gustav M45 → flamer（点火爆音）
     火箭兵  AK-47           → rocket（发射）
     医疗兵  Walther PPQ     → pistol
     盾卫    S&W 642 左轮     → shot（左轮更脆、更有金属感，与医疗兵区分）
   所以「同一把枪」听感一致，「不同兵种」一听就能分辨。 */
/* ★ 这里返回的必须是 **SFX_RECIPES 的键名**，不是音频样本名！
   曾经写成 'rifle'，而配方表里的键是 'shoot' → sfx('rifle') 查不到配方、
   静默返回，**步枪手的枪声从来没响过**（实测通过率 0/42）。
   键名对照：
     shoot    → 步枪手（内部播 AR-15 样本）
     sniper   → 狙击手（Mosin Nagant）
     mg       → 机枪手（扫射段）
     shotgun  → 霰弹枪（Mossberg + 泵动上膛）
     flame    → 喷火兵（点火 + 持续火舌）
     rocket   → 火箭兵（RPG 发射）
     pistol   → 医疗兵（Walther PPQ）
     shot     → 盾卫（S&W 642 左轮）
*/
const GUN_CLIP={
  rifle:'shoot', sniper:'sniper', mg:'mg', shotgun:'shotgun',
  flamer:'flame', rocketeer:'rocket',
  medic:'pistol', shieldman:'shot',
};
function gunSfxName(cls,dist){
  if(cls==='sniper'&&dist!==undefined&&dist<=PISTOL.range) return 'pistol';
  return GUN_CLIP[cls]||'shoot';
}
/* ---------------- 队形系统 ----------------
   teamFrame(team) 返回该队的「阵面坐标系」：
     cx,cy ：阵形中心（队员平均位置）
     ax,ay ：战线方向（沿这条线横向排开）
     nx,ny ：正面朝向（指向敌人，纵深沿这个方向排）
   结果按 FORM_REFRESH 缓存，避免每帧为每个单位重算。
   敌人方向取「本队所有敌人的平均位置」——比单个目标更稳定，
   不会因为某个人换目标导致整个阵形原地旋转。 */
function teamFrame(team){
  if(!G.frames) G.frames={};
  const now=G.time||0;
  const fr=G.frames[team];
  if(fr&&now-fr.t<FORM_REFRESH) return fr;
  let cx=0,cy=0,n=0;
  let ex=0,ey=0,en=0;
  for(const u of G.units){
    if(!u.alive) continue;
    if(u.team===team){ cx+=u.x; cy+=u.y; n++; }
    else if(u.kind==='z'||u.team!==team){ ex+=u.x; ey+=u.y; en++; }
  }
  if(!n) return null;
  cx/=n; cy/=n;
  let nx,ny;
  if(en){ nx=ex/en-cx; ny=ey/en-cy; }
  else { nx=(VW/2-cx); ny=(VH/2-cy); }
  const nl=Math.hypot(nx,ny);
  if(nl<1e-3){ nx=1; ny=0; } else { nx/=nl; ny/=nl; }
  const out={cx:cx,cy:cy,nx:nx,ny:ny,ax:-ny,ay:nx,t:now};
  G.frames[team]=out;
  return out;
}
/* 该单位在阵形里的「理想位置」。
   file 是他横向的序号（生成时分配，稳定不变），
   排号由兵种决定 —— 于是每个人都知道自己该站哪儿。 */
function formationSlot(u,fr){
  const rank=RANK_DEPTH[u.cls];
  if(rank===undefined) return null;
  const RS=G.radScale||1;
  const file=(u.file!==undefined?u.file:0)-(u.fileMid||0);
  const lat=file*FILE_GAP*RS;
  /* 纵深符号：n 指向敌人，所以「靠前」= 沿 +n 偏移更大。
     排号 0（盾卫）要最靠前 → 用 (MID_RANK - rank)。
     曾误写成 rank*RANK_STEP，导致狙击手被推到最前、盾兵缩到最后，队形整个反向。 */
  const dep=(MID_RANK-rank)*RANK_STEP*RS;
  const push=(u.cls==='shieldman')?RANK_STEP*0.9*RS:0;
  return {
    x:fr.cx+fr.ax*lat+fr.nx*(dep+push),
    y:fr.cy+fr.ay*lat+fr.ny*(dep+push),
  };
}
/* 队形引力：朝自己的格位走。返回 {dx,dy,mul} 或 null（已到位/不适用）。
   只在「没有紧急情况」时生效 —— 后撤、突围、被派遣时不列阵。 */
function formationPull(u,fr,dt){
  if(!fr) return null;
  const slot=formationSlot(u,fr);
  if(!slot) return null;
  const dx=slot.x-u.x, dy=slot.y-u.y;
  const d=Math.hypot(dx,dy);
  if(d<FORM_ARRIVE) return null;
  /* 越远越急；但整体幅度有限，不会压过交火与后撤 */
  const mul=Math.min(1,d/70);
  return {dx:dx/d,dy:dy/d,mul:mul};
}
/* 为每队的成员分配横向序号（file）并记录中点，供 formationSlot 居中 */
function assignFiles(team){
  const list=[];
  for(const u of G.units){
    if(u.alive&&u.team===team&&RANK_DEPTH[u.cls]!==undefined) list.push(u);
  }
  list.sort((a,b)=>a.id-b.id);
  const mid=(list.length-1)/2;
  for(let i=0;i<list.length;i++){
    list[i].file=i;
    list[i].fileMid=mid;
  }
}

/* ---------------- 团队态势判断（让部队「会思考」） ----------------
   返回 {surrounded, escapeDir, spare, supportTarget}。
   ① surrounded：四周都被僵尸逼近 → 该集中突破而不是各自逃散
      · 统计 8 个方向上「最近僵尸的距离」，若 6 个以上方向都很近，就算被围
      · escapeDir 指向「僵尸最稀疏」的那个反方向
   ② spare：身边友军很多、且当前区域敌人已被很多人围攻 → 火力冗余，可分兵
   ③ supportTarget：附近正在交战但人手不足的同伴（去支援它）
   这个函数只做「读」操作，不改单位状态，安全且便宜（用网格查询）。 */
const SURROUND_R=150;          // 判定被包围的探测半径
const SURROUND_DIRS=8;         // 采样方向数
const SURROUND_NEED=6;         // 多少个方向有敌人算「被围」
const SUPPORT_ARRIVE=90;       // 支援到位的判定距离
const SUPPORT_LOCK=3.0;        // 一次支援指令锁定时长（秒）
const SPARE_FRIENDS=6;         // 附近多少友军算「火力冗余」
const SPARE_ENEMIES=4;         // 一个敌人被多少人打就算「打够了」
function teamSituation(u){
  const out={surrounded:false,escapeDir:{x:1,y:0},spare:false,supportTarget:null};
  /* 八个方向各自找最近的僵尸 */
  const near=new Array(SURROUND_DIRS).fill(1e9);
  let friends=0, foesInRange=0;
  const crowd={};                             // 敌人 id → 有多少友军在打它
  /* 扫描半径要覆盖「包围判定 + 友军统计」，否则远处围上来的僵尸数不到 */
  const scanR=Math.max(SURROUND_R*1.5,COHESION_R*1.6);
  forEachNear(u.x,u.y,o=>{
    if(o===u) return;
    if(o.team===u.team){
      friends++;
      /* 统计友军各自锁定的目标，判断哪些敌人「被打够了」 */
      const tr=o.targetRef;
      if(tr&&tr.alive) crowd[tr.id]=(crowd[tr.id]||0)+1;
      return;
    }
    if(o.kind!=='z') return;
    const dx=o.x-u.x, dy=o.y-u.y;
    const dd=Math.hypot(dx,dy);
    if(dd>SURROUND_R) return;
    foesInRange++;
    /* 归入最近的方向扇区 */
    /* 归入最近的方向扇区。
       ★ 不能用 Math.floor(ang/TAU*DIRS)：角度恰好落在扇区边界时
         （如 45° → 45/360*8 = 0.9999999），floor 会把它算到前一格，
         导致「对角方向的敌人」两两挤进同一扇区，被围判定永远不成立。
         改用「四舍五入到最近的扇区中心 + 取模」，边界归属稳定。 */
    let ang=Math.atan2(dy,dx); if(ang<0) ang+=TAU;
    const idx=Math.round(ang/TAU*SURROUND_DIRS)%SURROUND_DIRS;
    if(dd<near[idx]) near[idx]=dd;
  },scanR);
  /* ① 被包围判定 */
  let closed=0, openIdx=-1, openDist=-1;
  for(let i=0;i<SURROUND_DIRS;i++){
    if(near[i]<SURROUND_R*0.72) closed++;
    if(near[i]>openDist){ openDist=near[i]; openIdx=i; }
  }
  out.diag={near:near,closed:closed,friends:friends,foes:foesInRange};
  if(closed>=SURROUND_NEED){
    out.surrounded=true;
    const a=(openIdx+0.5)/SURROUND_DIRS*TAU;   // 最空的方向 = 突破口
    out.escapeDir={x:Math.cos(a),y:Math.sin(a)};
    return out;
  }
  /* ② 火力冗余：友军多、敌人少且被打得够狠 */
  let overkilled=0;
  for(const k in crowd) if(crowd[k]>=SPARE_ENEMIES) overkilled++;
  if(friends>=SPARE_FRIENDS&&foesInRange>0&&overkilled>=1) out.spare=true;
  /* ③ 找一个「正在挨打但人手不足」的同伴去支援 */
  if(out.spare){
    let best=null,bs=-1;
    forEachNear(u.x,u.y,a=>{
      if(a===u||a.team!==u.team) return;
      const t=a.targetRef;
      if(!t||!t.alive) return;
      const helping=crowd[t.id]||0;
      if(helping>=SPARE_ENEMIES) return;        // 那个敌人已经够多人打了
      const dd=Math.hypot(a.x-u.x,a.y-u.y);
      if(dd>COHESION_R*1.6||dd<SUPPORT_ARRIVE) return;   // 太远不必去，太近已经在帮了
      const score=(SPARE_ENEMIES-helping)*100-dd*0.1;
      if(score>bs){ bs=score; best=a; }
    },COHESION_R*1.6);
    out.supportTarget=best;
  }
  return out;
}
/* 朝指定方向最近的敌人（用于集中突破时选择射击目标） */
function nearestEnemyInDir(u,ex,ey){
  let best=null,bs=1e9;
  forEachNear(u.x,u.y,o=>{
    if(o.team===u.team||o.kind!=='z') return;
    const dx=o.x-u.x, dy=o.y-u.y;
    const dd=Math.hypot(dx,dy);
    if(dd<1) return;
    const dot=(dx/dd)*ex+(dy/dd)*ey;
    if(dot<0.35) return;                        // 只考虑突破方向前方 ±70° 内的敌人
    const score=dd-dot*80;                      // 近且正对准的优先
    if(score<bs){ bs=score; best=o; }
  },Math.max(VW,VH));
  return best;
}
/* ---------------- 目标选择：像真人一样判断威胁 ----------------
   真人不会机械地打「最近的那个」，而是会权衡：
     ① 谁已经贴到脸上了（最紧急）
     ② 谁最危险（跑尸冲得快、母体是兵工厂、大胃袋会爆）
     ③ 谁已经被队友打了（补枪 / 集火，效率最高）
   之前的 nearestEnemy 只看距离，导致：
     · 远处的母体被无视，一直被它孵怪
     · 全队各打各的，火力分散，单个目标要打很久
   这里给每个候选打分，分数最低者当选（距离为主，威胁与集火做修正）。 */
function humanTargetScore(u,o,d){
  let s=d;
  /* ② 兵种威胁度：越危险越优先。跑尸速度 86 直扑后排，母体持续孵化 */
  const cls=o.cls;
  if(o.kind==='z'){                          // 威胁加成只对僵尸型有意义
    if(cls==='runner')      s-=TILE*1.6;     // 高速突击兵，最容易咬到人
    else if(cls==='mother') s-=TILE*1.2;     // 兵工厂，拖越久越亏
    else if(cls==='umother')s-=TILE*1.0;
    else if(cls==='bigbelly')s-=TILE*0.5;    // 死了会炸，但靠近才危险
  }
  /* ③ 集火：已被队友盯上的目标优先补枪（团队效率） */
  if(o._focus&&o._focus>0) s-=TILE*0.9;
  /* 已经重伤的目标：收掉它比开新的更划算 */
  if(o.maxHp>0&&o.hp/o.maxHp<0.35) s-=TILE*0.7;
  return s;
}
function pickHumanTarget(u,searchR){
  let best=null,bs=1e9;
  forEachNear(u.x,u.y,o=>{
    if(!o.alive||o.team===u.team) return;
    /* ★ 不能只把僵尸当目标：本作支持「人类 vs 人类」「三方混战」，
       过滤掉非僵尸会让这些模式完全打不起来（回归测试直接挂掉）。 */
    const d=Math.hypot(o.x-u.x,o.y-u.y);
    if(d>searchR) return;
    if(!losClear(u.x,u.y,o.x,o.y)) return;
    const sc=humanTargetScore(u,o,d);
    if(sc<bs){ bs=sc; best=o; }
  },searchR);
  return best;
}
function tickHuman(u,dt){
  const d=CLASSES[u.cls];
  if(d.heal) medicTick(u,d,dt);
  u.rateMul=civilianAuraMul(u);
  if(u.planT===undefined) u.planT=0;

  let dx=0,dy=0,mul=1,moving=false;
  const panicR=G.panicR;

  /* ⓪ 团队态势：火力冗余 / 被包围 —— 优先于一切常规战术
     这两个判断是「会思考的部队」和「各打各的」的分界线，
     对应 UP 视频里人类会自己调位置、集火突破的表现。 */
  const situ=teamSituation(u);

  /* ⓪-a 被包围（四周都有僵尸逼近）→ 集中火力朝「最薄的方向」突破。
     做法：不逃向最近的敌人，而是朝敌人最稀疏的一侧冲，全员朝同一点输出。 */
  if(situ && situ.surrounded){
    const ex=situ.escapeDir.x, ey=situ.escapeDir.y;
    u.breakout=true;
    u.breakDir=Math.atan2(ey,ex);
    /* 盾卫顶在最前面开路（有盾免伤，最适合破围） */
    const lead=(u.cls==='shieldman')?1.0:0.9;
    dx=ex; dy=ey; mul=lead; moving=true;
    u.dispatch=null;
    /* 朝突破口开火：把目标切到突围方向上最近的敌人 */
    const foe=nearestEnemyInDir(u,ex,ey);
    if(foe) u.aim=Math.atan2(foe.y-u.y,foe.x-u.x);
    if(!d.melee&&foe&&u.cd<=0&&shotOK(u)){
      const fdist=Math.hypot(foe.x-u.x,foe.y-u.y);
      const gun=weaponOf(u,fdist);
      if(fdist<=gun.range) { fireWith(u,gun); spendShot(u); u.cd=gun.cd/u.rateMul; }
    }
    if(moving){ steer(u,dx,dy,dt,mul); }
    return;
  }
  u.breakout=false;

  /* ⓪-b 火力冗余（附近友军足够多、敌人在射程内且已经有很多人在打）→
     一部分单位脱离战线，去支援「附近正在打但人手不足」的其他同伴。
     这样部队不会全挤在一处空耗，而是自动形成第二梯队。 */
  if(situ && situ.spare && u.supportT<=0){
    const tgt=situ.supportTarget;
    if(tgt){
      u.supportT=SUPPORT_LOCK;                    // 锁定一段时间，避免每帧改主意
      u.supportRef=tgt;
    }
  }
  u.supportT=Math.max(0,(u.supportT||0)-dt);
  if(u.supportRef && !u.supportRef.alive) { u.supportRef=null; u.supportT=0; }
  if(u.supportRef && !situ.surrounded){
    const t=u.supportRef;
    const dd=Math.hypot(t.x-u.x,t.y-u.y);
    if(dd>SUPPORT_ARRIVE){                        // 还没到位 → 赶路
      u.pathT-=dt;
      if(!u.path||u.pathT<=0||u.pathGoal!=='s'){
        u.pathT=0.9+rnd()*0.4; u.pathGoal='s'; u.path=findPath(u,t.x,t.y,u.kind);
      }
      if(!followPath(u,dt,1)) steer(u,t.x-u.x,t.y-u.y,dt,1);
      else steer(u,t.x-u.x,t.y-u.y,dt,1);
      u.dispatch=null;
      return;
    }
    u.supportRef=null;                            // 到位了，恢复正常战术
  }

  /* ① 本能：僵尸型敌人贴近就后撤（优先级最高，与预设/派遣无关）
     第⑤项：PANIC_R 已放宽到 96，并且会一直退到 panicR*(1+HUMAN_KITE) 之外才停，
     避免「刚出圈又被判定要退」的抖动。盾卫是唯一例外：血厚且能盾击，敢顶上去。 */
  const panic=nearestFoeZombie(u,panicR);
  if(panic){
    const e=panic.e;
    const holdGround=(u.cls==='shieldman'&&u.hp>u.maxHp*0.5);
    if(holdGround){
      u.aim=Math.atan2(e.y-u.y,e.x-u.x);
    } else {
      dx=u.x-e.x; dy=u.y-e.y; mul=1; moving=true;
      u.dispatch=null; u.plan=null;
      u.aim=Math.atan2(e.y-u.y,e.x-u.x);
    }
    if(!d.melee&&u.cd<=0&&shotOK(u)){
      const pdist=Math.hypot(e.x-u.x,e.y-u.y);
      const gun=weaponOf(u,pdist);
      fireWith(u,gun); spendShot(u);
      u.cd=gun.cd/u.rateMul*(0.95+rnd()*0.1); u.gunFlash=0.07;
    }
  }

  /* ② 本能：同伴被感染时，除医疗兵外都要拉开距离 */
  let avoiding=false;
  if(!panic&&!d.heal){
    const inf=nearestInfectedAlly(u,INFECTED_AVOID_R);
    if(inf){
      dx=u.x-inf.x; dy=u.y-inf.y; mul=1; moving=true; avoiding=true;
      u.dispatch=null; u.plan=null;
      /* 瞄准用最近的敌人，但给个半径上限（原为无限远全表扫描，大编制下是黑洞） */
      const foe=nearestEnemy(u,false,aimSeekR());
      if(foe&&!d.melee) u.aim=Math.atan2(foe.e.y-u.y,foe.e.x-u.x);
    }
  }

  /* ③ 玩家右键派遣的目标点 */
  if(!moving&&u.dispatch){
    u.dispatchT-=dt;
    const p=u.dispatch;
    const dd=Math.hypot(p.x-u.x,p.y-u.y);
    if(dd<=DISPATCH_EPS||u.dispatchT<=0){ u.dispatch=null; u.path=null; u.pathGoal=-1; }
    else {
      u.pathT-=dt;
      if(!u.path||u.pathT<=0||u.pathGoal!=='d'){ u.pathT=0.8+rnd()*0.4; u.pathGoal='d'; u.path=findPath(u,p.x,p.y,u.kind); }
      if(!followPath(u,dt,1)) steer(u,p.x-u.x,p.y-u.y,dt,1);
      moving=true;
    }
    /* 派遣途中不放下枪：视线内有敌人就一边走一边瞄 */
    if(!d.melee){
      const foe=nearestEnemy(u,true,gunRangeOf(u));
      if(foe) u.aim=Math.atan2(foe.e.y-u.y,foe.e.x-u.x);
    }
  }

  /* ④ 被感染的人扑向同队最近的医疗兵求救 */
  if(!moving&&u.infect>0&&!d.heal){
    const m=nearestAllyMedic(u);
    if(m){
      const dd=Math.hypot(m.x-u.x,m.y-u.y);
      if(dd>CLASSES.medic.healR*0.45){ dx=m.x-u.x; dy=m.y-u.y; mul=1; moving=true; }
    }
  }

  const beh=u.behavior||G.behavior;
  /* range 用「主武器」射程：决定索敌半径与站位。
     实际开火时再按距离在 weaponOf 里切手枪。 */
  const gun=mainGunOf(u);
  const range=gun.range;
  /* ★ 大编制性能关键：目标搜索是每帧最贵的操作（620px 半径要扫上万格）。
     但「最近的敌人是谁」在几帧内几乎不会变，所以按单位缓存，
     每 TARGET_REFRESH 秒才真正重搜一次；缓存期间复用上次结果并刷新距离。
     这既省算力，又让 AI 行为更稳定（不会因为逐个像素变化而抖目标）。 */
  const searchR=beh==='hold'?range:(d.melee?range:Math.max(range,620));
  u.targetT=(u.targetT||0)-dt;
  const cached=u.targetRef;
  if(u.targetT>0&&cached){
    if(cached.alive){ u.target=cached; }
    else { u.targetT=0; }
  }
  if(u.targetT<=0){
    /* 用「威胁评分 + 集火」挑目标，而不是单纯最近的 */
    const t2=pickHumanTarget(u,searchR);
    u.targetRef=t2||null;
    u.target=t2||null;
    u.targetT=TARGET_REFRESH*(0.8+rnd()*0.4);      // 抖动一下，避免所有单位同帧重搜
    /* 标记「这个敌人已经被盯上」，供队友的集火评分使用 */
    if(t2) t2._focus=(t2._focus||0)+1;
  }
  const s=u.target?{e:u.target,d:Math.hypot(u.target.x-u.x,u.target.y-u.y)}:null;

  if(!moving&&d.heal&&u.beamTo&&u.beamTo.alive){
    const t=u.beamTo, dd=Math.hypot(t.x-u.x,t.y-u.y);
    if(dd>d.healR*0.65){ dx=t.x-u.x; dy=t.y-u.y; mul=1; moving=true; }
  }

  if(!moving){
    const e=s?s.e:u.target;
    /* 远距离目标：先寻路靠近（各预设都一样，区别在于到位后的站位） */
    const far=!e||s.d>Math.max(range*1.1,500);
    if(far&&e&&beh!=='hold'){
      u.pathT-=dt;
      if(!u.path||u.pathT<=0||u.pathGoal!==e.id){
        u.pathT=(beh==='push'?0.7:1.0)+rnd()*0.4; u.pathGoal=e.id;
        u.path=findPath(u,e.x,e.y,u.kind);
      }
      if(!followPath(u,dt,beh==='push'?1:0.85)) steer(u,e.x-u.x,e.y-u.y,dt,0.8);
      moving=true;
    } else {
      let st=null;
      if(e){
        const dd=s?s.d:Math.hypot(e.x-u.x,e.y-u.y);
        if(dd<=range*1.02){
          const ft=dd/gun.bspeed;
          const px=e.x+(d.lead?e.vx*ft:0), py=e.y+(d.lead?e.vy*ft:0);
          u.aim=Math.atan2(py-u.y,px-u.x);
        }
        if(beh==='push')        st=pushStance(u,d,e,dt);
        else if(beh==='hold')   st=holdStance(u,d,e,dt);
        else if(beh==='free'){
          const plan=freeStance(u,e,dd,range,dt);
          u.planName=plan;
          st= plan==='push'?pushStance(u,d,e,dt):coverStance(u,d,e,range,dt);
        }
        else                    st=coverStance(u,d,e,range,dt);
      } else if(beh==='hold'){
        st=holdStance(u,d,null,dt);
      }
      if(st){ dx=st.dx; dy=st.dy; mul=st.mul; moving=st.moving; }
    }
  }

  /* ⑤ 战线维持（替代旧的「向心抱团」）
     ★ 旧做法把所有人拉向队伍质心 → 挤成一个球（500 人时是整齐方块）。
     对手（B站「这球有问题」）的队形是「有厚度、面向敌人的弧形散兵线」。
     改成两条规则：
       ① 太近（< LINE_GAP）就互相推开 —— 于是自发形成一条有宽度的战线；
       ② 太远（> COHESION_R）才往队友靠一点 —— 避免落单被吃。
     这样既不会挤成球，也不会散成沙。 */
  if(!panic&&!u.dispatch&&!avoiding&&beh!=='hold'){
    let sx=0, sy=0, sepN=0;                 // 分离力
    let cx=0, cy=0, cohN=0;                 // 聚合（仅用于防落单）
    forEachNear(u.x,u.y,a=>{
      if(a.team!==u.team||a===u) return;
      const dx=a.x-u.x, dy=a.y-u.y;
      const d=Math.hypot(dx,dy);
      if(d<1e-4) { sx+=(rnd()-0.5); sy+=(rnd()-0.5); sepN++; return; }
      if(d<LINE_GAP){                       // ① 太挤 → 推开
        const w=(LINE_GAP-d)/LINE_GAP;
        sx-=dx/d*w; sy-=dy/d*w; sepN++;
      } else if(d<=COHESION_R){             // ② 在合理范围内 → 计入队形中心
        cx+=a.x; cy+=a.y; cohN++;
      }
    },COHESION_R);
    const fx=sepN? sx/sepN : 0, fy=sepN? sy/sepN : 0;
    const fm=Math.hypot(fx,fy);
    if(fm>0.01){
      /* ★ 分离只做「微调」，绝不取代主意图。
         旧写法把 dx/dy 按最高 0.55 的权重换成分离方向、幅度还是 LINE_GAP*2，
         两个单位贴近时会互相顶住、谁也走不动（实测后撤位移被压到 1.8px）。
         现在改成：分离作为一个「有上限的偏置」叠加，主方向始终占主导，
         这样既保持间距，又不会把单位钉死。 */
      const w=Math.min(SEP_MAX_W, fm*0.5);          // 权重上限 SEP_MAX_W
      const ox=fx/fm*SEP_BIAS, oy=fy/fm*SEP_BIAS;   // 偏置幅度固定，不随拥挤放大
      dx=dx*(1-w)+ox; dy=dy*(1-w)+oy;
      const mag=Math.hypot(dx,dy);
      if(mag>1e-4){ dx/=mag; dy/=mag; }             // 保持单位方向，只改朝向
      moving=true;
    } else if(cohN>0){
      const ax2=cx/cohN-u.x, ay2=cy/cohN-u.y;
      const ad=Math.hypot(ax2,ay2);
      if(ad>COHESION_R*0.55){               // 只有明显掉队才往队友靠
        const w=moving?0.22:0.5;
        dx=dx*(1-w)+(ax2/ad)*w; dy=dy*(1-w)+(ay2/ad)*w; moving=true;
        if(mul>0.85) mul=0.85;
      }
    }
    /* ⑦ 队形引力：朝自己在该队阵形里的格位走。
       ★ 这是「像真实部队一样列阵」的核心 —— 让盾兵在前、狙击在后、
         同排的人横向拉开，而不是所有人朝同一个点挤。
       只在无紧急情况时生效，且权重有限（FORM_W），不会妨碍交火与后撤。 */
    if(!u.breakout&&!u.supportRef&&beh!=='hold'){
      const fr=teamFrame(u.team);
      const pull=formationPull(u,fr,dt);
      if(pull){
        const w=moving?FORM_W*0.6:FORM_W;
        dx=dx*(1-w)+pull.dx*w; dy=dy*(1-w)+pull.dy*w;
        const mag=Math.hypot(dx,dy);
        if(mag>1e-4){ dx/=mag; dy/=mag; }
        moving=true;
        if(mul>pull.mul) mul=Math.max(pull.mul,mul*0.9);
      }
    }
  }

  if(moving) steer(u,dx,dy,dt,mul); else steer(u,0,0,dt);

  /* 开火：隔窗能打（窗透射子弹），关门挡子弹。
     注意：移动 / 被派遣时同样锁定敌人，边走边打，枪口始终对准目标 */
  let fired=false;
  if(s&&!panic){
    const e=s.e, dd=s.d;
    const canSee=losClear(u.x,u.y,e.x,e.y);
    /* ★ 友军挡射界（FRIENDLY_BLOCK 开启时）：
       视频里 500 人排成薄弧形线，只有最前排能开火，母体因此能活 20+ 秒。
       我们不这么做时，几百人挤在一起同时输出 → 目标秒杀、没有攻防节奏。
       加上这条后：后排要先走到能打的位置，队形自然铺开成散兵线，
       同时开火人数被压在合理范围，平衡与画面都对上了。 */
    const laneOK=!FRIENDLY_BLOCK||friendlyLaneClear(u,e);
    /* 按距离选武器：狙击手被贴近时自动换手枪（见 weaponOf） */
    const wpn=weaponOf(u,dd);
    if(!d.melee&&canSee&&laneOK&&dd<=wpn.range*1.05){      // 先瞄准（带预判），再决定是否开火
      const ft=dd/wpn.bspeed;
      u.aim=Math.atan2((e.y+(d.lead?e.vy*ft:0))-u.y,(e.x+(d.lead?e.vx*ft:0))-u.x);
    }
    /* 盾卫：朝敌人举盾。★ 转向是「缓慢且持续」的 ——
       不是瞬间对准，而是以 SHIELD_TURN 的角速度往目标方向转。
       这样敌人绕后时盾牌来不及跟上，就有真实的破绽窗口，
       而不是无脑正面免疫（那是无敌而不是坦克）。 */
    if(d.shield){
      const want=Math.atan2(e.y-u.y,e.x-u.x);
      const cur=(u.shieldDir===undefined?want:u.shieldDir);
      let diff=Math.atan2(Math.sin(want-cur),Math.cos(want-cur));
      const step=SHIELD_TURN*dt;
      if(Math.abs(diff)<=step) u.shieldDir=want;
      else u.shieldDir=cur+Math.sign(diff)*step;
    }
    if(u.cd<=0){
      if(d.shield&&u.cd<=0&&shieldBash(u,d,e,dd)){ fired=true; }
      else if(d.melee){
        const reach=d.range+e.radius+u.radius*0.4;
        if(dd<=reach&&meleeReach(u.x,u.y,e.x,e.y)){
          u.aim=Math.atan2(e.y-u.y,e.x-u.x);
          u.cd=d.cd; u.lunge=0.12; damage(e,d.dmg,u);
          /* 僵尸撕咬：仅 ~12% 概率嘶吼（满场僵尸每口都叫会把枪声全盖住） */
          if(rnd()<0.12) sfx('zombieCall',u.x,u.y); else sfx('melee',u.x,u.y);
        }
      } else if(canSee&&laneOK&&dd<=wpn.range&&shotOK(u)&&shieldMayShoot(u)){
        fireWith(u,wpn); spendShot(u);
        u.cd=wpn.cd/u.rateMul*(0.95+rnd()*0.1);
        u.gunFlash=0.07; fired=true;
        sfx(gunSfxName(u.cls,dd),u.x,u.y);
      }
    }
    /* 步兵掷手雷（第③项）：冷却较长，只对小范围内的敌群使用 */
    if(u.cls==='rifle'&&u.throwT<=0&&u.throwCd<=0&&canSee&&dd<=range*0.9){
      const tx=e.x+e.vx*0.35, ty=e.y+e.vy*0.35;
      if(grenadeWorthIt(u,tx,ty)) throwGrenade(u,tx,ty);
    }
  }
  /* 无战斗时主动换弹（喷火兵没打空不许换，canReload 里已拦截） */
  if(G.reloadOn&&!d.melee&&!fired&&!panic&&!s) startReload(u);
}
/* 盾卫：最近 SHIELD_HIT_WINDOW 秒内挨过打 → 举盾防御，不能开枪。
   设计确认 ③：判定窗口为 2 秒。非盾卫角色恒为 true。 */
function shieldMayShoot(u){
  /* 翻窗期间双手都在爬窗，不能开枪 —— 与「翻窗慢」一起构成代价 */
  if(u.vaultT>0) return false;
  if(u.cls!=='shieldman') return true;
  return !(u.hurtT>0);
}
/* 盾击：朝盾牌方向近距离把敌人推开并造成少量伤害 */
/* ---------------- 盾击 ----------------
   盾卫的核心「防御对抗」手段：不只是推开，而是**打断进攻**。
   强化点（对应用户要求）：
     · 击退速度 230 → 520（真正推得动，不是蹭一下）
     · 新增**硬直**：被盾击命中的单位 stunT 期间无法攻击、无法移动，
       这样盾卫能把贴脸的僵尸强行推开并争取到重新列阵的时间
     · 命中后给盾卫一点「喘息」—— 短暂不受 SHIELD_HIT_WINDOW 的射击封锁，
       让它有机会还击（否则一直被咬就永远开不了枪，只能挨打）
     · 击退期间单位处于 SHIELD_KNOCK_T 的强制位移状态，视觉上明显被撞飞 */
function shieldBash(u,d,e,dd){
  const sh=d.shield;
  const reach=sh.reach+e.radius+u.radius*0.5;
  if(dd>reach) return false;
  const a=Math.atan2(e.y-u.y,e.x-u.x);
  const diff=Math.atan2(Math.sin(a-u.shieldDir),Math.cos(a-u.shieldDir));
  if(Math.abs(diff)>SHIELD_ARC) return false;          // 不在盾牌正面
  u.cd=sh.cd; u.lunge=0.1; u.shieldHitFx=0.28;
  u.aim=u.shieldDir;
  damage(e,sh.dmg,u);
  if(e.alive){
    const kb=sh.kb;
    /* 击退：给瞬时速度 + 强制位移状态 */
    e.pushVx=Math.cos(a)*kb; e.pushVy=Math.sin(a)*kb;
    e.vx+=Math.cos(a)*kb*0.6; e.vy+=Math.sin(a)*kb*0.6;
    e.knockT=SHIELD_KNOCK_T;                           // 强制位移窗口
    /* 硬直：打断僵尸的进攻节奏（这是盾卫真正的价值） */
    e.stunT=Math.max(e.stunT||0, sh.stun||SHIELD_STUN);
    e.cd=Math.max(e.cd||0, sh.stun||SHIELD_STUN);      // 攻击冷却一并后延
    burst(e.x,e.y,'#cfe0ff',8);
  }
  spark(e.x,e.y,'#cfe0ff',10);
  /* 盾卫自己短暂解除「挨打就不能开枪」的封锁，获得还击窗口 */
  u.hurtT=Math.max(0,(u.hurtT||0)-0.7);
  sfx('bash',u.x,u.y);
  return true;
}
/* 手雷值不值得扔：落点附近至少要有 2 个敌人，或 1 个大型僵尸 */
function grenadeWorthIt(u,tx,ty){
  let n=0, big=false;
  for(const o of G.units){
    if(!o.alive||o.team===u.team) continue;
    const dd=Math.hypot(o.x-tx,o.y-ty);
    if(dd>GRENADE_R*0.85) continue;
    n++;
    if(CLASSES[o.cls].radius>=10||o.maxHp>=300) big=true;
  }
  return n>=2||big;
}
function infectChance(d){ return d.infect===true||d.infect===1?1:(Number(d.infect)||0); }
/* 友军是否挡住了射界：检查「自己→目标」这条线中间有没有同队单位。
   用网格只取沿线附近的桶，成本很低。
   只挡近距离的同伴（贴脸那种），避免后方远处的友军误判成遮挡。 */
function friendlyLaneClear(u,e){
  const dx=e.x-u.x, dy=e.y-u.y;
  const dist=Math.hypot(dx,dy);
  if(dist<1) return true;
  const ux=dx/dist, uy=dy/dist;
  const len=Math.min(dist*0.9, u.radius+LANE_BLOCK_DIST);   // 只看身前一段
  let blocked=false;
  forEachNear(u.x+ux*len*0.5, u.y+uy*len*0.5, o=>{
    if(blocked||o===u||o.team!==u.team) return;
    /* o 是否落在这条射线的细长条里 */
    const ox=o.x-u.x, oy=o.y-u.y;
    const proj=ox*ux+oy*uy;
    if(proj<=u.radius*1.2||proj>len) return;
    const perp=Math.abs(ox*(-uy)+oy*ux);
    if(perp < o.radius+u.radius*0.6) blocked=true;
  }, len+40);
  return !blocked;
}
function tickZombie(u,dt){
  const d=CLASSES[u.cls];
  if(d.hatch){ u.childT-=dt; if(u.childT<=0) tryHatch(u,d); }
  /* 尸变僵直：刚爬起来的僵尸要缓一会儿才行动（超临界感染的正反馈设计） */
  if(u.rouseT>0){ u.rouseT-=dt; steer(u,0,0,dt); return; }

  /* 玩家派遣优先：走到指定点再自行交战 */
  if(u.dispatch){
    u.dispatchT-=dt;
    const p=u.dispatch, pd=Math.hypot(p.x-u.x,p.y-u.y);
    if(pd<=DISPATCH_EPS||u.dispatchT<=0){ u.dispatch=null; u.path=null; u.pathGoal=-1; }
  }

  /* 找最近的人类型敌人。★ 必须给搜索半径：
     旧代码 nearestEnemy(u,false) 没传 maxD → 每个僵尸每帧全表扫描，
     500 单位时这是最大的性能黑洞。僵尸只需要「附近」的目标来近战/寻路，
     用一个足够大的有限半径即可，行为上与无限远几乎无差别。 */
  u.targetT=(u.targetT||0)-dt;
  if(u.targetT>0&&u.targetRef){
    if(u.targetRef.alive){ u.target=u.targetRef; }
    else { u.targetT=0; }
  }
  if(u.targetT<=0){
    const s2=nearestEnemy(u,false,zombieSeekR());
    u.targetRef=s2?s2.e:null;
    u.target=s2?s2.e:null;
    u.targetT=TARGET_REFRESH*(0.8+rnd()*0.4);
  }
  const s=u.target?{e:u.target,d:Math.hypot(u.target.x-u.x,u.target.y-u.y)}:null;
  if(!s){
    if(u.dispatch){
      u.pathT-=dt;
      if(!u.path||u.pathT<=0){ u.pathT=0.9+rnd()*0.5; u.path=findPath(u,u.dispatch.x,u.dispatch.y,u.kind); }
      if(!followPath(u,dt,1)) steer(u,u.dispatch.x-u.x,u.dispatch.y-u.y,dt,1);
      return;
    }
    steer(u,0,0,dt); return;
  }
  const e=s.e, dd=s.d;
  /* ★ 破拆：僵尸不该因为「绕得过去」就放过挡路的东西。
     旧逻辑只在「门恰好是当前路径点」且 50px 内才撞门，
     于是只要 A* 能找到绕行路线，僵尸就永远不去破坏门窗 ——
     玩家把平民/防线塞在门窗后面就能无脑苟住。
     新逻辑分三层（都优先于追击）：
       ① 眼前就有门/窗挡在我和目标之间 → 砸开它（最近的那一格）
       ② 卡住了（trackStuck 判定）→ 砸身边最近的可破坏物
       ③ 路径点上的门 → 照旧撞（保留原有行为） */
  const breaker=nearestBreakable(u,e);
  if(breaker){
    const bx=cx_of(breaker.tx), by=cy_of(breaker.ty);
    u.aim=Math.atan2(by-u.y,bx-u.x);
    if(u.cd<=0){
      u.cd=d.cd; u.lunge=0.12;
      breakTile(breaker.tx,breaker.ty,d.dmg*1.5,u);
    }
    steer(u,0,0,dt);
    return;
  }
  /* ② 卡住超过一会儿 → 砸身边最近的可破坏结构（哪怕不在正前方）。
     这一段解决「僵尸被门/窗卡住却在原地磨蹭」的观感问题。 */
  if(u.stuck>0.5){
    const nb=nearestBreakableAny(u);
    if(nb){
      const bx=cx_of(nb.tx), by=cy_of(nb.ty);
      u.aim=Math.atan2(by-u.y,bx-u.x);
      if(u.cd<=0){ u.cd=d.cd; u.lunge=0.12; breakTile(nb.tx,nb.ty,d.dmg*1.5,u); }
      steer(u,0,0,dt);
      return;
    }
  }
  const wp=u.path&&u.path[0];
  if(wp){
    const tx=(wp.x/TILE)|0, ty=(wp.y/TILE)|0;
    if(inB(tx,ty)&&G.map[idx(tx,ty)]===DOOR&&G.doorHP[idx(tx,ty)]>0&&Math.hypot(wp.x-u.x,wp.y-u.y)<50){
      u.aim=Math.atan2(wp.y-u.y,wp.x-u.x);
      if(u.cd<=0){ u.cd=d.cd; u.lunge=0.12; breakDoor(tx,ty,d.dmg*1.5,u); }
      steer(u,0,0,dt);
      return;
    }
  }
  const reach=d.range+e.radius+u.radius*0.4;
  if(dd<=reach && meleeReach(u.x,u.y,e.x,e.y)){
    u.aim=Math.atan2(e.y-u.y,e.x-u.x);
    if(u.cd<=0){
      u.cd=d.cd*(0.9+rnd()*0.2); u.lunge=0.12;
      damage(e,d.dmg,u);
      /* ★ 盾卫成功防御（正面挡住这次撕咬）时，**连感染一起免疫**。
         damage() 内部已经把正面伤害削成 0，但那只是「不掉血」；
         僵尸的撕咬还带感染，如果不管就会「明明盾牌挡住了却被咬出感染」，
         逻辑上说不通。这里用同一个判定：盾牌挡住 → 不感染。 */
      const blocked=e.alive&&shieldBlocked(e,u);
      if(blocked) shieldSpark(e,u);
      if(e.alive&&e.kind==='h'&&!blocked){
        if(d.instant){                                   // 终极母体：当场尸变
          pushFeed(u.name+' '+u.label+' 一口咬穿了 '+e.label+'！','i');
          convertUnit(e,u.team);
        } else {
          /* 超临界感染：僵尸阵营占比越高，单次撕咬的感染概率越高（正反馈）。
             这让曲线呈现「潜伏 → 引爆」而非线性推进，与视频中的爆发一致。 */
          const p=Math.min(1,infectChance(d)*(1+plagueBoost()));
          if(p>0 && rnd()<p) infect(e,u.team);
        }
      }
    }
    steer(u,e.x-u.x,e.y-u.y,dt,0.35);
    return;
  }
  /* 派遣点在附近且还没到 → 先过去 */
  if(u.dispatch){
    const pd=Math.hypot(u.dispatch.x-u.x,u.dispatch.y-u.y);
    if(pd>DISPATCH_EPS && dd>reach*2.2){
      u.pathT-=dt;
      if(!u.path||u.pathT<=0){ u.pathT=0.7+rnd()*0.4; u.path=findPath(u,u.dispatch.x,u.dispatch.y,u.kind); }
      if(!followPath(u,dt,1)) steer(u,u.dispatch.x-u.x,u.dispatch.y-u.y,dt,1);
      return;
    }
  }
  u.pathT-=dt;
  if(!u.path||u.pathT<=0||u.pathGoal!==e.id){ u.pathT=0.6+rnd()*0.5; u.pathGoal=e.id; u.path=findPath(u,e.x,e.y,u.kind); }
  if(!followPath(u,dt,1)) steer(u,e.x-u.x,e.y-u.y,dt);
}
function tickUnit(u,dt){
  u.prevX=u.x; u.prevY=u.y;
  ensureFree(u);
  u.hitFlash=Math.max(0,u.hitFlash-dt);
  u.slowT=Math.max(0,u.slowT-dt);
  u.lunge=Math.max(0,u.lunge-dt);
  u.flash=Math.max(0,u.flash-dt);
  u.gunFlash=Math.max(0,u.gunFlash-dt);
  u.hatchFx=Math.max(0,u.hatchFx-dt);
  u.infectFx=Math.max(0,u.infectFx-dt);
  u.burnFx=Math.max(0,u.burnFx-dt);
  u.shieldHitFx=Math.max(0,u.shieldHitFx-dt);
  u.hurtT=Math.max(0,u.hurtT-dt);
  u.throwing=Math.max(0,u.throwing-dt);
  u.throwT=Math.max(0,u.throwT-dt);
  u.throwCd=Math.max(0,u.throwCd-dt);
  u.unstuckT=Math.max(0,(u.unstuckT||0)-dt);
  /* ★ 盾击硬直 / 击退窗口：
     stunT > 0 时单位**完全不能行动**（不攻击、不移动），
     只受击退位移支配 —— 这是盾卫「强行打断僵尸进攻」的实现。
     knockT > 0 时把 pushV 以递减速度施加到位置上。 */
  u.stunT=Math.max(0,(u.stunT||0)-dt);
  u.knockT=Math.max(0,(u.knockT||0)-dt);
  if(u.knockT>0&&(u.pushVx||u.pushVy)){
    const k=u.knockT/SHIELD_KNOCK_T;            // 1 → 0 衰减
    const step=(dt*60)*(0.35+0.65*k);           // 前段快、后段慢
    const nx=u.x+u.pushVx*dt*step, ny=u.y+u.pushVy*dt*step;
    const tx=(nx/TILE)|0, ty=(ny/TILE)|0;
    if(inB(tx,ty)&&!blocksMove(G.map[idx(tx,ty)],tx,ty,u.kind)){ u.x=nx; u.y=ny; }
    else { u.pushVx=u.pushVy=0; u.knockT=0; }   // 撞墙就停
    u.vx=u.pushVx*0.5; u.vy=u.pushVy*0.5;
    gridDirty=true;
  }
  if(u.knockT<=0){ u.pushVx=0; u.pushVy=0; }
  /* 硬直期间不执行任何 AI（但保留上面已更新的计时器） */
  if(u.stunT>0){ u.vx*=0.8; u.vy*=0.8; return; }
  u.cd-=dt;
  stepReload(u,dt);
  if(u.spawnT>0){ u.spawnT-=dt; return; }
  trackStuck(u,dt);
  if(u.kind==='h') tickHuman(u,dt); else tickZombie(u,dt);
}
/* 感染倒计时独立成一轮：等所有单位行动完（含医疗兵治疗）再结算。
   本 tick 刚被治疗的单位跳过自然流逝，否则「治疗刚把它压到 0.16 秒」会被同一 tick 的 dt 归零而误判尸变 */
function stepInfections(dt){
  for(const u of G.units){
    if(!u.alive||u.kind!=='h'||u.infect<=0) continue;
    if(u.purgedTick===G.tick) continue;
    u.infect-=dt;
    if(u.infect<=0) convertUnit(u,u.infectFrom);
  }
}

/* ---------------- 战斗判定 ---------------- */
function updateTeamTargets(){
  G.civPos.length=0;
  for(const u of G.units){
    if(!u.alive) continue;
    if(u.cls==='civilian') G.civPos.push({x:u.x,y:u.y,team:u.team});
  }
}
function hpFrac(tid){
  let a=0,b=0;
  for(const u of G.units){ if(u.team!==tid) continue; b+=u.maxHp; if(u.alive) a+=u.hp; }
  return b>0?a/b:0;
}
function aliveCount(tid){
  let n=0;
  for(const u of G.units) if(u.alive&&u.team===tid) n++;
  return n;
}
function endMatch(winner,reason){ G.result={winner:winner,reason:reason,time:G.time}; G.phase='result'; }
function wavesRemaining(){
  if(!waveOn||!waves) return 0;
  return Math.max(0,waves.length-G.waveIdx);
}
function checkEnd(){
  /* ★ 撤离模式有**自己的胜负条件**：不能用「杀掉所有僵尸」来结束。
     否则救援队清完场内的僵尸就立刻判胜，平民还在半路上，
     撤离永远做不完（实测卡在距撤离区 170px 处比赛就结束了）。
     规则：所有平民都有结果（撤离成功或牺牲）才算结束；
           或者时间耗尽，按「已撤离人数」判定。 */
  if(G.mission&&G.mission.on){
    const m=G.mission;
    if(missionComplete()){
      /* 全都有结果 → 看救出多少 */
      const pc=m.total?Math.round(m.saved/m.total*100):0;
      return endMatch(m.saved>0?0:-1,'撤离结束：救出 '+m.saved+'/'+m.total+' 名平民（'+pc+'%）');
    }
    if(G.time>=G.matchTime){
      const pc=m.total?Math.round(m.saved/m.total*100):0;
      return endMatch(m.saved>0?0:-1,'时间耗尽：救出 '+m.saved+'/'+m.total+' 名平民（'+pc+'%）');
    }
    return;                      // 任务未完成 → 比赛继续
  }
  const live=[];
  for(let i=0;i<teams.length;i++) if(aliveCount(i)>0) live.push(i);
  if(!live.length) return endMatch(-1,'双方同归于尽');
  /* 僵尸轮次：还有待投放的波次，僵尸方就不算被清空 */
  if(waveOn&&wavesRemaining()>0){
    const humans=[];
    for(let i=0;i<teams.length;i++) if(teams[i].type==='h'&&aliveCount(i)>0) humans.push(i);
    if(!humans.length) return endMatch(-1,'人类阵营全员阵亡');
    if(G.time>=G.matchTime){
      let best=humans[0], bf=hpFrac(humans[0]);
      for(const i of humans){ const f=hpFrac(i); if(f>bf){ bf=f; best=i; } }
      return endMatch(best,'时间耗尽，按人类剩余战力判定');
    }
    return;
  }
  if(live.length===1){
    const w=live[0];
    return endMatch(w, teams.length>2 ? teamName(w)+' 击败了其余所有队伍'
                                      : (w===0?'僵尸阵营被全部清除':'人类型阵营全员阵亡'));
  }
  if(G.time>=G.matchTime){
    let best=live[0], bf=hpFrac(live[0]);
    for(const i of live){ const f=hpFrac(i); if(f>bf){ bf=f; best=i; } }
    const second=live.filter(i=>i!==best).map(i=>hpFrac(i));
    if(second.length&&Math.abs(bf-Math.max.apply(null,second))<0.02) return endMatch(-1,'时间耗尽，双方战力持平');
    return endMatch(best,'时间耗尽，按剩余战力判定');
  }
}
function stepSim(dt){
  if(G.phase!=='battle') return;
  G.time+=dt; G.tick++;
  /* ★ 撤离模式的安全网：每帧清一次选择集里的非人类单位。
     前面已经在框选 / 点选 / 全选三处加了权限判断，
     但任何新增的选择路径都可能漏掉 —— 这里兜底，
     保证「撤离模式只能控制人类」是**严格执行**的，
     而不是依赖每条路径都记得调 commandable()。 */
  if(G.missionLock&&typeof pruneSelection==='function') pruneSelection();
  stepWaves(dt);
  updateTeamTargets();
  /* ★ 网格必须在 AI 之前重建：
     邻居查询（nearestEnemy / localAllyCenter / 后撤本能…）都在 tickUnit 里调用，
     如果等单位行动完才建，它们读到的就是「上一帧的位置」，
     首帧或换场景后更会读到其他场景的陈旧引用（曾导致 18 项回归失败）。
     单位位置每帧都在变，所以这里用 gridDirty 强制重建。 */
  gridDirty=true;
  gridEnsure();
  /* ★ 音效预算必须在**单位行动之前**重置！
     旧代码把 sfxStep(dt) 放在 stepSim 末尾（第 1304 行），
     而单位在第 1281 行就已经开火了 —— 于是第一帧用光预算后，
     后续每一帧的枪声都在「预算已耗尽」的状态下被丢掉，
     实测 **100% 的武器音效从未播出**（这就是用户说的「枪声还是丢失了」）。
     配额必须在本帧任何 sfx() 调用之前刷新。 */
  sfxStep(dt);
  const us=G.units;
  for(let i=0;i<us.length;i++){ if(us[i].alive) tickUnit(us[i],dt); }
  stepInfections(dt);
  stepBurns(dt);
  stepMission(dt);              // 撤离模式：平民跟随 / 进入撤离区判定
  gridDirty=true;
  gridEnsure();
  separation();
  for(let i=0;i<us.length;i++){ if(us[i].alive){ resolveCollisions(us[i]); ensureFree(us[i]); updateVault(us[i]); } }
  stepBullets(dt);
  stepGrenades(dt);
  stepFx(dt);
  stepJets(dt);
  /* 背景音乐随战况自动换情绪（每 2 秒判断一次，避免频繁切换） */
  G.musicT=(G.musicT||0)+dt;
  if(G.musicT>=2.0){ G.musicT=0; try{ musicAuto(); }catch(e){} }
  /* 集火标记衰减：每 0.5 秒减 1，没人继续打就自然失效 */
  G.focusT=(G.focusT||0)+dt;
  if(G.focusT>=0.5){
    G.focusT=0;
    for(const u of G.units){
      if(u._focus>0){ u._focus--; if(u._focus<0) u._focus=0; }
    }
  }
  /* 注意：sfxStep(dt) 已经移到 stepSim 开头（单位行动之前），
     这里**不能**再重置一次，否则会覆盖掉本帧已经消耗的配额记录。 */
  for(let i=G.parts.length-1;i>=0;i--){
    const p=G.parts[i];
    p.life-=dt;
    if(p.life<=0){ G.parts.splice(i,1); continue; }
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.vx*=0.94; p.vy*=0.94;
  }
  for(let i=G.corpses.length-1;i>=0;i--){ const c=G.corpses[i]; c.t+=dt; if(c.t>12) G.corpses.splice(i,1); }
  for(let i=G.feed.length-1;i>=0;i--){ G.feed[i].t+=dt; if(G.feed[i].t>9) G.feed.splice(i,1); }
  if(G.dispatchMark){ G.dispatchMark.t-=dt; if(G.dispatchMark.t<=0) G.dispatchMark=null; }
  G.endT-=dt;
  if(G.endT<=0){ G.endT=0.25; checkEnd(); }
}

/* ---------------- 渲染 ---------------- */
const cvs=$('#game'), ctx=cvs.getContext('2d');
const base=document.createElement('canvas'); base.width=VW; base.height=VH;
const bctx=base.getContext('2d');
const TEAM_HEX={};
function teamColor(tid){
  if(TEAM_HEX[tid]) return TEAM_HEX[tid];
  return (TEAM_HEX[tid]=(teams[tid]?teams[tid].color:TEAM_COLORS[tid%TEAM_COLORS.length]));
}
function drawTile(c,t,x,y,s){
  const px=x*s, py=y*s;
  if(t===WALL){
    c.fillStyle='#2b3850'; c.fillRect(px,py,s,s);
    c.fillStyle='#3c4f6e'; c.fillRect(px,py,s,Math.max(2,s*0.14));
    c.fillStyle='#1b2434'; c.fillRect(px,py+s-Math.max(2,s*0.12),s,Math.max(2,s*0.12));
  } else if(t===WIN){
    c.fillStyle='rgba(88,182,255,0.20)'; c.fillRect(px,py,s,s);
    c.strokeStyle='rgba(150,220,255,0.62)'; c.lineWidth=Math.max(1,s*0.06);
    c.strokeRect(px+c.lineWidth/2,py+c.lineWidth/2,s-c.lineWidth,s-c.lineWidth);
    c.strokeStyle='rgba(220,245,255,0.30)';
    c.beginPath(); c.moveTo(px+s*0.2,py+s*0.78); c.lineTo(px+s*0.72,py+s*0.2); c.stroke();
  } else if(t===DOOR){
    c.fillStyle='rgba(255,186,88,0.20)'; c.fillRect(px,py,s,s);
    c.strokeStyle='rgba(255,208,130,0.66)'; c.lineWidth=Math.max(1,s*0.06);
    c.strokeRect(px+c.lineWidth/2,py+c.lineWidth/2,s-c.lineWidth,s-c.lineWidth);
    c.fillStyle='rgba(255,225,170,0.75)';
    c.fillRect(px+s*0.62,py+s*0.44,s*0.12,s*0.12);
  }
}
function bakeMap(){
  bctx.clearRect(0,0,VW,VH);
  bctx.fillStyle='#0a0f18'; bctx.fillRect(0,0,VW,VH);
  bctx.strokeStyle='#111a28'; bctx.lineWidth=1;
  bctx.beginPath();
  for(let x=0;x<=GW;x++){ bctx.moveTo(x*TILE+.5,0); bctx.lineTo(x*TILE+.5,VH); }
  for(let y=0;y<=GH;y++){ bctx.moveTo(0,y*TILE+.5); bctx.lineTo(VW,y*TILE+.5); }
  bctx.stroke();
  const anchors=teamAnchors(teams.length);
  bctx.font='bold 13px system-ui'; bctx.textAlign='center';
  bctx.textBaseline='alphabetic';
  for(let i=0;i<anchors.length;i++){
    const a=anchors[i], col=teamColor(i);
    const grd=bctx.createRadialGradient(a.x,a.y,10,a.x,a.y,TILE*6);
    grd.addColorStop(0,hexA(col,0.15)); grd.addColorStop(1,hexA(col,0));
    bctx.fillStyle=grd; bctx.fillRect(0,0,VW,VH);
    bctx.fillStyle=hexA(col,0.55);
    bctx.fillText(teams[i].name+' 出生区',a.x,Math.max(20,a.y-TILE*4));
  }
  for(let y=0;y<GH;y++) for(let x=0;x<GW;x++){
    const t=G.map[idx(x,y)];
    if(t===EMPTY) continue;
    if(t===DOOR&&G.doorHP[idx(x,y)]<=0){
      bctx.fillStyle='rgba(120,92,52,0.16)';
      bctx.fillRect(x*TILE+3,y*TILE+3,TILE-6,TILE-6);
      continue;
    }
    drawTile(bctx,t,x,y,TILE);
  }
  G.baseDirty=false;
  /* 地图变了 → 连通性缓存失效（出生点/平民/撤离区都依赖它） */
  G.__mainRegion=null;
}
function hexA(hex,a){
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return 'rgba('+r+','+g+','+b+','+a+')';
}
function drawCorpses(c){
  for(const p of G.corpses){
    const a=Math.max(0,1-p.t/12);
    c.fillStyle='rgba(0,0,0,'+(a*0.24).toFixed(3)+')';
    if(p.sq){
      c.fillRect(p.x-p.r*0.8,p.y-p.r*0.8,p.r*1.6,p.r*1.6);
      c.strokeStyle=hexA(p.tc||'#7fbfa0',a*0.5); c.lineWidth=1.6;
      c.strokeRect(p.x-p.r*0.8,p.y-p.r*0.8,p.r*1.6,p.r*1.6);
    } else {
      c.beginPath(); c.arc(p.x,p.y,p.r*0.6,0,TAU); c.fill();
      c.strokeStyle=hexA(p.tc||'#7f9fbf',a*0.5); c.lineWidth=2;
      c.beginPath(); c.arc(p.x,p.y,p.r*0.85,0,TAU); c.stroke();
    }
  }
}
function textColorFor(hex){
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return (0.299*r+0.587*g+0.114*b)>150 ? '#0b1220' : '#f2f8ff';
}
const TXC={}; for(const k in CLASSES) TXC[k]=textColorFor(CLASSES[k].color);

function drawUnits(c){
  const list=G.units.filter(u=>u.alive).sort((a,b)=>a.y-b.y);
  const showNums=G.showNums;
  const multi=teams.length>1;
  for(const u of list){
    const d=CLASSES[u.cls];
    let r=u.radius;
    if(u.spawnT>0) r=u.radius*(0.45+0.55*(1-u.spawnT/0.7));
    const lx=u.lunge>0?Math.cos(u.aim)*u.lunge*26:0;
    const ly=u.lunge>0?Math.sin(u.aim)*u.lunge*26:0;
    const x=u.x+lx, y=u.y+ly;
    const selected=G.selected.has(u.id);
    const tcol=teamColor(u.team);
    // 影子
    c.fillStyle='rgba(0,0,0,0.35)';
    c.beginPath(); c.ellipse(x,y+r*0.85,r*0.92,r*0.42,0,0,TAU); c.fill();
    // 选中环
    if(selected){
      c.strokeStyle='rgba(143,208,255,0.95)'; c.lineWidth=2;
      c.beginPath(); c.arc(x,y,r+9.5,0,TAU); c.stroke();
    }
    // 派遣目标连线
    if(multi&&u.dispatch){
      c.strokeStyle=hexA(tcol,0.28); c.lineWidth=1.2;
      c.beginPath(); c.moveTo(x,y); c.lineTo(u.dispatch.x,u.dispatch.y); c.stroke();
    }
    // 枪管 / 爪
    if(u.kind==='h'&&!d.melee){
      const bl=r+(u.cls==='sniper'?r*2.1:(u.cls==='mg'?r*1.6:(u.cls==='flamer'?r*1.5:(u.cls==='rocketeer'?r*2.4:r*0.85))));
      c.strokeStyle='rgba(10,14,22,0.85)'; c.lineWidth=Math.max(2,r*(u.cls==='mg'?0.34:0.26)); c.lineCap='round';
      c.beginPath(); c.moveTo(x,y); c.lineTo(x+Math.cos(u.aim)*bl,y+Math.sin(u.aim)*bl); c.stroke();
      if(u.cls==='rocketeer'){                                // 火箭筒前端加粗
        c.strokeStyle='rgba(255,140,80,0.85)'; c.lineWidth=Math.max(2,r*0.5);
        c.beginPath(); c.moveTo(x+Math.cos(u.aim)*bl*0.62,y+Math.sin(u.aim)*bl*0.62);
        c.lineTo(x+Math.cos(u.aim)*bl,y+Math.sin(u.aim)*bl); c.stroke();
      }
      if(u.gunFlash>0){
        c.fillStyle=u.cls==='flamer'?'rgba(255,170,90,0.95)':'rgba(255,236,170,0.9)';
        c.beginPath(); c.arc(x+Math.cos(u.aim)*bl,y+Math.sin(u.aim)*bl,r*(u.cls==='flamer'?0.7:0.42),0,TAU); c.fill();
      }
    } else if(u.kind==='z'){
      c.strokeStyle='rgba(20,40,26,0.7)'; c.lineWidth=Math.max(2,r*0.22); c.lineCap='round';
      for(const sgn of [-0.5,0.5]){
        const a=u.aim+sgn;
        c.beginPath(); c.moveTo(x,y); c.lineTo(x+Math.cos(a)*r*1.35,y+Math.sin(a)*r*1.35); c.stroke();
      }
    }
    // 身体
    const hit=u.hitFlash>0;
    if(u.kind==='z'){
      const w=u.cls==='runner'?r*1.5:(u.cls==='bigbelly'?r*2.7:r*2);
      const hgt=u.cls==='runner'?r*2.6:(u.cls==='bigbelly'?r*1.7:r*2);
      const bx=x-w/2, by=y-hgt/2;
      c.beginPath(); c.rect(bx,by,w,hgt);
      c.fillStyle=hit?'#ffffff':u.color; c.fill();
      c.lineWidth=2.4; c.strokeStyle='rgba(20,26,34,0.9)'; c.stroke();
      c.fillStyle='rgba(30,60,36,0.5)';
      const notches=(u.cls==='umother')?9:(u.cls==='mother')?7:(u.cls==='runner')?3:(u.cls==='bigbelly'?6:4);
      for(let i=0;i<notches;i++){
        const a=(i/notches)*TAU+u.seed;
        const nx=x+Math.cos(a)*w*0.5, ny=y+Math.sin(a)*hgt*0.5;
        c.beginPath(); c.arc(nx,ny,Math.min(w,hgt)*0.11,0,TAU); c.fill();
      }
      if(u.cls==='mother'){
        c.strokeStyle='rgba(255,220,255,0.55)'; c.lineWidth=1.6;
        c.beginPath(); c.rect(bx+w*0.19,by+hgt*0.19,w*0.62,hgt*0.62); c.stroke();
      }
      if(u.cls==='runner'){
        c.strokeStyle='rgba(230,255,220,0.6)'; c.lineWidth=1.4;
        c.beginPath(); c.moveTo(bx+w*0.5,by+hgt*0.1); c.lineTo(bx+w*0.5,by+hgt*0.9); c.stroke();
      }
      if(u.cls==='bigbelly'){                               // 大胃袋：鼓起的肚子
        c.fillStyle='rgba(255,240,170,0.5)';
        c.beginPath(); c.ellipse(x,y+hgt*0.22,w*0.42,hgt*0.34,0,0,TAU); c.fill();
        c.strokeStyle='rgba(120,100,20,0.75)'; c.lineWidth=1.5;
        c.beginPath(); c.ellipse(x,y+hgt*0.22,w*0.42,hgt*0.34,0,0,TAU); c.stroke();
      }
      if(u.cls==='umother'){                                // 终极母体：双层环 + 顶点冠
        c.strokeStyle='rgba(255,190,250,0.75)'; c.lineWidth=2;
        c.beginPath(); c.rect(bx+w*0.16,by+hgt*0.16,w*0.68,hgt*0.68); c.stroke();
        c.strokeStyle='rgba(255,120,235,0.55)'; c.lineWidth=1.4;
        c.beginPath(); c.rect(bx+w*0.32,by+hgt*0.32,w*0.36,hgt*0.36); c.stroke();
        c.fillStyle='rgba(255,220,255,0.9)';
        for(const dx of [-0.28,0,0.28]){
          c.beginPath(); c.moveTo(x+dx*w,y-hgt*0.5); c.lineTo(x+dx*w-w*0.1,y-hgt*0.74);
          c.lineTo(x+dx*w+w*0.1,y-hgt*0.74); c.closePath(); c.fill();
        }
      }
      if(multi){                                            // 队伍色外框
        c.strokeStyle=hexA(tcol,0.95); c.lineWidth=2;
        c.strokeRect(bx-2.4,by-2.4,w+4.8,hgt+4.8);
      }
    } else {
      c.beginPath(); c.arc(x,y,r,0,TAU);
      c.fillStyle=hit?'#ffffff':u.color; c.fill();
      c.lineWidth=2; c.strokeStyle='rgba(6,14,24,0.8)'; c.stroke();
      if(multi){
        c.strokeStyle=hexA(tcol,0.95); c.lineWidth=2.4;
        c.beginPath(); c.arc(x,y,r+2.2,0,TAU); c.stroke();
      }
    }
    // 医疗兵白十字 / 平民小空心
    if(u.cls==='medic'){
      c.fillStyle='rgba(40,120,80,0.95)';
      c.fillRect(x-r*0.13,y-r*0.55,r*0.26,r*1.1);
      c.fillRect(x-r*0.55,y-r*0.13,r*1.1,r*0.26);
    }
    if(u.cls==='civilian'){
      c.strokeStyle='rgba(60,110,70,0.9)'; c.lineWidth=1.4;
      c.beginPath(); c.arc(x,y,r*0.42,0,TAU); c.stroke();
    }
    /* 喷火兵：背后的燃料罐 */
    if(u.cls==='flamer'){
      const bx2=x-Math.cos(u.aim)*r*1.15, by2=y-Math.sin(u.aim)*r*1.15;
      c.fillStyle='rgba(200,90,40,0.95)';
      c.beginPath(); c.arc(bx2,by2,r*0.62,0,TAU); c.fill();
      c.strokeStyle='rgba(70,30,10,0.9)'; c.lineWidth=1.4; c.stroke();
      const fl=clamp(u.magLeft/Math.max(1,d.mag),0,1);
      c.fillStyle=fl>0.25?'rgba(255,200,120,0.95)':'rgba(255,90,60,0.95)';
      c.beginPath(); c.arc(bx2,by2,r*0.3,0,TAU); c.fill();
    }
    /* 盾卫：举盾（朝 shieldDir 的一块弧面，受击时闪白） */
    if(u.cls==='shieldman'){
      const sd=(u.shieldDir!==undefined?u.shieldDir:u.aim);
      const sr=r*1.9;
      c.beginPath();
      c.arc(x,y,sr,sd-SHIELD_ARC,sd+SHIELD_ARC);
      c.strokeStyle=u.shieldHitFx>0?'rgba(255,255,255,0.98)':'rgba(180,200,235,0.95)';
      c.lineWidth=Math.max(3,r*0.55); c.lineCap='butt'; c.stroke();
      c.strokeStyle='rgba(40,60,95,0.9)'; c.lineWidth=1.6;
      c.beginPath(); c.arc(x,y,sr,sd-SHIELD_ARC,sd+SHIELD_ARC); c.stroke();
      if(u.hurtT>0){                                     // 受击窗口：盾面泛红
        c.strokeStyle='rgba(255,120,120,'+(0.35+0.3*u.hurtT/SHIELD_HIT_WINDOW).toFixed(2)+')';
        c.lineWidth=Math.max(2,r*0.3);
        c.beginPath(); c.arc(x,y,sr+3,sd-SHIELD_ARC,sd+SHIELD_ARC); c.stroke();
      }
    }
    /* 灼烧：橙红闪烁 + 火苗 */
    if(u.burnT>0){
      const k=clamp(u.burnT/BURN_TIME,0,1);
      const pulse=0.5+0.5*Math.sin(performance.now()/70+u.seed);
      c.strokeStyle='rgba(255,140,60,'+(0.35+0.45*pulse).toFixed(2)+')';
      c.lineWidth=2.4; c.beginPath(); c.arc(x,y,r+4,0,TAU); c.stroke();
      const n=2+Math.round(3*k);
      for(let i=0;i<n;i++){
        const a=(i/n)*TAU+u.seed+pulse;
        const fx=x+Math.cos(a)*r*0.7, fy=y+Math.sin(a)*r*0.7-pulse*r*0.5;
        c.fillStyle='rgba(255,'+(150+Math.round(80*pulse))+',60,0.8)';
        c.beginPath(); c.arc(fx,fy,r*0.22*(0.6+0.4*pulse),0,TAU); c.fill();
      }
    }
    /* 投掷动作：抬手 */
    if(u.throwing>0){
      c.strokeStyle='rgba(255,255,255,0.8)'; c.lineWidth=2;
      c.beginPath(); c.moveTo(x,y);
      c.lineTo(x+Math.cos(u.aim-0.7)*r*2.2,y+Math.sin(u.aim-0.7)*r*2.2); c.stroke();
    }
    if(u.slowT>0){
      c.strokeStyle='rgba(140,215,255,0.9)'; c.lineWidth=1.6;
      c.beginPath(); c.arc(x,y,r+3.2,0,TAU); c.stroke();
    }
    if(showNums){
      c.fillStyle=hit?'#20303f':TXC[u.cls];
      c.font='bold '+(r*1.25).toFixed(1)+'px ui-monospace,monospace';
      c.textAlign='center'; c.textBaseline='middle';
      c.fillText(String(u.teamNum),x,y+0.5);
    }
    // 血条
    const bw=r*2.5, bh=Math.max(2.4,3.2*RS), by2=y-r-7*RS;
    const f=clamp(u.hp/u.maxHp,0,1);
    c.fillStyle='rgba(0,0,0,0.6)'; c.fillRect(x-bw/2,by2,bw,bh);
    c.fillStyle=f>0.4?'#7dffa8':'#ffd84d';
    c.fillRect(x-bw/2,by2,bw*f,bh);
    // 换弹：环形进度 + 「换弹」标签（醒目）
    if(G.reloadOn&&u.reloadT>0){
      const d2=CLASSES[u.cls], total=d2.reload||1.5;
      const f2=clamp(1-u.reloadT/total,0,1);
      const rr2=r+7.5*RS;
      c.strokeStyle='rgba(20,40,70,0.85)'; c.lineWidth=3.4*RS;
      c.beginPath(); c.arc(x,y,rr2,0,TAU); c.stroke();
      c.strokeStyle='#8fd0ff'; c.lineWidth=3.2*RS;
      c.beginPath(); c.arc(x,y,rr2,-Math.PI/2,-Math.PI/2+f2*TAU); c.stroke();
      const rw=r*2.5, rh=Math.max(2,2.8*RS), ry=by2-6*RS;
      c.fillStyle='rgba(0,0,0,0.65)'; c.fillRect(x-rw/2,ry,rw,rh);
      c.fillStyle='#8fd0ff'; c.fillRect(x-rw/2,ry,rw*f2,rh);
      c.font='bold 9px system-ui'; c.textAlign='center'; c.textBaseline='middle';
      c.fillStyle='rgba(230,245,255,0.96)';
      c.fillText(d2.shell?'装填':'换弹',x,y-r-r*1.5+2);
      c.textBaseline='alphabetic';
    }
    // 弹匣余量点（开启换弹时展示）
    if(G.reloadOn&&d.mag&&!u.reloadT&&u.magLeft<d.mag){
      const n=Math.min(d.mag,8), dot=2.1, gap=5.0;
      const w0=(n-1)*gap;
      for(let i=0;i<n;i++){
        const px2=x-w0/2+i*gap, py2=by2-5.5;
        const filled=i<Math.round(n*u.magLeft/d.mag);
        c.fillStyle=filled?'rgba(143,208,255,0.95)':'rgba(255,255,255,0.18)';
        c.fillRect(px2-dot/2,py2,dot,dot);
      }
    }
    // 平民光环提示
    if(u.cls==='civilian'){
      c.strokeStyle=hexA(tcol,0.14); c.lineWidth=1;
      c.beginPath(); c.arc(x,y,CIVILIAN_AURA_R,0,TAU); c.stroke();
    }
    // 感染倒计时环
    if(u.infect>0){
      const k=clamp(u.infect/INFECT_TIME,0,1);
      const pulse=0.55+0.45*Math.sin(performance.now()/110);
      c.strokeStyle='rgba(192,122,255,'+(0.35+0.4*pulse).toFixed(2)+')';
      c.lineWidth=3.4*RS; c.beginPath(); c.arc(x,y,r+5.5*RS,0,TAU); c.stroke();
      c.strokeStyle='rgba(255,120,220,0.95)'; c.lineWidth=2.6*RS;
      c.beginPath(); c.arc(x,y,r+5.5*RS,-Math.PI/2,-Math.PI/2+k*TAU); c.stroke();
    }
    if(u.infectFx>0){
      c.strokeStyle='rgba(255,150,255,'+(u.infectFx*1.4).toFixed(2)+')';
      c.lineWidth=2; c.beginPath(); c.arc(x,y,r+9,0,TAU); c.stroke();
    }
    // 医疗兵治疗脉冲 / 光束
    if(u.healPulse>0){
      const k=1-u.healPulse/0.6;
      c.strokeStyle='rgba(150,255,190,'+(0.75*(1-k)).toFixed(2)+')'; c.lineWidth=3;
      c.beginPath(); c.arc(x,y,r+5+k*26,0,TAU); c.stroke();
    }
    if(u.beamTo&&u.beamTo.alive&&u.healPulse>0){
      c.strokeStyle='rgba(140,255,190,0.55)'; c.lineWidth=2;
      c.beginPath(); c.moveTo(x,y); c.lineTo(u.beamTo.x,u.beamTo.y); c.stroke();
    }
    if(u.hatchFx>0){
      const k=1-u.hatchFx/0.75;
      c.strokeStyle='rgba(200,130,255,'+(0.8*(1-k)).toFixed(2)+')';
      c.lineWidth=3; c.beginPath(); c.arc(x,y,r+6+k*22,0,TAU); c.stroke();
    }
  }
  // 受伤的门
  for(let y=0;y<GH;y++) for(let x=0;x<GW;x++){
    const i=idx(x,y);
    if(G.map[i]!==DOOR||G.doorHP[i]<=0||G.doorHP[i]>=DOOR_MAX) continue;
    const f=G.doorHP[i]/DOOR_MAX;
    c.fillStyle='rgba(0,0,0,0.55)'; c.fillRect(x*TILE+4,y*TILE+TILE-8,TILE-8,3.5);
    c.fillStyle='#ffbe5c'; c.fillRect(x*TILE+4,y*TILE+TILE-8,(TILE-8)*f,3.5);
  }
}
/* 火焰（喷火兵）：**一整条连续的线**，从枪口一直延伸到射程尽头。
   ★ 之前是「每颗子弹画一小段火苗」，看起来是一串断开的火星子。
     用户要的是一条完整的火线 —— 所以现在不再按子弹画，
     而是每个喷火兵维护一条「火舌」：{起点, 角度, 长度, 剩余时间}，
     画的时候用一条连续曲线（起点→终点）铺满整条路径。
   长度用射线检测决定：撞墙就截断，否则打到射程上限。
   这样无论中间有多少敌人，火线都是完整贯穿的一条。 */
function flameEnd(x,y,ang,maxLen){
  const ux=Math.cos(ang), uy=Math.sin(ang);
  const step=8;
  for(let d=step;d<=maxLen;d+=step){
    const px=x+ux*d, py=y+uy*d;
    const tx=(px/TILE)|0, ty=(py/TILE)|0;
    if(!inB(tx,ty)) return d;
    if(blocksBullet(G.map[idx(tx,ty)])) return d;   // 撞墙/实体 → 火线到此为止
  }
  return maxLen;
}
function drawJets(c){
  const jets=G.jets;
  if(!jets||!jets.length) return;
  const t=performance.now()/1000;
  for(const j of jets){
    const k=clamp(j.t/j.max,0,1);                    // 1 → 刚喷，0 → 消失
    const len=j.len;
    /* 一整条线：从枪口到终点，用二次曲线让中段微微下垂（火焰上飘的观感） */
    const ux=Math.cos(j.ang), uy=Math.sin(j.ang);
    const ex=j.x+ux*len, ey=j.y+uy*len;
    const nx=-uy, ny=ux;                             // 法线方向
    const SEG=14;
    /* 三层：外焰(红/粗) → 中焰(橙) → 内焰(白黄/细)，越靠内越亮越窄 */
    const layers=[
      {w:9.0, col:'rgba(255,70,20,'  +(0.26*k).toFixed(3)+')', sway:5.5, taper:0.45},
      {w:5.4, col:'rgba(255,140,45,' +(0.42*k).toFixed(3)+')', sway:3.4, taper:0.35},
      {w:2.6, col:'rgba(255,236,170,'+(0.78*k).toFixed(3)+')', sway:1.8, taper:0.25},
    ];
    for(const L of layers){
      c.strokeStyle=L.col; c.lineWidth=L.w; c.lineCap='round'; c.lineJoin='round';
      c.beginPath();
      for(let i=0;i<=SEG;i++){
        const s=i/SEG;
        /* 湍流：沿轴线摆动，越靠尾端摆得越厉害 */
        const wob=Math.sin(t*20-s*6.5+j.seed)*L.sway*s*s;
        const px=j.x+ux*len*s+nx*wob;
        const py=j.y+uy*len*s+ny*wob;
        if(i===0) c.moveTo(px,py); else c.lineTo(px,py);
      }
      c.stroke();
    }
    /* 喷口亮点 */
    c.fillStyle='rgba(255,250,225,'+(0.9*k).toFixed(2)+')';
    c.beginPath(); c.arc(j.x,j.y,3.0,0,TAU); c.fill();
    /* 末端收束的小火头 */
    c.fillStyle='rgba(255,170,70,'+(0.35*k).toFixed(2)+')';
    c.beginPath(); c.arc(ex,ey,4.2,0,TAU); c.fill();
  }
}
function stepJets(dt){
  const js=G.jets;
  if(!js||!js.length) return;
  for(let i=js.length-1;i>=0;i--){
    js[i].t-=dt;
    if(js[i].t<=0) js.splice(i,1);
  }
}
function drawBullets(c){
  c.lineCap='round';
  for(const b of G.bullets){
    const l=Math.hypot(b.vx,b.vy)||1;
    const ux=b.vx/l, uy=b.vy/l;
    /* 火焰子弹不再单独绘制（由 drawJets 画成一条完整的线），
       这里直接跳过，避免出现「断开的火苗」。 */
    if(b.burn) continue;
    /* 火箭弹：画成带尾焰的弹体，并提示爆炸半径 */
    if(b.rocket){
      c.globalAlpha=0.35; c.strokeStyle='rgba(255,140,60,0.8)'; c.lineWidth=6;
      c.beginPath(); c.moveTo(b.x-ux*18,b.y-uy*18); c.lineTo(b.x,b.y); c.stroke();
      c.globalAlpha=1;
      c.fillStyle='#ffd08a'; c.beginPath(); c.arc(b.x,b.y,3.6,0,TAU); c.fill();
      c.strokeStyle='rgba(255,120,60,0.95)'; c.lineWidth=2;
      c.beginPath(); c.moveTo(b.x-ux*11,b.y-uy*11); c.lineTo(b.x,b.y); c.stroke();
      continue;
    }
    c.strokeStyle=b.color; c.globalAlpha=0.85; c.lineWidth=b.w;
    c.beginPath(); c.moveTo(b.x-ux*b.len,b.y-uy*b.len); c.lineTo(b.x,b.y); c.stroke();
    c.globalAlpha=1;
  }
}
/* 手雷：抛物线飞行 + 落点提示圈 */
function drawGrenades(c){
  const gs=G.grenades;
  if(!gs||!gs.length) return;
  for(const g of gs){
    const k=clamp(g.t/g.flight,0,1);
    const arc=Math.sin(k*Math.PI)*46;                 // 抛物线高度
    const gx=g.x, gy=g.y-arc;
    c.globalAlpha=0.22; c.strokeStyle='#ffd08a'; c.lineWidth=1.6;
    c.beginPath(); c.arc(g.x1,g.y1,g.r,0,TAU); c.stroke();
    c.globalAlpha=1;
    c.fillStyle='rgba(0,0,0,0.3)';
    c.beginPath(); c.ellipse(g.x,g.y,4*RS,2*RS,0,0,TAU); c.fill();
    c.fillStyle='#8fd08a';
    c.beginPath(); c.arc(gx,gy,4.2*RS,0,TAU); c.fill();
    c.strokeStyle='rgba(30,50,30,0.9)'; c.lineWidth=1.2; c.stroke();
  }
}
/* 爆炸表现：地面焦痕 → 冲击波环 → 致盲闪光。
   分三层画，保证在密集单位里也一眼可辨。 */
function drawBlasts(c){
  /* ① 焦痕（最先画，垫在最下面） */
  for(const s of G.scorches){
    const k=clamp(1-s.t/s.max,0,1);
    c.globalAlpha=0.42*k;
    c.fillStyle='#1a1208';
    c.beginPath(); c.arc(s.x,s.y,s.r,0,TAU); c.fill();
    c.globalAlpha=0.25*k;
    c.strokeStyle='#3d2a12'; c.lineWidth=2;
    c.beginPath(); c.arc(s.x,s.y,s.r*0.92,0,TAU); c.stroke();
  }
  c.globalAlpha=1;
  /* ② 冲击波环 */
  for(const s of G.shocks){
    const k=clamp(s.t/s.dur,0,1);
    const r=s.r0+(s.r1-s.r0)*(1-Math.pow(1-k,2));      // 先快后慢，像真实冲击波
    const a=(1-k)*(1-k);
    c.globalAlpha=a*0.85;
    c.strokeStyle=s.color; c.lineWidth=Math.max(1.5,5*(1-k));
    c.beginPath(); c.arc(s.x,s.y,r,0,TAU); c.stroke();
    /* 内圈薄环，增加层次 */
    c.globalAlpha=a*0.4;
    c.lineWidth=Math.max(1,2*(1-k));
    c.beginPath(); c.arc(s.x,s.y,r*0.72,0,TAU); c.stroke();
  }
  c.globalAlpha=1;
  /* ③ 爆心闪光（短促、很亮） */
  for(const s of G.shocks){
    if(s.t>s.dur*0.4) continue;
    const k=s.t/(s.dur*0.4);
    const r=s.r1*0.30*(1-k*0.55);
    const grad=c.createRadialGradient(s.x,s.y,0,s.x,s.y,r);
    grad.addColorStop(0,'rgba(255,255,240,'+(0.85*(1-k)).toFixed(2)+')');
    grad.addColorStop(0.5,'rgba(255,210,120,'+(0.5*(1-k)).toFixed(2)+')');
    grad.addColorStop(1,'rgba(255,140,40,0)');
    c.fillStyle=grad;
    c.beginPath(); c.arc(s.x,s.y,r,0,TAU); c.fill();
  }
}
/* 撤离区 + 刷怪点 + 平民连线：都画在地图底层之上、单位之下，
   保证不遮挡战斗，又能一眼看清目标位置。 */
function drawMission(c){
  const m=G.mission;
  if(m&&m.on&&m.zone){
    const z=m.zone, r=CIV_ZONE_R;
    const pulse=0.5+0.5*Math.sin(performance.now()/420);
    c.fillStyle='rgba(90,230,150,'+(0.10+0.06*pulse).toFixed(2)+')';
    c.fillRect(z.x-r,z.y-r,r*2,r*2);
    c.strokeStyle='rgba(125,255,168,0.85)'; c.lineWidth=2.5;
    c.setLineDash([8,5]); c.strokeRect(z.x-r,z.y-r,r*2,r*2); c.setLineDash([]);
    c.fillStyle='rgba(180,255,205,0.95)';
    c.font='bold 13px system-ui'; c.textAlign='center'; c.textBaseline='middle';
    c.fillText('撤离区',z.x,z.y-r-11);
    /* 平民 → 护送者的连线，让玩家知道谁在被护送 */
    for(const cv of m.civs){
      if(!cv.alive||cv.saved||!cv.escort) continue;
      c.strokeStyle='rgba(140,255,190,0.42)'; c.lineWidth=1.5;
      c.beginPath(); c.moveTo(cv.x,cv.y); c.lineTo(cv.escort.x,cv.escort.y); c.stroke();
    }
    c.textBaseline='alphabetic';
  }
  /* 刷怪点：紫色洞口 + 呼吸光晕 */
  if(G.spawnOn){
    for(const sp of G.spawners){
      const pulse=0.5+0.5*Math.sin(performance.now()/380+sp.x*0.01);
      const r=sp.r||34;
      const grad=c.createRadialGradient(sp.x,sp.y,0,sp.x,sp.y,r);
      grad.addColorStop(0,'rgba(200,120,255,'+(0.30+0.18*pulse).toFixed(2)+')');
      grad.addColorStop(1,'rgba(140,60,200,0)');
      c.fillStyle=grad;
      c.beginPath(); c.arc(sp.x,sp.y,r,0,TAU); c.fill();
      c.strokeStyle='rgba(200,140,255,0.75)'; c.lineWidth=2;
      c.beginPath(); c.arc(sp.x,sp.y,r*0.55,0,TAU); c.stroke();
      c.strokeStyle='rgba(230,190,255,0.5)'; c.lineWidth=1.2;
      c.beginPath(); c.arc(sp.x,sp.y,r*0.9,0,TAU); c.stroke();
    }
  }
}
function drawParticles(c){
  for(const p of G.parts){
    c.globalAlpha=clamp(p.life/p.max,0,1);
    c.fillStyle=p.color;
    c.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);
  }
  c.globalAlpha=1;
}
function drawSelBox(c){
  const b=G.selBox; if(!b) return;
  const x=Math.min(b.x0,b.x1), y=Math.min(b.y0,b.y1);
  const w=Math.abs(b.x1-b.x0), h=Math.abs(b.y1-b.y0);
  c.fillStyle='rgba(143,208,255,0.13)'; c.fillRect(x,y,w,h);
  c.strokeStyle='rgba(143,208,255,0.9)'; c.lineWidth=1.5;
  c.setLineDash([6,4]); c.strokeRect(x,y,w,h); c.setLineDash([]);
}
function drawDispatchMark(c){
  const m=G.dispatchMark; if(!m) return;
  const k=Math.max(0,m.t/2.4);
  const pulse=0.6+0.4*Math.sin(performance.now()/140);
  c.strokeStyle='rgba(143,208,255,'+(0.35+0.45*pulse).toFixed(2)+')'; c.lineWidth=2;
  c.beginPath(); c.arc(m.x,m.y,16+(1-k)*26,0,TAU); c.stroke();
  c.beginPath(); c.moveTo(m.x-13,m.y); c.lineTo(m.x+13,m.y); c.moveTo(m.x,m.y-13); c.lineTo(m.x,m.y+13); c.stroke();
}
function render(){
  if(G.baseDirty) bakeMap();
  ctx.clearRect(0,0,VW,VH);
  ctx.drawImage(base,0,0);
  drawCorpses(ctx);
  drawMission(ctx);
  drawBlasts(ctx);
  drawDispatchMark(ctx);
  drawUnits(ctx);
  drawJets(ctx);          // 火线画在单位之上，保证一眼看得见
  drawBullets(ctx);
  drawGrenades(ctx);
  drawParticles(ctx);
  drawSelBox(ctx);
  if(G.phase==='battle'&&G.time>G.matchTime-30){
    const a=0.09+0.05*Math.sin(performance.now()/220);
    ctx.fillStyle='rgba(255,80,80,'+a.toFixed(3)+')'; ctx.fillRect(0,0,VW,VH);
  }
}
