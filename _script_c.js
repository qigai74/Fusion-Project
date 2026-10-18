/* ---------------- HUD ---------------- */
function chipsFor(tid){
  const t=teams[tid];
  const live={}, dead={};
  for(const u of G.units){
    if(u.team!==tid) continue;
    if(u.alive) live[u.cls]=(live[u.cls]||0)+1; else dead[u.cls]=(dead[u.cls]||0)+1;
  }
  const set=new Set(t.roles.filter(k=>live[k]||dead[k]));
  if(!set.size) return '<span class="chip">—</span>';
  let html='';
  for(const k of t.roles){
    if(!set.has(k)) continue;
    const d=CLASSES[k], a=live[k]||0, tot=a+(dead[k]||0);
    html+='<span class="chip'+(a===0?' dead':'')+'">'+
      (d.kind==='h'?'<i class="cdot" style="background:'+d.color+'"></i>':'<i class="sq" style="background:'+d.color+'"></i>')+
      d.name+' '+a+(tot>a?'/'+tot:'')+'</span>';
  }
  return html;
}
function updateHUD(dt){
  G.hudT-=dt; if(G.hudT>0) return; G.hudT=0.14;
  let inf=0;
  for(const u of G.units){ if(u.alive&&u.kind==='h'&&u.infect>0) inf++; }
  const ip=$('#infPill'); $('#infN').textContent=inf;
  if(ip) ip.style.display=inf>0?'':'none';

  $('#selN').textContent=G.selected.size;
  let mode=BEHAVIORS[G.behavior]||'游击';
  if(G.selected.size){
    const cur=new Set();
    for(const u of G.units){ if(u.alive&&G.selected.has(u.id)) cur.add(u.behavior||G.behavior); }
    if(cur.size===1) mode=BEHAVIORS[[...cur][0]]||mode;
    else if(cur.size>1) mode='混合指挥';
  }
  const mn=$('#modeName'); if(mn) mn.textContent=mode;
  const mm2=$('#modeMini'); if(mm2) mm2.textContent=mode;
  /* ★ 计时器从「倒计时」改成「已用时」。
     时间限制整个去掉了（用户要求：不要做会限制玩家体验的东西），
     所以这里显示已经打了多久，而不是还剩多少 ——
     既保留了「这局打了很久」的信息，又不会给人「快没时间了」的压迫感。 */
  const el2=Math.floor(G.time);
  const mm=String(Math.floor(el2/60)).padStart(2,'0');
  const ss=String(el2%60).padStart(2,'0');
  const tp=$('#timePill');
  if(tp){ tp.textContent=mm+':'+ss; tp.classList.remove('low'); }
  $('#teamChips').innerHTML=teams.map((t,i)=>
    '<div class="sideblock" style="border-color:'+teamColor(i)+'44"><div class="hd" style="color:'+teamColor(i)+'">'+
    t.name+'</div><div class="chips">'+chipsFor(i)+'</div></div>').join('');
  $('#speedPill').textContent=(G.paused?'暂停':G.speed+'×');
  renderWarBar();
  renderMission();
  $('#feed').innerHTML=G.feed.slice(-7).map(function(it){
    const c=(typeof it.side==='number')?teamColor(it.side):(it.side==='i'?'#c07aff':'#6b7f9c');
    return '<div class="fi'+(it.side==='i'?' byi':'')+'" style="border-color:'+c+';opacity:'+
      clamp(1.25-it.t/9,0.25,1).toFixed(2)+'">'+it.text+'</div>';
  }).join('');
}
/* 战况面板：兵种计数 + 双方人数 + 对向血条 + Boss 血条
   信息层次按「紧急程度」排：先看「还剩什么兵」，再看「谁多」，最后看「Boss 血线」。 */
function renderWarBar(){
  /* ★ 战况面板在改版后已经**直接放进右侧栏**，不再有 #warBar 外层容器。
     旧代码开头是 `const bar=$('#warBar'); if(!bar) return;`，
     于是整个函数每次都直接返回 —— 面板永远显示 0（实际单位有 55 个）。
     现在只要目标元素在就继续渲染。 */
  if(!$('#wbNumA')) return;

  /* 按队伍汇总兵种存活数（只列有人或本该有人的兵种） */
  const byTeam=teams.map(()=>({}));
  const bossList=[];
  for(const u of G.units){
    if(!u.alive) continue;
    if(!byTeam[u.team]) byTeam[u.team]={};
    byTeam[u.team][u.cls]=(byTeam[u.team][u.cls]||0)+1;
    /* Boss 类：血量上限 >= 600 的僵尸型（母体 / 终极母体） */
    if(u.kind==='z'&&u.maxHp>=600) bossList.push(u);
  }
  let row='';
  for(let t=0;t<teams.length;t++){
    const col=teamColor(t);
    const m=byTeam[t]||{};
    const keys=Object.keys(m).filter(k=>m[k]>0);
    if(!keys.length) continue;
    keys.sort((a,b)=>CLASSES[b].hp-CLASSES[a].hp);
    for(const k of keys){
      row+='<span class="ci"><i class="'+(CLASSES[k].kind==='h'?'cdot':'sq')+
        '" style="background:'+col+'"></i>'+CLASSES[k].name+' <b>'+m[k]+'</b></span>';
    }
    if(t<teams.length-1) row+='<span class="ci" style="opacity:.35">|</span>';
  }
  $('#wbClasses').innerHTML=row;

  /* 双方总人数：默认把第 1 队当「人类型方」、第 2 队当「僵尸方」，
     但按实际 kind 统计更能反映混编队伍的真实构成。
     ★ 撤离模式下平民单独计数，不计入任何一方战力。 */
  let totalH=0,totalZ=0;
  for(const u of G.units){
    if(!u.alive) continue;
    if(u.isCiv) continue;                 // 平民既不算人类战力也不算僵尸
    if(u.kind==='h') totalH++; else totalZ++;
  }
  const tA=teams[0], tB=teams[1];
  if(tA) $('#wbLabA').textContent=tA.name;
  if(tB) $('#wbLabB').textContent=tB.name;
  $('#wbLabA').style.color=teamColor(0);
  if(tB) $('#wbLabB').style.color=teamColor(1);
  $('#wbNumA').textContent=totalH;
  $('#wbNumB').textContent=totalZ;
  $('#wbNumA').style.color=teamColor(0);
  $('#wbNumB').style.color=tB?teamColor(1):'#fff';

  /* 对向血条：按双方人数占比消长（都为 0 时各占一半，避免除零） */
  const tot=totalH+totalZ;
  const fpA=tot>0?totalH/tot:0.5;
  $('#wbFillA').style.width=(fpA*100).toFixed(1)+'%';
  $('#wbFillB').style.width=((1-fpA)*100).toFixed(1)+'%';

  /* Boss 血条：多个 Boss 时优先显示「血量比例最低」的那个（最危急的前线目标），
     这样玩家一眼看到的是真正在挨打的那个，而不是满血的预备队。 */
  const bb=$('#wbBoss');
  if(bossList.length){
    bb.classList.remove('hidden');
    bossList.sort((a,b)=>(a.hp/a.maxHp)-(b.hp/b.maxHp));
    const b=bossList[0];
    const f=clamp(b.hp/b.maxHp,0,1);
    bb.innerHTML='<span class="bn">'+b.name+'</span>'+
      '<span class="bbar"><i class="bfill" style="width:'+(f*100).toFixed(1)+'%"></i></span>'+
      '<span class="bhp">'+Math.max(0,Math.round(b.hp))+'/'+b.maxHp+
      (bossList.length>1?'　(+'+(bossList.length-1)+')':'')+'</span>';
  } else {
    bb.classList.add('hidden');
  }
}
/* 撤离任务面板：只在撤离模式开启时显示 */
function renderMission(){
  const box=$('#missionBox'); if(!box) return;
  if(!G.mission||!G.mission.on){ box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const m=G.mission;
  const pct=m.total?Math.round(m.saved/m.total*100):0;
  $('#missionTitle').textContent='撤离任务 · '+pct+'%';
  $('#missionBody').innerHTML=
    '已撤离 <b style="color:#7dffa8">'+m.saved+'</b>/'+m.total+' 人'+
    '　待救 <b style="color:#ffd84d">'+m.left+'</b>'+
    '　牺牲 <b style="color:#ff9a8a">'+(m.lost||0)+'</b><br>'+
    '护送中 <b style="color:#8fd0ff">'+m.escorting+'</b> 人<br>'+
    '<span style="color:#8ea3c0">把平民带到左侧绿色撤离区，平民一进去就登车离开</span>';
}
function showResult(){
  const r=G.result; if(!r) return;
  const c=counts();
  const title=r.winner<0?'平局 / 同归于尽':(teamName(r.winner)+' 胜利');
  const cls='big '+(r.winner<0?'draw':(r.winner===0?'h':'z'));
  function rows(tid){
    let s='',live={},dead={};
    for(const u of G.units){ if(u.team!==tid) continue;
      if(u.alive) live[u.cls]=(live[u.cls]||0)+1; else dead[u.cls]=(dead[u.cls]||0)+1; }
    const cols=c.teams[tid].map;
    for(const k of teams[tid].roles){
      const n0=cols[k];
      if(!n0&&!live[k]&&!dead[k]) continue;
      const d=CLASSES[k];
      s+='<div>'+(d.kind==='h'?'<i class="cdot" style="background:'+d.color+'"></i>':'<i class="sq" style="background:'+d.color+'"></i>')+
         ' '+d.name+'：存活 <b>'+(live[k]||0)+'</b>/'+n0;
      if(dead[k]) s+='　阵亡 '+dead[k];
      s+='</div>';
    }
    return s;
  }
  const byClass=Object.keys(G.stats.byClass).length
    ? Object.keys(G.stats.byClass).map(k=>k+' '+G.stats.byClass[k]).join(' · ') : '无';
  let teamBlock='';
  for(let i=0;i<teams.length;i++){
    const alive=aliveCount(i);
    teamBlock+='<div style="margin-top:7px"><b style="color:'+teamColor(i)+'">'+teams[i].name+'</b>'+
      '（人类型 '+(teams[i].type==='h'?'是':(teams[i].type==='z'?'否':'混编'))+'）'+
      ' 存活 <b>'+alive+'</b>/'+G.startCount[i]+'　剩余战力 '+(hpFrac(i)*100).toFixed(0)+'%</div>'+
      rows(i);
  }
  $('#resBody').innerHTML=
    '<div class="'+cls+'">'+title+'</div>'+
    '<div>'+r.reason+' · 用时 '+G.time.toFixed(1)+' 秒</div>'+
    '<div style="margin-top:5px;color:#d9a4ff">感染累计 <b>'+G.infections+'</b> 次　其中尸变倒戈 <b>'+G.converted+'</b> 人</div>'+
    '<div style="margin-top:9px;height:1px;background:#1c2740"></div>'+
    teamBlock+
    '<div style="margin-top:9px;color:#9db1cc">击杀统计：'+byClass+'</div>';
  $('#resNote').textContent='每次开战行为略有随机差异';
  $('#result').classList.remove('hidden');
}

/* ---------------- 开局 / 重开 ---------------- */
/* ═════════════ 撤离模式：权限锁 + 刷怪点 ═════════════
   用户反馈两条：
     ·「撤离模式只能控制人类没有严格执行」
     ·「刷怪点不工作且刷怪点位置不合理，按照新地图重写」 */

/* 程序化的撤离开关。QB.mission / 面板勾选都会置位，
   这样 startMatch 不必依赖 DOM 就能知道该不该开撤离模式。 */
let missionFlag=false;

/* 撤离模式下的指挥权限锁。
   规则：**只能框选 / 派遣人类单位**，僵尸永远是敌方 AI。
   为什么要在多处拦截：框选、全选、点击指挥、探针四条路径都能选中单位，
   只拦一条会漏 —— 用户反馈「只能控制人类没有严格执行」就是漏了。
   ★ 注意 G.selected 存的是**单位 id**（不是对象），
     所以这里要按 id 反查单位类型。 */
function applyMissionLock(){
  G.missionLock=true;
  pruneSelection();
}
/* 把选择集里「不可指挥」的单位剔除。
   任何往 G.selected 里塞 id 的地方之后都应该调用它。 */
function pruneSelection(){
  if(!G.missionLock||!G.selected||!G.selected.size) return;
  const byId=new Map();
  for(const u of G.units) byId.set(u.id,u);
  for(const id of Array.from(G.selected)){
    const u=byId.get(id);
    if(!u||!u.alive||u.kind!=='h') G.selected.delete(id);
  }
}
/* 判断某个单位在当前模式下是否「可被玩家指挥」 */
function commandable(u){
  if(!u||!u.alive) return false;
  if(G.missionLock) return u.kind==='h';
  return true;
}
/* 统一的「选中」入口：所有选择逻辑都应走这里，免得漏掉权限检查 */
function selectUnit(u){
  if(!commandable(u)) return false;
  G.selected.add(u.id);
  return true;
}

/* ★ 刷怪点：按**当前地图**自动找位置，而不是写死坐标。
   规则（对应用户「位置不合理」）：
     ① 必须在主连通区里（否则放出来的僵尸卡在墙里）
     ② 必须在**远离撤离区 / 人类出生区**的一侧
        （旧版把洞口放在地图右侧固定坐标，换成迷宫图后
         那些坐标可能正好压在墙上或就在撤离区旁边）
     ③ 优先靠地图边缘（从外面涌进来才合理）
     ④ 至少 3 个，且彼此分散（不要挤在一堆） */
function missionSpawners(){
  const ref=(G.missionZone&&G.missionZone.x!==undefined)
    ? G.missionZone : {x:cx_of(3),y:VH/2};
  const reg=mainRegion(G.map);
  const cands=[];
  for(let ty=2;ty<GH-2;ty++){
    for(let tx=2;tx<GW-2;tx++){
      if(!passableForHuman(G.map,tx,ty)) continue;
      if(reg.mask&&!reg.mask[idx(tx,ty)]) continue;
      const x=cx_of(tx), y=cy_of(ty);
      const d=Math.hypot(x-ref.x,y-ref.y);
      /* 太近的不要：僵尸不能贴着撤离区刷出来 */
      if(d<Math.min(VW,VH)*0.45) continue;
      /* 边缘度：越靠边越像「从外面涌进来」 */
      const edge=Math.min(tx,ty,GW-1-tx,GH-1-ty)/Math.min(GW,GH);
      cands.push({x:x,y:y,tx:tx,ty:ty,d:d,score:d*0.6+(1-edge)*VW*0.4});
    }
  }
  if(!cands.length){
    /* 兜底：地图太小 / 连通区太小时，直接取最远离撤离区的几格 */
    const fb=[];
    for(let ty=2;ty<GH-2;ty+=2) for(let tx=2;tx<GW-2;tx+=2){
      if(!passableForHuman(G.map,tx,ty)) continue;
      fb.push({x:cx_of(tx),y:cy_of(ty),
               d:Math.hypot(cx_of(tx)-ref.x,cy_of(ty)-ref.y)});
    }
    fb.sort((a,b)=>b.d-a.d);
    return fb.slice(0,3).map((c,i)=>({x:c.x,y:c.y,r:40,name:'洞口'+(i+1)}));
  }
  cands.sort((a,b)=>b.score-a.score);
  /* 贪心挑选：彼此至少隔开一定距离，保证分散 */
  const out=[];
  const minSep=Math.min(VW,VH)*0.28;
  for(const c of cands){
    if(out.length>=4) break;
    let ok=true;
    for(const o of out){ if(Math.hypot(o.x-c.x,o.y-c.y)<minSep){ ok=false; break; } }
    if(ok) out.push({x:c.x,y:c.y,r:40,name:'洞口'+(out.length+1)});
  }
  /* 不够就放宽间隔再补 */
  for(const c of cands){
    if(out.length>=3) break;
    if(out.some(o=>o.x===c.x&&o.y===c.y)) continue;
    out.push({x:c.x,y:c.y,r:40,name:'洞口'+(out.length+1)});
  }
  return out.length?out:[{x:VW-TILE*3,y:VH/2,r:40,name:'洞口1'}];
}

/* 固定随机种子（null = 用时间，即正常游玩）。
   给回归测试用：测试里先 QB.seed(1234) 再 start()，结果就可复现。 */
let fixedSeed=null;

function startMatch(){  sfxResume();                                   // 开局即尝试唤醒音频上下文
  const c=counts();
  for(let i=0;i<teams.length;i++){
    const waveBacked=waveOn&&teams[i].type!=='h';
    if(c.teams[i].total===0&&!waveBacked){
      showTeamMsg(i, waveOn?'该队伍至少要配置 1 个单位（僵尸队伍可交由轮次投放）。'
                          :'该队伍至少要配置 1 个单位。');
      return false;
    }
  }
  if(waveOn&&!waveTeamIndices().length){
    setMsg('僵尸轮次需要至少一支僵尸型队伍。','err'); return false;
  }
  const v=validateGrid(editGrid);
  if(!v.ok){ setMsg('地图不可用：'+v.reason,'err');
    if(typeof window!=='undefined') window.__lastValidateFail=v.reason;
    return false; }
  if(typeof window!=='undefined') window.__lastValidateFail=null;  G.map.set(editGrid);
  for(let i=0;i<G.map.length;i++){ G.doorHP[i]=G.map[i]===DOOR?DOOR_MAX:0; G.winHP[i]=G.map[i]===WIN?WIN_MAX:0; }
  G.bullets=[]; G.parts=[]; G.corpses=[]; G.feed=[]; G.infections=0; G.converted=0;
  G.grenades=[]; G.shocks=[]; G.scorches=[]; G.jets=[];
  G.time=0; G.tick=0; G.endT=0; G.result=null; G.baseDirty=true; G.hudT=0;
  G.selected=new Set(); G.dispatchMark=null;
  G.__mainRegion=null;
  if(!G.missionArea) G.missionArea=null;                 // 地图刚换 → 连通性缓存必须失效
  /* ★ 随机种子：正常游玩用时间（每局不同），
     但**允许外部固定**（QB.seed）—— 否则平衡测试每次结果都不一样，
     失败还无法复现。回归测试里应当先 QB.seed(x) 再开局。 */
  rng=mulberry32((fixedSeed!==null)
    ? (fixedSeed>>>0)
    : (((Date.now()&0xffffff)^0x5bf03635)>>>0));
  /* ★ 刷怪点：用「当前地图的洞口」重建，位置必须与地图匹配。
     旧版只在这里读玩家手点的洞口，没点就完全不开 ——
     于是「刷怪点不工作」：G.spawners 一直是空的，QB.emit 自然返回 0。
     现在：撤离模式 / 手点洞口 / 默认洞口，三选一都有合理结果。 */
  {
    const cs=customSpawnersOf();
    if(cs&&cs.length){
      G.spawners=cs.map((s,i)=>({x:s.x,y:s.y,r:s.r||40,name:s.name||('洞口'+(i+1))}));
      G.spawnOn=true;
    } else if(G.missionZone||missionFlag){
      /* 撤离模式：按当前地图自动生成「远端洞口」 */
      G.spawners=missionSpawners();
      G.spawnOn=true;
    } else {
      G.spawners=defaultSpawners();
      G.spawnOn=true;
    }
  }
  spawnArmies();
  /* 撤离模式：勾选了就在开局时投放平民并建撤离区。
     注意这里不能调 QB.mission —— startMatch 执行时 window.QB 还没建立，
     必须用独立的函数（missionSetup）。
     ★ 判定顺序：先看「程序设定的 missionFlag」（QB.mission 会置位），
       再看 DOM 勾选。旧版只看 DOM，于是用 QB.mission(true) 开局时
       撤离模式被这一行**悄悄关掉**（mission.on 变 false），
       表现就是「撤离模式只能控制人类没有严格执行」——
       因为模式根本没开起来。 */
  const mcb=$('#chkMission');
  const wantMission = missionFlag || (mcb&&mcb.checked===true);
  if(wantMission){
    applyMissionLock();                    // 锁死：只允许指挥人类
    const n=clamp(parseInt($('#civCount')?$('#civCount').value:8,10)||8,1,60);
    missionSetup(n,G.missionZone,G.missionArea);
  } else {
    G.mission.on=false; G.mission.civs=[]; G.mission.zone=null;
    G.missionLock=false;
  }
  G.phase='battle'; G.paused=false; G.speed=1;
  $('#setup').classList.add('hidden');
  $('#result').classList.add('hidden');
  $('#btnPause').innerHTML='暂停 <span class="kbd">空格</span>';
  $('#btnSpeed').innerHTML='速度 1× <span class="kbd">S</span>';
  updateHUD(1);
  pushFeed('战斗开始：'+teams.map((t,i)=>t.name+' '+G.startCount[i]).join('　vs　')+
           '（预设 '+BEHAVIORS[G.behavior]+'）','');
  /* 开局自动开始背景音乐（若用户开着音乐开关） */
  const mcb2=$('#chkMusic');
  if(!mcb2||mcb2.checked!==false) { try{ playMusic(musicTrack); }catch(e){} }
  return true;
}

/* ---------------- 配置面板 ---------------- */
/* 撤离模式的独立实现（不依赖 QB，供 startMatch 直接调用）。
   ★ 平民位置的三条设计原则（用户反馈「位置不合理」后重做）：
     ① 必须在主连通区里 —— 否则被关在死腔，救不出来也走不到
     ② 按扇形分区铺开 —— 保证散布全图、互不重叠，而不是挤在角落里
     ③ 离撤离区有足够距离，且优先放在「房间/掩体旁」——
        这样才有「深入敌后捞人」的感觉，而不是在空地上站着
     撤离区本身也会被校正到最近的合法空地。 */
function missionSetup(n,zone,civArea){
  const reg=mainRegion(G.map);
  /* 撤离区校正：如果落在墙里或死腔，挪到最近的合法空地 */
  if(zone){
    const zt={x:(zone.x/TILE)|0,y:(zone.y/TILE)|0};
    const ok=inB(zt.x,zt.y)&&passableForHuman(G.map,zt.x,zt.y)&&reg.mask&&reg.mask[idx(zt.x,zt.y)];
    if(!ok){
      let best=null,bd=1e9;
      for(let ty=1;ty<GH-1;ty++) for(let tx=1;tx<GW-1;tx++){
        if(!reg.mask||!reg.mask[idx(tx,ty)]) continue;
        const d=Math.hypot(cx_of(tx)-zone.x,cy_of(ty)-zone.y);
        if(d<bd){ bd=d; best={x:cx_of(tx),y:cy_of(ty)}; }
      }
      if(best) zone=best;
    }
  }
  /* ★ 撤离区的兜底位置必须在**左边缘**（救援队进场侧）。
     旧代码写的是 VW-TILE*3（最右边）—— 那正是僵尸涌入的一侧，
     等于「把人送到僵尸嘴里」。而且它会让 missionSpawners 误判：
     撤离区在右，洞口就全跑到左边，正好压在人类出生区上。
     现在兜底取「最左侧、靠近竖向中线的可通行格」。 */
  if(!zone){
    let best=null,bd=1e9;
    const regL=mainRegion(G.map);
    for(let ty=2;ty<GH-2;ty++) for(let tx=2;tx<6;tx++){
      if(!passableForHuman(G.map,tx,ty)) continue;
      if(regL.mask&&!regL.mask[idx(tx,ty)]) continue;
      const d=Math.abs(cy_of(ty)-VH/2)+tx*TILE*0.2;
      if(d<bd){ bd=d; best={x:cx_of(tx),y:cy_of(ty)}; }
    }
    zone=best||{x:TILE*3,y:VH/2};
  }
  /* 候选格：主连通区 + 离撤离区足够远 */
  const cands=[];
  for(let ty=1;ty<GH-1;ty++){
    for(let tx=1;tx<GW-1;tx++){
      if(!reg.mask||!reg.mask[idx(tx,ty)]) continue;
      const x=cx_of(tx), y=cy_of(ty);
      const d=Math.hypot(x-zone.x,y-zone.y);
      if(d<TILE*6) continue;                       // 太靠近撤离区 → 没有救援难度
      /* ★ 不要地图边缘/角落：那里既不像「躲藏点」，也容易和出生区混淆。
         用户反馈「平民位置不合理」，根因就是旧排序按「相邻墙数」降序，
         而角落里相邻墙最多 —— 于是平民全被塞到四个角上。 */
      const edge=Math.min(tx,ty,GW-1-tx,GH-1-ty);
      if(edge<2) continue;
      /* ★ 平民只放在地图**中段**（左侧 22%~78%）。
         太靠左 = 一出场就到家，没有救援感；
         太靠右 = 正好落在僵尸入场的那一片，还没等救援队赶到就被咬死
                 （实测 8 人里死 6~7 个，任务根本做不完）。 */
      if(tx<GW*0.22||tx>GW*0.78) continue;
      /* 地图可以用 civArea 指定「平民只允许出现在这里」
         （例如孤岛待援：平民必须被困在岛内，而不是散到岛外） */
      if(civArea){
        if(tx<civArea.x0||tx>civArea.x1||ty<civArea.y0||ty>civArea.y1) continue;
      }
      /* 掩体分：理想是「半遮蔽」——周围 2~4 面是墙（墙洞、房间角落）。
         0~1 面（纯空地）太暴露，7~8 面（死胡同）像被关起来，都降权。 */
      let walls=0,opens=0;
      for(const dd of DIR8){
        const nx=tx+dd[0], ny=ty+dd[1];
        if(!inB(nx,ny)){ walls++; continue; }
        if(passableForHuman(G.map,nx,ny)) opens++; else walls++;
      }
      let cover=walls;
      if(walls<=1) cover=0;                        // 纯空地：不理想
      else if(walls>=7) cover=1;                   // 死胡同：不理想
      cands.push({x:x,y:y,d:d,tx:tx,ty:ty,shelter:cover,walls:walls,edge:edge});
    }
  }
  if(!cands.length){
    G.mission={on:true,saved:0,total:0,left:0,lost:0,escorting:0,civs:[],zone:zone,extractedList:[]};
    pushFeed('撤离任务：地图上没有足够的合法空地放置平民','i');
    return G.mission;
  }
  /* ★ 平民布点：最远点采样（farthest-point sampling）。
     之前的「绕撤离区分扇区」在撤离区靠边时会失效 ——
     所有候选都挤在同一个角度范围里，扇区选不出人，兜底逻辑就导致扎堆。
     改用最远点采样后，无论撤离区在哪，都能稳定地铺满全图：
       ① 第一个点：取「离撤离区最远」的候选
       ② 之后每个点：取「离撤离区远」且「离已有点都远」的综合最优
     再叠加掩体偏好（半遮蔽优先），得到分散又像样的位置。 */
  const civs=[];
  const picked=[];
  /* 综合评分：离撤离区距离 + 到最近已选点的距离（越大越好） */
  function score(c){
    let near=1e9;
    for(const v of picked) near=Math.min(near,Math.hypot(v.x-c.x,v.y-c.y));
    if(!picked.length) near=c.d;
    /* 掩体加成：半遮蔽的点更「合理」，给一个有限的加分（不压过分散度） */
    const coverBonus=c.shelter>=2?TILE*1.2:0;
    return near*0.55 + Math.min(c.d,TILE*14)*0.45 + coverBonus;
  }
  const pool=cands.slice();
  for(let k=0;k<n&&pool.length;k++){
    let bi=-1,bs=-1e9;
    for(let i=0;i<pool.length;i++){
      const s2=score(pool[i]);
      if(s2>bs){ bs=s2; bi=i; }
    }
    if(bi<0) break;
    const c=pool[bi];
    /* 最后一个位置也要保证不和已选的挤在一起 */
    if(picked.length){
      let near=1e9;
      for(const v of picked) near=Math.min(near,Math.hypot(v.x-c.x,v.y-c.y));
      if(near<TILE*1.8) break;                     // 铺不开了就停，宁少勿挤
    }
    picked.push(c);
    pool.splice(bi,1);
    const u=makeUnit('civilian',0,c.x,c.y,G.counter++);
    u.spawnT=0; u.isCiv=true; u.saved=false; u.escort=null; u.claimed=false;
    G.units.push(u);
    civs.push(u);
  }
  G.mission={on:true,saved:0,total:civs.length,left:civs.length,lost:0,escorting:0,civs:civs,zone:zone,extractedList:[]};
  pushFeed('撤离任务开始：把 '+civs.length+' 名平民带回撤离区','i');
  return G.mission;
}
function setMsg(text,kind){
  const el=$('#mapMsg'); if(!el) return;
  el.className='msg '+(kind||''); el.textContent=text;
}
function showTeamMsg(i,text){
  const el=document.querySelector('#tmsg'+i);
  if(el){ el.className='msg err'; el.textContent=text; }
  setMsg(text,'err');
}
function roleStatLine(k){
  const d=CLASSES[k];
  if(d.melee) return '近战 '+d.dmg+' 伤害 · 移速 '+d.speed;
  /* ★ 「治疗半径」只对**真正会治疗**的兵种显示。
     旧代码写成 `if(d.gun) ... + ' · 治疗半径 ' + d.healR`，
     而盾卫也有手枪（gun）却没有 healR →
     选择界面里盾卫那一行会出现「治疗半径 undefined」。
     现在改成按 heal 标记判断，只有医疗兵才有这一项。 */
  if(d.heal) return '手枪 '+d.gun.dmg+' 伤害 · 移速 '+d.speed+' · 治疗半径 '+d.healR;
  if(d.gun)  return '手枪 '+d.gun.dmg+' 伤害 · 移速 '+d.speed;
  if(k==='shotgun') return '伤害 '+d.dmg+'×6 · 移速 '+d.speed;
  if(d.kind==='z'){
    const p=infectChance(d);
    return '伤害 '+d.dmg+' · 移速 '+d.speed+' · 感染 '+(p>=1?'100%':Math.round(p*100)+'%');
  }
  return '伤害 '+d.dmg+' · 移速 '+d.speed+' · 射程 '+d.range;
}
function roleRow(tid,clsKey,count){
  const d=CLASSES[clsKey];
  let tiles='';
  for(let i=1;i<=9;i++){
    const lit=i<=count;
    tiles+='<button class="tile'+(lit?' lit':'')+'" data-team="'+tid+'" data-role="'+clsKey+'" data-n="'+i+'"'+
      (lit?' style="background:'+d.color+';border-color:'+d.color+'"':'')+'>'+i+'</button>';
  }
  return '<div class="rrow">'+
    '<div class="rinfo"><div class="nm">'+
      (d.kind==='h'?'<i class="cdot" style="background:'+d.color+'"></i>':'<i class="sq" style="background:'+d.color+'"></i>')+
      ' '+d.name+'</div>'+
      '<div class="st">'+d.role+'</div><div class="st">'+roleStatLine(clsKey)+'</div></div>'+
    '<div class="tiles">'+
      '<button class="tile zero" data-team="'+tid+'" data-role="'+clsKey+'" data-n="0">0</button>'+
      tiles+
      '<span class="step"><button data-step="-1" data-team="'+tid+'" data-role="'+clsKey+'">−</button>'+
      '<button data-step="1" data-team="'+tid+'" data-role="'+clsKey+'">+</button></span>'+
      '<input class="numin" type="number" min="0" max="999" value="'+count+'" data-num="'+clsKey+'" data-team="'+tid+'"/>'+
      '<input class="range" type="range" min="0" max="100" step="1" value="'+Math.min(100,count)+'" title="拖动调整数量（上限 100）" data-num="'+clsKey+'" data-team="'+tid+'" data-range="1"/>'+
    '</div></div>';
}
function renderRoster(){
  const c=counts();
  let html='';
  for(let i=0;i<teams.length;i++){
    const t=teams[i], cc=c.teams[i];
    let head='<div class="ttl"><span><input class="tin" value="'+escAttr(t.name)+'" data-tname="'+i+'"/>'+
      '<i class="tc" style="background:'+teamColor(i)+'" title="队伍颜色"></i></span>'+
      '<span id="t'+i+'sum">合计 <b>'+cc.total+'</b></span></div>';
    head+='<div class="trow"><span class="lab">编成</span>'+
      '<select class="sel" data-ttype="'+i+'">'+
        '<option value="h"'+(t.type==='h'?' selected':'')+'>人类型</option>'+
        '<option value="z"'+(t.type==='z'?' selected':'')+'>僵尸型</option>'+
        '<option value="mix"'+(t.type==='mix'?' selected':'')+'>混编</option>'+
      '</select>'+
      '<span class="lab">颜色</span><input type="color" class="colin" value="'+teamColor(i)+'" data-tcolor="'+i+'"/>'+
      (teams.length>1?'<button class="btn del" data-tdel="'+i+'">删除队伍</button>':'')+
      '</div>';
    html+='<div class="teamBox t'+(i%2?'b':'a')+'" id="teamBox'+i+'" style="border-color:'+teamColor(i)+'66">'+
      head+
      '<div class="rrows">'+t.roles.map(k=>roleRow(i,k,cc.map[k])).join('')+'</div>'+
      '<div class="msg" id="tmsg'+i+'"></div>'+
    '</div>';
  }
  $('#teamList').innerHTML=html;
  $('#teamList').className='teamList'+(teams.length>1?' grid2':'');
  $('#btnAddTeam').style.display=teams.length<MAX_TEAMS?'':'none';
  return c;
}
function escAttr(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
function renderPreview(){
  renderRoster();
  refreshPreviewOnly();
}
function renderStatTable(){
  const FIELDS=[['hp','生命'],['speed','移速'],['dmg','伤害'],['cd','攻击间隔'],['range','射程'],['mag','弹匣'],['reload','换弹(s)']];
  let h='<thead><tr><th>角色</th><th>性质</th>'+FIELDS.map(f=>'<th>'+f[1]+'</th>').join('')+'</tr></thead><tbody>';
  for(const k of ALL_ROLES){
    const d=CLASSES[k];
    h+='<tr><td class="k">'+(d.kind==='h'?'<i class="cdot" style="background:'+d.color+'"></i>':'<i class="sq" style="background:'+d.color+'"></i>')+
      ' '+d.name+'</td><td>'+(d.kind==='h'?'人类型':'僵尸型')+'</td>';
    for(const [f] of FIELDS){
      const v=(f==='range'&&d.gun)?d.gun.range:(f==='dmg'&&d.gun)?d.gun.dmg:(f==='cd'&&d.gun)?d.gun.cd:(d[f]===undefined?0:d[f]);
      h+='<td><input class="numin" type="number" step="0.05" min="0" value="'+v+'" data-stat="'+k+'" data-field="'+f+'"/></td>';
    }
    h+='</tr>';
  }
  h+='</tbody>';
  $('#statTable').innerHTML=h;
}
function renderGuide(){
  let h='<thead><tr><th>角色</th><th>性质</th><th>生命</th><th>移速</th><th>伤害</th><th>攻速</th><th>射程</th><th>定位</th><th>功能</th></tr></thead><tbody>';
  for(const k of ALL_ROLES){
    const d=CLASSES[k];
    const g=d.gun||d;
    const dmg=(k==='shotgun'?d.dmg+' ×6 弹丸':(d.gun?d.gun.dmg+'（手枪）':(d.kind==='z'?d.dmg+'（近战）':String(d.dmg))));
    const rate=1/g.cd;
    const range=(d.melee?'近战':(d.kind==='z'?'近战':(d.range+' px')));
    let tags='';
    if(k==='rifle') tags+='每 '+GRENADE_CD+' 秒可掷一枚手雷：冷却较长，只在落点附近有 <b>2 个以上敌人</b>（或 1 个大型僵尸）时才扔；爆炸半径 '+GRENADE_R+' px、'+GRENADE_DMG+' 点伤害<br>';
    if(d.instant) tags+='<b style="color:#ff9ad2">命中即刻感染成功：被咬者当场尸变并倒戈</b><br>';
    else if(d.infect) tags+='<b style="color:#d9a4ff">近战命中造成感染（'+(infectChance(d)>=1?'100%':Math.round(infectChance(d)*100)+'%')+' 概率），'+INFECT_TIME.toFixed(0)+' 秒后尸变并倒戈</b><br>';
    if(d.hatch) tags+='每 '+d.hatch+' 秒孵化 '+((d.twins||1)>1?d.twins+' 只':'1 只')+'同队僵尸（累计上限 '+d.maxChild+'）<br>';
    if(d.deathBurst) tags+='<b style="color:#ffd84d">死亡时周围 '+d.deathBurst.r+' px 内造成 '+d.deathBurst.dmg+' 伤害，'+Math.round(d.deathBurst.infect*100)+'% 概率感染</b><br>';
    if(d.heal) tags+='每 '+HEAL_INTERVAL+' 秒治疗半径 '+d.healR+' 内的一名同队单位，并解除其感染<br>';
    if(d.melee&&d.kind==='h') tags+='同队人类型单位 +25% 射速（多人不叠加）<br>';
    /* 新增 4 个角色的机制说明 */
    if(d.burn) tags+='火舌<b style="color:#ffd84d">无限穿透</b>，穿过的每个敌人被点燃：每秒 '+BURN_DPS+' 点、持续 '+BURN_TIME+' 秒，<b>重复命中只刷新时间、不叠加</b><br>';
    if(d.emptyOnly) tags+='<b style="color:#ff9ad2">燃料罐必须打空才能换弹</b>（中途不许换），换弹 '+(d.reload||0).toFixed(1)+' 秒<br>';
    if(d.rocket) tags+='发射火箭弹：<b>命中即爆</b>，打空则飞到最大射程自爆；爆炸半径 '+ROCKET_R+' px、中心 '+ROCKET_DMG+' 点，离爆心越远伤害越低（最低 35%）<br>';
    if(d.shield) tags+='盾击（半径 '+d.shield.reach+' px / '+d.shield.dmg+' 伤害）：把僵尸<b style="color:#ffd84d">击退 '+d.shield.kb+' 速度</b>；<b style="color:#ff9ad2">最近 '+SHIELD_HIT_WINDOW+' 秒内挨过打就不能开枪</b>，未受击时才用手枪还击<br>';
    if(d.mag) tags+=(d.shell
      ? '弹仓 '+d.mag+' 发，逐发装填（每发 '+(d.reload||0).toFixed(1)+' 秒，开火会打断）'
      : '弹匣 '+d.mag+' 发，打空后换弹 '+(d.reload||0).toFixed(1)+' 秒')
      +'；脱离战斗时会主动换弹（可在阵容页开关）<br>';
    h+='<tr><td>'+(d.kind==='h'?'<i class="cdot" style="background:'+d.color+'"></i>':'<i class="sq" style="background:'+d.color+'"></i>')+
       ' <b>'+d.name+'</b></td><td>'+(d.kind==='h'?'人类型':'僵尸型')+'</td><td>'+d.hp+'</td><td>'+d.speed+'</td><td>'+dmg+'</td>'+
       '<td>'+rate.toFixed(1)+' /秒</td><td>'+range+'</td><td>'+d.role+'</td><td style="color:#9db1cc">'+tags+d.feat+'</td></tr>';
  }
  h+='</tbody>';
  $('#guideTable').innerHTML=h;
}

/* ---------------- 僵尸轮次编辑器 ---------------- */
function waveRowHTML(i,w){
  const tiles=ROLES_Z.map(k=>{
    const d=CLASSES[k], n=w.lineup[k]||0;
    return '<span class="wv" style="border-color:'+d.color+'66"><i class="sq" style="background:'+d.color+'"></i>'+
      d.name+'<input class="numin" type="number" min="0" max="999" value="'+n+'" data-wave="'+i+'" data-wrole="'+k+'"/></span>';
  }).join('');
  return '<div class="teamBox" style="border-color:#4a2a2a">'+
    '<div class="ttl"><span>第 '+(i+1)+' 波</span>'+
      '<span><span class="lab">上一波清空后 / 最长间隔</span>'+
      '<input class="numin" type="number" min="3" max="180" value="'+w.gap+'" data-wave="'+i+'" data-wgap="1"/> 秒'+
      (waves.length>1?'<button class="btn del" data-wdel="'+i+'">删除本波</button>':'')+
      '</span></div>'+
    '<div class="tiles" style="gap:8px">'+tiles+'</div>'+
  '</div>';
}
function renderWaves(){
  $('#waveList').innerHTML=waves.map((w,i)=>waveRowHTML(i,w)).join('');
  let tot=0; for(const w of waves) for(const k in w.lineup) tot+=w.lineup[k];
  $('#wavePreview').innerHTML='共 <b>'+waves.length+'</b> 波、合计 <b>'+tot+'</b> 只僵尸'+
    (waveOn?'　<b style="color:#7dffa8">轮次已开启</b>':'　<span style="color:#7d8fa8">轮次未开启（僵尸队伍按阵容编制出场）</span>');
}
function defaultWaves(){
  waves=[
    {lineup:{zombie:6,mother:1},gap:25},
    {lineup:{zombie:8,runner:3,mother:1},gap:25},
    {lineup:{zombie:10,runner:4,mother:2,bigbelly:1},gap:25},
  ];
}

/* ---------------- 地图编辑器 ---------------- */
const ed=$('#editor'), ectx=ed.getContext('2d');
let ED_S=ed.width/GW;
let tool=WALL, mirror=0, painting=false;

/* ═══════════ 预设出生点 ═══════════
   玩家可以直接在地图上点出「队伍出生点」和「僵尸刷怪点」，
   而不是只能接受按地图边缘自动排布的默认位置。

   数据结构：
     G.customSpawns = [ {team:0, x, y}, ... ]   队伍出生点（按队伍号）
     G.customSpawners = [ {x, y, r, name}, ... ] 刷怪点（僵尸从这些洞口涌出）

   两者都存在 SIZE_MAP[尺寸] 里，随地图一起保留；
   清空地图 / 重置地图时一并清除。 */
let spawnTool=null;          // null = 画笔模式；'team' / 'spawner' = 出生点模式
function ensureSpawnStore(){
  const mem=SIZE_MAP[MSIZE]||(SIZE_MAP[MSIZE]={kind:'balanced',custom:null});
  if(!mem.customSpawns) mem.customSpawns=[];
  if(!mem.customSpawners) mem.customSpawners=[];
  return mem;
}
/* 在编辑区画出生点标记：队伍用队伍色圆环，刷怪点用紫色虚线圈 */
function drawSpawnMarks(){
  const mem=SIZE_MAP[MSIZE]; if(!mem) return;
  const sx=ed.width/GW, sy=ed.height/GH;
  /* 队伍出生点 */
  const cs=mem.customSpawns||[];
  for(let i=0;i<cs.length;i++){
    const s=cs[i];
    const px=(s.x/TILE)*sx, py=(s.y/TILE)*sy;
    const col=teamColor(s.team|0);
    ectx.strokeStyle=hexA(col,0.95); ectx.lineWidth=2;
    ectx.beginPath(); ectx.arc(px,py,Math.max(5,sx*0.75),0,TAU); ectx.stroke();
    ectx.fillStyle=hexA(col,0.22);
    ectx.beginPath(); ectx.arc(px,py,Math.max(5,sx*0.75),0,TAU); ectx.fill();
    ectx.fillStyle=col; ectx.font='bold 10px system-ui'; ectx.textAlign='center';
    ectx.fillText(String((s.team|0)+1),px,py+3.5);
  }
  /* 刷怪点 */
  const sp=mem.customSpawners||[];
  for(let i=0;i<sp.length;i++){
    const s=sp[i];
    const px=(s.x/TILE)*sx, py=(s.y/TILE)*sy;
    ectx.strokeStyle='rgba(192,122,255,0.95)'; ectx.lineWidth=2;
    ectx.setLineDash([4,3]);
    ectx.beginPath(); ectx.arc(px,py,Math.max(6,sx*1.1*(s.r/40)),0,TAU); ectx.stroke();
    ectx.setLineDash([]);
    ectx.fillStyle='rgba(192,122,255,0.18)';
    ectx.beginPath(); ectx.arc(px,py,Math.max(6,sx*1.1*(s.r/40)),0,TAU); ectx.fill();
  }
}
/* 把一个出生点写进地图（并按镜像规则同步对称位置） */
function edPlaceSpawn(cx,cy){
  const mem=ensureSpawnStore();
  const x=cx*TILE+TILE*0.5, y=cy*TILE+TILE*0.5;
  if(spawnTool==='team'){
    /* 队伍号 = 当前选中的队伍；没有就默认 0 */
    const t=clamp(spawnTeam|0,0,Math.max(0,teams.length-1));
    /* 同一个队伍只保留一个自定义出生点（后点覆盖前点） */
    mem.customSpawns=mem.customSpawns.filter(s=>(s.team|0)!==t);
    mem.customSpawns.push({team:t,x:x,y:y});
  } else {
    /* 刷怪点：不要重复贴太近 */
    let dup=false;
    for(const s of mem.customSpawners){
      if(Math.hypot(s.x-x,s.y-y)<TILE*2){ dup=true; break; }
    }
    if(!dup) mem.customSpawners.push({x:x,y:y,r:40,name:'洞口'+(mem.customSpawners.length+1)});
  }
  drawEditor();
}
let spawnTeam=0;

function drawEditor(){
  ectx.clearRect(0,0,ed.width,ed.height);
  ectx.fillStyle='#0a0f18'; ectx.fillRect(0,0,ed.width,ed.height);
  /* 有自定义出生点时就不画默认的渐变区，避免两套标记打架 */
  const mem=SIZE_MAP[MSIZE];
  const hasCustom=!!(mem&&mem.customSpawns&&mem.customSpawns.length);
  const anchors=teamAnchors(teams.length);
  if(!hasCustom){
    for(let i=0;i<anchors.length;i++){
      const a=anchors[i], col=teamColor(i);
      const grd=ectx.createRadialGradient(a.x*(ed.width/VW),a.y*(ed.height/VH),6,a.x*(ed.width/VW),a.y*(ed.height/VH),ED_S*5);
      grd.addColorStop(0,hexA(col,0.16)); grd.addColorStop(1,hexA(col,0));
      ectx.fillStyle=grd; ectx.fillRect(0,0,ed.width,ed.height);
    }
  }
  for(let y=0;y<GH;y++) for(let x=0;x<GW;x++){
    const t=editGrid[idx(x,y)];
    if(t) drawTile(ectx,t,x,y,ED_S);
  }
  ectx.strokeStyle='rgba(255,255,255,0.045)'; ectx.lineWidth=1;
  ectx.beginPath();
  for(let x=0;x<=GW;x++){ ectx.moveTo(x*ED_S+.5,0); ectx.lineTo(x*ED_S+.5,ed.height); }
  for(let y=0;y<=GH;y++){ ectx.moveTo(0,y*ED_S+.5); ectx.lineTo(ed.width,y*ED_S+.5); }
  ectx.stroke();
  ectx.font='bold 11px system-ui'; ectx.textAlign='center'; ectx.textBaseline='alphabetic';
  for(let i=0;i<anchors.length;i++){
    const a=anchors[i];
    if(hasCustom) break;                    // 自定义出生点会自己画队名
    ectx.fillStyle=hexA(teamColor(i),0.6);
    ectx.fillText(teams[i].name,clamp(a.x*(ed.width/VW),30,ed.width-30),clamp(a.y*(ed.height/VH)-ED_S*3.4,12,ed.height-4));
  }
  drawSpawnMarks();
}
function edPos(ev){
  const r=ed.getBoundingClientRect();
  const x=(ev.clientX-r.left)*(ed.width/r.width);
  const y=(ev.clientY-r.top)*(ed.height/r.height);
  return {cx:clamp(Math.floor(x/ED_S),0,GW-1),cy:clamp(Math.floor(y/ED_S),0,GH-1)};
}
/* 画笔模式：正常绘制地形并同步镜像 */
function edPaint(cx,cy){
  const set=(x,y,t)=>{ if(inB(x,y)) editGrid[idx(x,y)]=t; };
  set(cx,cy,tool);
  if(mirror>=1) set(GW-1-cx,cy,tool);
  if(mirror===2){ set(cx,GH-1-cy,tool); set(GW-1-cx,GH-1-cy,tool); }
  drawEditor();
}
/* 出生点模式：左键放点，右键删点 */
function edEditSpawn(cx,cy,del){
  const mem=ensureSpawnStore();
  const x=cx*TILE+TILE*0.5, y=cy*TILE+TILE*0.5;
  if(del){
    mem.customSpawns=mem.customSpawns.filter(s=>Math.hypot(s.x-x,s.y-y)>TILE*1.2);
    mem.customSpawners=mem.customSpawners.filter(s=>Math.hypot(s.x-x,s.y-y)>TILE*1.2);
  } else {
    edPlaceSpawn(cx,cy);
    return;
  }
  drawEditor();
}
ed.addEventListener('contextmenu',e=>e.preventDefault());
ed.addEventListener('pointerdown',e=>{
  painting=true; if(ed.setPointerCapture) ed.setPointerCapture(e.pointerId);
  const p=edPos(e);
  if(spawnTool){ edEditSpawn(p.cx,p.cy,e.button===2); return; }
  const prev=tool;
  if(e.button===2) tool=EMPTY;
  edPaint(p.cx,p.cy);
  tool=prev;
});
ed.addEventListener('pointermove',e=>{
  if(!painting) return;
  const p=edPos(e);
  if(spawnTool){ if(e.buttons===1) edPlaceSpawn(p.cx,p.cy); return; }
  const prev=tool;
  if(e.buttons===2) tool=EMPTY;
  edPaint(p.cx,p.cy);
  tool=prev;
});
ed.addEventListener('pointerup',()=>{
  painting=false;
  const mem=SIZE_MAP[MSIZE]; if(mem) mem.custom=Uint8Array.from(editGrid);
});
ed.addEventListener('pointercancel',()=>{ painting=false; });

/* ---------------- 战场框选 / 右键派遣 ---------------- */
function cvsPos(ev){
  const r=cvs.getBoundingClientRect();
  return {x:(ev.clientX-r.left)*(VW/r.width), y:(ev.clientY-r.top)*(VH/r.height)};
}
function selectedUnits(){
  const out=[];
  for(const u of G.units) if(u.alive&&G.selected.has(u.id)) out.push(u);
  return out;
}
function dispatchSelected(x,y){
  const list=selectedUnits();
  if(!list.length){ pushFeed('先用左键框选或点选部队，再右键派遣','i'); return 0; }
  for(const u of list){
    u.dispatch={x:x,y:y}; u.dispatchT=DISPATCH_TTL;
    resetUnitPlan(u);                                    // 立刻丢弃旧计划与路径
    if(u.behavior==null&&u.kind==='h') u.behavior='push';   // 有明确目的地时不再原地游走
  }
  G.dispatchMark={x:x,y:y,t:2.4};
  pushFeed('已派遣 '+list.length+' 个单位前往 ('+Math.round(x)+','+Math.round(y)+')','i');
  return list.length;
}
/* ---------------- 屏蔽浏览器手势 / 默认行为（防误触） ----------------
   双击缩放、双指捏合、下拉刷新、长按选中、右键菜单、ctrl+滚轮缩放、拖放都会打断操作 */
(function(){
  const stop=e=>e.preventDefault();
  document.addEventListener('gesturestart',stop);              // Safari 捏合
  document.addEventListener('gesturechange',stop);
  document.addEventListener('dragstart',stop);
  document.addEventListener('selectstart',e=>{                 // 画布上不许划选文字
    if(e.target===cvs) e.preventDefault();
  });
  document.addEventListener('dblclick',e=>{ if(e.target===cvs) stop(e); });
  cvs.addEventListener('contextmenu',stop);                    // 右键菜单（战场右键=派遣）
  cvs.addEventListener('auxclick',stop);                       // 中键自动滚动
  cvs.addEventListener('wheel',e=>{ if(e.ctrlKey) stop(e); },{passive:false});
  cvs.addEventListener('touchstart',stop,{passive:false});     // 双击缩放 / 长按菜单
  cvs.addEventListener('touchmove',stop,{passive:false});
  cvs.addEventListener('touchend',stop,{passive:false});
  window.addEventListener('beforeunload',e=>{                  // 战斗未结算时防误关
    if(G.phase==='battle'&&G.units.some(u=>u.alive)){ e.preventDefault(); e.returnValue=''; }
  });
  /* 全屏下额外加固：浏览器自身的快捷键一律不响应（保留复制粘贴等编辑操作） */
  const KEEP_CTRL=new Set(['c','v','x','a','z','y']);
  const BROWSER_KEYS=new Set(['+','-','=','0','F5','F7','F11','F12','Backspace','Delete',
    'BrowserBack','BrowserForward','BrowserRefresh','BrowserSearch','BrowserHome','ZoomIn','ZoomOut']);
  window.addEventListener('keydown',e=>{
    if(!isFull()) return;
    const k=e.key, low=(typeof k==='string')?k.toLowerCase():'';
    const ctrl=e.ctrlKey||e.metaKey;
    if(ctrl&&KEEP_CTRL.has(low)) return;                       // 编辑操作放行
    if(ctrl||e.altKey||BROWSER_KEYS.has(k)){ e.preventDefault(); e.stopPropagation(); }
  },true);
  window.addEventListener('wheel',e=>{                         // 全屏里禁止 Ctrl+滚轮缩放
    if(isFull()&&(e.ctrlKey||e.metaKey)) e.preventDefault();
  },{passive:false});
  window.addEventListener('contextmenu',e=>{                   // 全屏里全页面禁右键菜单
    if(isFull()) e.preventDefault();
  },true);
  window.addEventListener('dragstart',e=>{ if(isFull()) e.preventDefault(); },true);
  window.addEventListener('selectstart',e=>{ if(isFull()) e.preventDefault(); },true);
})();

let dragSel=null;
cvs.addEventListener('contextmenu',e=>{
  e.preventDefault();
  if(G.phase!=='battle'||!G.cmdOn) return;      // 点击指挥关闭时右键不派遣，防误触
  const p=cvsPos(e);
  dispatchSelected(p.x,p.y);
});
cvs.addEventListener('pointerdown',e=>{
  sfxResume();                                            // 浏览器要求用户交互后才能出声
  if(G.phase!=='battle'||e.button!==0||!G.cmdOn) return;   // 关闭时不改选，防误触
  const p=cvsPos(e);
  dragSel={x0:p.x,y0:p.y,x1:p.x,y1:p.y,add:!!(e.shiftKey)};
  G.selBox={x0:p.x,y0:p.y,x1:p.x,y1:p.y};
  if(cvs.setPointerCapture) cvs.setPointerCapture(e.pointerId);
});
cvs.addEventListener('pointermove',e=>{
  if(!dragSel) return;
  const p=cvsPos(e);
  dragSel.x1=p.x; dragSel.y1=p.y;
  G.selBox={x0:dragSel.x0,y0:dragSel.y0,x1:p.x,y1:p.y};
});
function finishSelect(){
  if(!dragSel) return;
  const b=dragSel; dragSel=null; G.selBox=null;
  const x0=Math.min(b.x0,b.x1), x1=Math.max(b.x0,b.x1);
  const y0=Math.min(b.y0,b.y1), y1=Math.max(b.y0,b.y1);
  const tiny=(x1-x0)<6&&(y1-y0)<6;
  if(!b.add) G.selected.clear();
  if(tiny){                                     // 单击 = 点选最近的单位
    let best=null,bd=26;
    for(const u of G.units){
      if(!u.alive) continue;
      /* 撤离模式下只能指挥人类 —— 僵尸不响应点选 */
      if(!commandable(u)) continue;
      const d=Math.hypot(u.x-b.x0,u.y-b.y0);
      if(d<bd){ bd=d; best=u; }
    }
    if(best) selectUnit(best);
    syncBehaviorUI();
    return;
  }
  for(const u of G.units){
    if(!u.alive) continue;
    /* 框选同样要过权限：撤离模式下框到僵尸也不能选中 */
    if(!commandable(u)) continue;
    if(u.x>=x0&&u.x<=x1&&u.y>=y0&&u.y<=y1) selectUnit(u);
  }
  syncBehaviorUI();
}
cvs.addEventListener('pointerup',finishSelect);
cvs.addEventListener('pointercancel',()=>{ dragSel=null; G.selBox=null; });
function setGlobalBehavior(beh){
  G.behavior=beh;
  for(const u of G.units) resetUnitPlan(u);   // 清掉旧指令，全员回到全局预设
  syncBehaviorUI();
  updateHUD(1);
}
/* ★ 切换预设后必须「立刻」生效，不能等它自己到期：
   单位的决策是有节流的（planT / targetT / pathT / coverT），
   只改 u.behavior 的话，旧计划还会继续跑一段时间（最长 1.2 秒），
   玩家点了按钮却看着部队不动 —— 这就是「切模式不立刻执行」的原因。
   这里把所有节流计时器清零并丢弃缓存的路径/掩体/目标，
   下一帧 AI 就会用新预设重新决策。 */
function resetUnitPlan(u){
  u.planT=0; u.plan=null; u.planName=null;
  u.targetT=0; u.targetRef=null;
  u.pathT=0; u.path=null; u.pathGoal=-1;
  u.coverT=0; u.cover=null;
  u.stuck=0; u.stuckT=0;
}
function applyBehavior(beh){                  // 底栏：有框选就只改这批人（预设只对人类型生效）
  if(G.selected.size){
    let n=0;
    for(const u of G.units){
      if(u.alive&&u.kind==='h'&&G.selected.has(u.id)){
        u.behavior=beh; u.dispatch=null; resetUnitPlan(u); n++;
      }
    }
    pushFeed('已把选中的 '+n+' 个单位切换为「'+BEHAVIORS[beh]+'」','i');
  } else {
    G.behavior=beh;
    for(const u of G.units) u.behavior=null;
  }
  syncBehaviorUI();
  updateHUD(1);
}
function syncBehaviorUI(){
  $$('.beh').forEach(b=>b.classList.toggle('on',b.dataset.beh===G.behavior));
  const cur=new Set();
  if(G.selected.size){
    for(const u of G.units){
      if(u.alive&&G.selected.has(u.id)) cur.add(u.behavior||G.behavior);
    }
  }
  const one=cur.size===1?[...cur][0]:null;      // 选中的这批是否统一
  $$('.behq').forEach(b=>b.classList.toggle('sel',one!==null&&b.dataset.beh===one));
}

/* ---------------- 随机地图 / 打通通道 ---------------- */
/* ═══════════════════ 随机地图生成 ═══════════════════
   要求：「技术上可以进行随机地图生成吗，要足够可靠的」。

   旧版的问题：
     · 用**硬编码坐标**（cx=k?28:11、cy=5+rand*12）—— 只在 40×22 上成立，
       换任何尺寸都会跑偏（28×16 时 x=28 已经出界）
     · 随机撒 18 个门窗，可能撒在墙外/彼此不连通
     · 失败 40 次后**静默退回固定地图**，玩家以为「随机没生效」

   新方案：复用已经过验证的 buildTacticalMap —— 它本身就是
   「路网 + 街区填充 + 连通性修补 + 对称化」的完整管线，
   只要换个随机种子就是一张全新的图。优点：
     · 天然按 GW/GH 自适应（所有数量参数都按面积缩放）
     · 自带「打开封闭天腔」「出生区清空」「镜像对称化」
     · 与预置图同源，品质一致

   再加一层**可靠性保证**：生成后跑体检，不合格就换种子重试，
   重试 30 次仍失败才退回预置图（并且**上报**失败，不静默）。 */
function buildRandomMap(seed, style){
  const base=(seed===undefined)?((Date.now()&0xffffff)>>>0):(seed>>>0);
  const styles=['open','balanced','urban','fort'];
  const useStyle=style||styles[base%styles.length];
  for(let att=0;att<30;att++){
    const s=(base+att*7919)>>>0;
    const g=buildTacticalMap(useStyle,s);
    /* 体检：连通区够大 + 出生区够宽 + 门窗密度够 */
    let wall=0,win=0,door=0;
    for(let i=0;i<g.length;i++){
      const t=g[i];
      if(t===WALL) wall++; else if(t===WIN) win++; else if(t===DOOR) door++;
    }
    const a=auditMap(g);
    /* ★ 合格判据要跟着地图设计走。
       现在是「稀疏掩体 + 开阔战场」，所以：
         · 连通区门槛从 40% 提到 **55%** —— 地图本来就该大部分可走；
           低于这个数说明掩体意外连成片把地图堵了。
         · 开口（门+窗）只要 ≥3 —— 掩体稀疏的风格本来就少开口，
           强求密度会把 `open` 这类极稀疏设计全部判失败。
         · 出生区仍然要够宽（≥12 格可站）。 */
    const ok = a.ok &&
               a.stats.mainSize >= GW*GH*0.55 &&
               a.stats.spawnFree >= 12 &&
               (door+win) >= 3;
    if(ok) return g;
  }
  /* 兜底：明确告诉调用方「这次没生成出合格的图」，而不是假装成功 */
  const fb=buildTacticalMap('balanced', 11002);
  fb._randomFailed=true;
  return fb;
}
/* 供 UI / 测试查询：随机生成是否可靠（跑 N 次，统计合格率） */
function randomMapReliability(n){
  n=n||20;
  let ok=0, firstTry=0;
  const seen=new Set();
  for(let i=0;i<n;i++){
    const g=buildRandomMap((i*104729+7)>>>0);
    if(!g._randomFailed) ok++;
    let h=0;
    for(let k=0;k<g.length;k++) h=((h*31)+g[k])|0;
    seen.add(h);
  }
  return {runs:n, ok:ok, unique:seen.size, rate:+(ok/n).toFixed(3)};
}

/* 打通一条横贯通道。
   ★ 旧版的问题：它挑「障碍最少的一行」然后把墙变成门 ——
     如果地图本来就有畅通的行，它**什么都不做**，
     玩家点了按钮看不到任何变化，以为按钮坏了。
     现在改成：
       ① 先看有没有「完全畅通」的行（无障碍）—— 有就直接告诉玩家不用打
       ② 否则挑障碍最少的一行，把墙/窗换成门（真的凿穿）
       ③ 返回 {y, carved, alreadyOpen} 供 UI 给出准确反馈 */
function carvePassage(){
  let bestY=1, bestCost=1e9;
  for(let y=1;y<GH-1;y++){
    let c=0;
    for(let x=1;x<=GW-2;x++){ const t=editGrid[idx(x,y)]; if(t===WALL||t===WIN) c++; }
    if(c<bestCost){ bestCost=c; bestY=y; }
  }
  /* 已经有畅通的行 → 不用凿 */
  if(bestCost===0){
    return {y:bestY, carved:0, alreadyOpen:true};
  }
  let carved=0;
  for(let x=1;x<=GW-2;x++){
    const t=editGrid[idx(x,bestY)];
    if(t===WALL||t===WIN){ editGrid[idx(x,bestY)]=DOOR; carved++; }
  }
  return {y:bestY, carved:carved, alreadyOpen:false};
}

/* ---------------- 队伍增删 ---------------- */
function defaultLineup(type){
  const o=lineupForType(type,{});
  if(type==='h') return Object.assign(o,BASE_H);
  if(type==='z') return Object.assign(o,BASE_Z);
  o.rifle=4; o.medic=1; o.zombie=5; o.mother=1;
  return o;
}
function addTeam(){
  if(teams.length>=MAX_TEAMS) return;
  const i=teams.length;
  teams.push(blankTeam(i,'mix',defaultLineup('mix')));
  syncTeamRoles();
  renderPreview(); renderGuide(); drawEditor();
  setMsg('已添加'+teams[i].name+'（默认为混编，可自行调整）','ok');
}
function removeTeam(i){
  if(teams.length<=1) return;
  teams.splice(i,1);
  syncTeamRoles();
  renderPreview(); renderGuide(); drawEditor();
  setMsg('已删除队伍，剩余 '+teams.length+' 支','ok');
}
function setTeamType(i,type){
  const old=teams[i].lineup;
  const nl=lineupForType(type,old);
  const total=Object.keys(nl).reduce((a,k)=>a+nl[k],0);
  teams[i].type=type;
  teams[i].lineup=total?nl:defaultLineup(type);
  syncTeamRoles();
  renderPreview(); renderGuide();
}
function setRole(tid,role,n,opts){
  teams[tid].lineup[role]=clamp(Math.floor(n)||0,0,999);
  if(opts&&opts.silent){                       // 打字 / 拖滑块时不重建面板，避免打断输入
    const sum=document.querySelector('#t'+tid+'sum');
    if(sum) sum.innerHTML='合计 <b>'+teamCounts(tid).total+'</b>';
    refreshPreviewOnly();
    return;
  }
  renderPreview();
}
function previewHTML(){
  const c=counts();
  return teams.map((t,i)=>{
    const m=c.teams[i].map;
    if(!c.teams[i].total) return '<div style="color:#ff9a8a">'+t.name+'：未配置任何单位</div>';
    return '<div><b style="color:'+teamColor(i)+'">'+t.name+'</b>（'+TYPE_NAMES[t.type]+'）：'+
      t.roles.filter(k=>m[k]>0).map(k=>{
        const d=CLASSES[k];
        return '<span class="chip"><i class="'+(d.kind==='h'?'cdot':'sq')+'" style="background:'+d.color+'"></i> '+
          d.name+' × <b>'+m[k]+'</b></span>';
      }).join('')+'</div>';
  }).join('');
}
function refreshPreviewOnly(){ $('#preview').innerHTML=previewHTML(); }

/* ---------------- 事件绑定 ---------------- */
$$('.tab').forEach(b=>b.addEventListener('click',()=>{
  $$('.tab').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  $$('.pane').forEach(p=>p.classList.remove('on'));
  $('#pane-'+b.dataset.tab).classList.add('on');
  if(b.dataset.tab==='map') drawEditor();
  if(b.dataset.tab==='stats') renderStatTable();
}));
/* ═══════════ 模式切换：常规对战 / 撤离任务 ═══════════
   两种模式的目标、地图来源、队伍规则都不同，所以做到最顶层。
   切换时：
     · 点亮对应按钮
     · 撤离模式下显示「撤离设置」页签，常规模式隐藏
     · 同步 missionFlag / 复选框 / 权限锁
     · 切到撤离时若页签停在「撤离设置」以外，自动跳过去
   这样「模式」是一个明确的顶层概念，而不是藏在某个页签里的选项。 */
let gameMode='normal';
function setGameMode(m){
  gameMode=(m==='mission')?'mission':((m==='budget')?'budget':'normal');
  $$('.modebtn').forEach(function(b){ b.classList.toggle('on', b.dataset.mode===gameMode); });
  const isM=gameMode==='mission';
  const isB=gameMode==='budget';
  /* ★ 撤离 / 预算 是封闭玩法：隐藏标准模式的那套改动系统
     （队伍与阵容 / 行为预设 / 数值调整 / 僵尸轮次）。
     这些页签的配置由模式的规则接管，开放出来只会让玩家
     改了半天却被模式覆盖，或者直接改坏平衡。 */
  $$('.tab.ntab').forEach(function(t){ t.classList.toggle('hide', isM||isB); });
  /* 「撤离设置」只在撤离模式出现；「预算编队」只在预算模式出现 */
  $$('.tab.mtab').forEach(function(t){ t.classList.toggle('hide', !isM); });
  $$('.tab.btab').forEach(function(t){ t.classList.toggle('hide', !isB); });
  /* 同步复选框（玩家看得见的状态要和模式一致） */
  const cb=$('#chkMission');
  if(cb) cb.checked=isM;
  missionFlag=isM;
  if(!isM){
    G.missionLock=false;
    G.mission.on=false; G.mission.civs=[]; G.mission.zone=null;
  } else {
    applyMissionLineup(false);            // 队伍不成形时补默认编制
  }
  /* 页签切换：进入某个模式就跳到它专属的设置页；
     若当前停在「本模式已隐藏」的页签上，也要跳走，
     否则会留下一个看不见的页签却是激活态（面板显示空白）。 */
  const active0=$$('.tab').filter(function(t){ return t.classList.contains('active'); })[0];
  const activeHidden = active0 && active0.classList.contains('hide');
  const wantTab = isM ? 'mission' : (isB ? 'budget' : (activeHidden ? 'map' : null));
  if(wantTab){
    const target=$$('.tab').filter(function(t){ return t.dataset.tab===wantTab; })[0];
    const active=$$('.tab').filter(function(t){ return t.classList.contains('active'); })[0];
    if(target&&active!==target){
      $$('.tab').forEach(function(t){ t.classList.remove('active'); });
      target.classList.add('active');
      $$('.pane').forEach(function(p){ p.classList.remove('on'); });
      const pane=$('#pane-'+wantTab); if(pane) pane.classList.add('on');
    }
    if(isM){ try{ refreshMissionMapView(currentMissionMap||'corridor'); }catch(e){} }
    if(isB){ try{ renderBudget(); }catch(e){} }
    if(wantTab==='map'){ try{ drawEditor(); }catch(e){} }
  }
  const nameMap={normal:'常规对战', mission:'撤离任务', budget:'预算模式'};
  try{ setMsg('已切换到「'+nameMap[gameMode]+'」模式','ok'); }catch(e){}
  return gameMode;
}
$$('.modebtn').forEach(function(b){
  b.addEventListener('click',function(){ setGameMode(b.dataset.mode); });
});
/* ★ 初始化时必须跑一次 setGameMode。
   踩过的坑：页签显隐只在「点击模式按钮」时更新，
   而 HTML 里所有页签默认都没有 hide ——
   于是玩家一进配置页，常规模式下也能看到「撤离设置 / 预算编队」两个页签
   （实测 gameMode='normal' 但 mission/budget 页签 display=block）。
   这里在绑定完按钮后立刻同步一次初始状态。 */
try{ setGameMode(gameMode||'normal'); }catch(e){}
$$('.tool').forEach(b=>b.addEventListener('click',()=>{
  $$('.tool').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); tool=parseInt(b.dataset.tool,10);
}));
$$('.mir').forEach(b=>b.addEventListener('click',()=>{
  $$('.mir').forEach(x=>x.classList.remove('on'));
  b.classList.add('on'); mirror=parseInt(b.dataset.mir,10);
}));
/* ---------------- 预设出生点按钮 ---------------- */
$$('.spw').forEach(b=>b.addEventListener('click',()=>{
  $$('.spw').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');
  const v=b.dataset.spawn;
  spawnTool = (v==='none') ? null : v;
  setMsg(spawnTool==='team' ? '队伍出生点模式：左键放置、右键删除'
       : spawnTool==='spawner' ? '刷怪点模式：左键放置、右键删除'
       : '已退出出生点模式', 'ok');
  drawEditor();
}));
if($('#spawnTeamIn')) $('#spawnTeamIn').addEventListener('change',e=>{
  spawnTeam=clamp((parseInt(e.target.value,10)||1)-1,0,5);
});
if($('#btnSpawnClear')) $('#btnSpawnClear').addEventListener('click',()=>{
  const mem=ensureSpawnStore();
  mem.customSpawns=[]; mem.customSpawners=[];
  drawEditor();
  setMsg('已清空该尺寸地图上的自定义出生点','ok');
});
/* ---------------- 地图浏览 ----------------
   把一张地图画进指定的 canvas，并标注关键地形：
   墙 / 窗 / 门 + 撤离区（绿框）+ 平民点（青点）+ 僵尸入口（紫圈）。
   这是「撤离模式也要地图浏览」的实现，让玩家选图前就能看清结构。 */
function drawMapPreview(canvas, grid, opts){
  if(!canvas||!grid) return;
  opts=opts||{};
  const ctx2=canvas.getContext('2d');
  const s=Math.max(1,Math.floor(Math.min(canvas.width/GW, canvas.height/GH)));
  const ox=Math.floor((canvas.width-GW*s)/2), oy=Math.floor((canvas.height-GH*s)/2);
  ctx2.clearRect(0,0,canvas.width,canvas.height);
  ctx2.fillStyle='#05080e'; ctx2.fillRect(0,0,canvas.width,canvas.height);
  for(let y=0;y<GH;y++) for(let x=0;x<GW;x++){
    const t=grid[idx(x,y)];
    if(t===EMPTY) continue;
    ctx2.fillStyle = t===WALL?'#2f3d55' : (t===WIN?'#6fc8ff' : '#ffbe5c');
    ctx2.globalAlpha = t===WALL?1:0.85;
    ctx2.fillRect(ox+x*s, oy+y*s, s, s);
  }
  ctx2.globalAlpha=1;
  /* 撤离区 */
  if(opts.zone){
    const zx=ox+Math.floor(opts.zone.x/TILE)*s, zy=oy+Math.floor(opts.zone.y/TILE)*s;
    const zr=Math.max(4,Math.round(TILE*1.6/TILE)*s);
    ctx2.strokeStyle='#7dffa8'; ctx2.lineWidth=2;
    ctx2.strokeRect(zx-zr, zy-zr, zr*2, zr*2);
  }
  /* 平民点 */
  for(const c of (opts.civs||[])){
    ctx2.fillStyle='#4ad6c8';
    ctx2.beginPath(); ctx2.arc(ox+(c.x/TILE)*s, oy+(c.y/TILE)*s, Math.max(1.5,s*0.35), 0, TAU); ctx2.fill();
  }
  /* 僵尸入口 */
  for(const sp of (opts.spawners||[])){
    ctx2.strokeStyle='#c07aff'; ctx2.lineWidth=2;
    ctx2.beginPath(); ctx2.arc(ox+(sp.x/TILE)*s, oy+(sp.y/TILE)*s, Math.max(3,s*0.9), 0, TAU); ctx2.stroke();
  }
}
/* 刷新「撤离模式」面板里的地图浏览 */
function refreshMissionMapView(kind){
  const cv=$('#mapView'); if(!cv) return;
  const k=kind||currentMissionMap||'corridor';
  currentMissionMap=k;
  if(!MISSION_MAPS[k]) return;
  const built=buildMissionMap(k);
  /* 生成预览用的三个要点：撤离区、平民候选（采样少量）、僵尸入口 */
  const zone=built.zone;
  const spawners=[
    {x:GW*TILE-TILE*2, y:GH*TILE*0.25},
    {x:GW*TILE-TILE*2, y:GH*TILE*0.75},
    {x:GW*TILE-TILE*5, y:GH*TILE*0.5},
  ];
  /* 平民点用与 missionSetup 相同的规则采样，保证预览与实际一致 */
  const civs=[];
  const reg=mainRegion(built.grid);
  if(reg&&reg.mask){
    const cands=[];
    for(let ty=1;ty<GH-1;ty++) for(let tx=1;tx<GW-1;tx++){
      if(!reg.mask[idx(tx,ty)]) continue;
      if(tx<GW*0.22||tx>GW*0.78) continue;
      cands.push({x:cx_of(tx),y:cy_of(ty)});
    }
    const step=Math.max(1,Math.floor(cands.length/12));
    for(let i=0;i<cands.length&&civs.length<12;i+=step) civs.push(cands[i]);
  }
  drawMapPreview(cv, built.grid, {zone:zone, civs:civs, spawners:spawners});
  const info=$('#mapViewInfo');
  if(info){
    const a=auditMap(built.grid);
    info.innerHTML='<b style="color:#8fd0ff">'+MISSION_MAPS[k].name+'</b>　'+
      MISSION_MAPS[k].desc+'<br>咽喉点 '+a.stats.chokepoints+
      '　最长视线 '+a.stats.maxSight+' 格　掩体比 '+a.stats.coverRatio+
      '　<span style="color:#7dffa8">绿框=撤离区</span>　<span style="color:#c07aff">紫圈=僵尸入口</span>';
  }
}
let currentMissionMap=null;

$$('.pre').forEach(b=>b.addEventListener('click',()=>{
  const k=b.dataset.preset;
  const mem=SIZE_MAP[MSIZE]||(SIZE_MAP[MSIZE]={kind:'balanced',custom:null});
  mem.kind=k; mem.custom=null;
  editGrid=buildPreset(k);
  $$('.pre').forEach(x=>x.classList.toggle('on',x===b));
  drawEditor();
  /* 显示该地图的关卡特性，让玩家知道它的「性格」 */
  const a=auditMap(editGrid);
  const tr=$('#mapTraits');
  if(tr){
    const s=a.stats;
    tr.innerHTML='<b style="color:#8fd0ff">'+PRESETS[k].name+'</b>　咽喉点 '+s.chokepoints+
      '　最长视线 '+s.maxSight+' 格　掩体比 '+s.coverRatio;
  }
  setMsg('已载入「'+PRESETS[k].name+'」','ok');
}));
$('#btnClear').addEventListener('click',()=>{
  editGrid=newGrid(); gBorder(editGrid);
  const mem=SIZE_MAP[MSIZE]; if(mem) mem.custom=Uint8Array.from(editGrid);
  drawEditor(); setMsg('已清空（保留外墙）','ok');
});
$('#btnResetMap').addEventListener('click',resetMap);
$('#btnRandom').addEventListener('click',()=>{
  editGrid=buildRandomMap((Date.now()&0xffff)>>>0);
  const mem=SIZE_MAP[MSIZE]; if(mem) mem.custom=Uint8Array.from(editGrid);
  drawEditor(); const v=validateGrid(editGrid);
  setMsg('已生成随机对称地图'+(v.ok?'，可通行检查通过':'：'+v.reason), v.ok?'ok':'err');
});
$('#btnCarve').addEventListener('click',()=>{
  const r=carvePassage(); drawEditor();
  const v=validateGrid(editGrid);
  if(r.alreadyOpen){
    setMsg('第 '+(r.y+1)+' 行本来就是通的，无需打凿。地图已可通行'+(v.ok?'':'（'+v.reason+'）'), 'ok');
  } else {
    setMsg('已在第 '+(r.y+1)+' 行凿穿 '+r.carved+' 处障碍，现在可以开战了', v.ok?'ok':'err');
  }
});

/* ═══════════════════ 预算模式 UI ═══════════════════
   玩法：知道地图 + 敌军总规模，用预算组建队伍。
   玩家可以「用算法配一队」也可以手动加减，超预算会被拦。 */
let bgPreset='street';
let bgLineup={};
let bgMapKey='balanced';       // 与难度档独立的战场地图
let bgRandSeed=0;              // 选了「随机地图」时用的种子

function bgSpent(){
  let s=0;
  for(const k in bgLineup) s+=unitPrice(k)*(bgLineup[k]||0);
  return s;
}
function bgCount(){
  let n=0;
  for(const k in bgLineup) n+=bgLineup[k]||0;
  return n;
}
function bgMsg(t,cls){
  const el=$('#budgetMsg');
  if(el){ el.textContent=t; el.style.color=cls==='err'?'#ff9a8a':(cls==='ok'?'#7dffa8':'#9db1cc'); }
}
function renderBudgetPresets(){
  const box=$('#budgetPresets'); if(!box) return;
  box.innerHTML='';
  for(const key in BUDGET_PRESETS){
    const P=BUDGET_PRESETS[key];
    const b=document.createElement('button');
    b.className='btn bgp'+(key===bgPreset?' on':'');
    b.textContent=P.name;
    b.title=P.desc+'（难度 '+P.diff+'）';
    b.dataset.bgp=key;
    b.addEventListener('click',function(){
      bgPreset=key;
      /* ★ 换难度档**不再清空地图选择** —— 两者独立是本轮的设计目标。
         只有编成要重配（因为预算变了）。 */
      bgLineup={};
      renderBudget();
      bgMsg('已选择难度「'+P.name+'」：预算 '+P.budget+'，敌军 '+P.enemyCount+' 只 / '+P.waves+' 波','ok');
    });
    box.appendChild(b);
  }
}
/* 地图选择（与难度独立） */
function renderBudgetMaps(){
  const box=$('#budgetMaps'); if(!box) return;
  box.innerHTML='';
  for(const m of BUDGET_MAPS){
    const b=document.createElement('button');
    b.className='btn bgm'+(m.key===bgMapKey?' on':'');
    b.textContent=m.name;
    b.addEventListener('click',function(){
      bgMapKey=m.key;
      if(m.key==='random') bgRandSeed=(Date.now()&0xffffff)>>>0;
      renderBudget();
      bgMsg('战场地图：'+m.name,'ok');
    });
    box.appendChild(b);
  }
}
/* 取出当前选中的地图网格（不含副作用） */
function bgMapGrid(){
  if(bgMapKey==='random'){
    const s=bgRandSeed||((Date.now()&0xffffff)>>>0);
    return buildRandomMap(s);
  }
  const P=PRESETS[bgMapKey];
  return P?P.build(newGrid()):buildTacticalMap('balanced',11002);
}
function renderBudgetShop(){
  const box=$('#budgetShop'); if(!box) return;
  const P=BUDGET_PRESETS[bgPreset]; if(!P) return;
  box.innerHTML='';
  const spent=bgSpent();
  for(const k of P.pool){
    const d=CLASSES[k]; if(!d) continue;
    const price=unitPrice(k);
    const have=bgLineup[k]||0;
    const row=document.createElement('div');
    row.className='shopitem'+(spent+price>P.budget?' off':'');
    const nm=document.createElement('span'); nm.className='nm';
    nm.innerHTML='<b>'+d.name+'</b><i>'+roleStatLine(k)+'</i>';
    const pc=document.createElement('span'); pc.className='pc'; pc.textContent=price;
    const qt=document.createElement('span'); qt.className='qt'; qt.textContent=have;
    const plus=document.createElement('button'); plus.className='btn'; plus.textContent='＋';
    const minus=document.createElement('button'); minus.className='btn'; minus.textContent='－';
    plus.addEventListener('click',function(){
      if(bgSpent()+price>P.budget){ bgMsg('预算不够了（还差 '+(bgSpent()+price-P.budget)+'）','err'); return; }
      bgLineup[k]=(bgLineup[k]||0)+1;
      renderBudget();
    });
    minus.addEventListener('click',function(){
      if(!bgLineup[k]) return;
      bgLineup[k]--; if(!bgLineup[k]) delete bgLineup[k];
      renderBudget();
    });
    row.appendChild(nm); row.appendChild(pc); row.appendChild(qt);
    row.appendChild(minus); row.appendChild(plus);
    box.appendChild(row);
  }
}
/* 预算模式的地图浏览：让玩家在配队前看清战场结构。
   显示：地形 + 双方出生区（人类左 / 僵尸右）+ 咽喉点密度提示。 */
function renderBudgetMapView(){
  const cv=$('#budgetMapView'); if(!cv) return;
  const g=bgMapGrid();
  if(!g||g.length!==GW*GH) return;
  const gw=GW, gh=GH;
  const ctx2=cv.getContext('2d');
  const s=Math.max(1,Math.floor(Math.min(cv.width/gw, cv.height/gh)));
  const ox=Math.floor((cv.width-gw*s)/2), oy=Math.floor((cv.height-gh*s)/2);
  ctx2.clearRect(0,0,cv.width,cv.height);
  ctx2.fillStyle='#05080e'; ctx2.fillRect(0,0,cv.width,cv.height);
  for(let y=0;y<gh;y++) for(let x=0;x<gw;x++){
    const t=g[idx(x,y)];
    if(t===EMPTY) continue;
    ctx2.fillStyle = t===WALL?'#2f3d55' : (t===WIN?'#6fc8ff' : '#ffbe5c');
    ctx2.globalAlpha = t===WALL?1:0.85;
    ctx2.fillRect(ox+x*s, oy+y*s, s, s);
  }
  ctx2.globalAlpha=1;
  /* 出生区：人类在左、僵尸在右 */
  ctx2.fillStyle='rgba(125,255,168,0.16)';
  ctx2.fillRect(ox, oy, s*5, gh*s);
  ctx2.fillStyle='rgba(200,120,255,0.16)';
  ctx2.fillRect(ox+(gw-5)*s, oy, s*5, gh*s);
  ctx2.font='bold 11px system-ui'; ctx2.textAlign='left';
  ctx2.fillStyle='rgba(125,255,168,0.85)'; ctx2.fillText('我方', ox+6, oy+14);
  ctx2.textAlign='right';
  ctx2.fillStyle='rgba(200,120,255,0.85)'; ctx2.fillText('僵尸涌入', cv.width-6, oy+14);

  /* 信息行：把「要打的这张图什么性格」讲清楚 */
  const a=auditMap(g);
  const info=$('#budgetMapInfo');
  if(info){
    const sz=MAP_SIZES[MSIZE]?MAP_SIZES[MSIZE].name:'';
    const nm=(BUDGET_MAPS.filter(function(m){ return m.key===bgMapKey; })[0]||{}).name||bgMapKey;
    info.innerHTML='地图 <b style="color:#8fd0ff">'+nm+'</b>　'+sz+
      '　咽喉点 '+a.stats.chokepoints+'　最长视线 '+a.stats.maxSight+
      ' 格　掩体比 '+a.stats.coverRatio+
      '<br><span style="color:#6f84a1">难度与地图独立 —— 同一个难度换张图就是全新打法</span>';
  }
}

function renderBudget(){
  const P=BUDGET_PRESETS[bgPreset]; if(!P) return;
  const spent=bgSpent(), cnt=bgCount();
  if($('#bgBudget')) $('#bgBudget').textContent=P.budget;
  if($('#bgSpent'))  $('#bgSpent').textContent=spent;
  if($('#bgLeft'))   $('#bgLeft').textContent=Math.max(0,P.budget-spent);
  if($('#bgCount'))  $('#bgCount').textContent=cnt;
  renderBudgetPresets();
  renderBudgetMaps();
  renderBudgetShop();
  try{ renderBudgetMapView(); }catch(e){}
  /* 情报：只告诉规模 + 当前地图 */
  const intel=$('#budgetIntel');
  if(intel){
    const waves=buildBudgetWaves(bgPreset);
    const nm=(BUDGET_MAPS.filter(function(m){ return m.key===bgMapKey; })[0]||{}).name||bgMapKey;
    intel.innerHTML='敌军 <b style="color:#ff9a8a">'+P.enemyCount+'</b> 只，分 <b>'+waves.length+
      '</b> 波投放。地点：<b style="color:#8fd0ff">'+nm+
      '</b>。具体兵种未知 —— 打起来才知道。<br>'+
      waves.map(function(w,i){ return '第 '+(i+1)+' 波：约 '+w.count+' 只'; }).join('　');
  }
}
if($('#btnBudgetSuggest')) $('#btnBudgetSuggest').addEventListener('click',function(){
  const P=BUDGET_PRESETS[bgPreset]; if(!P) return;
  const r=buildBudgetLineup(P.budget,P.pool);
  bgLineup=r.lineup;
  renderBudget();
  bgMsg('算法配队完成：'+r.count+' 人，花费 '+r.spent+'/'+P.budget,'ok');
});
if($('#btnBudgetClear')) $('#btnBudgetClear').addEventListener('click',function(){
  bgLineup={}; renderBudget(); bgMsg('已清空，重新配队');
});
if($('#btnBudgetApply')) $('#btnBudgetApply').addEventListener('click',function(){
  const P=BUDGET_PRESETS[bgPreset]; if(!P) return;
  if(bgCount()===0){ bgMsg('先买点人再开局','err'); return; }
  const r=QB.applyBudget(bgPreset,{lineup:bgLineup, map:bgMapKey, seed:bgRandSeed});
  if(!r){ bgMsg('应用失败','err'); return; }
  const nm=(BUDGET_MAPS.filter(function(m){ return m.key===r.map; })[0]||{}).name||r.map;
  bgMsg('已确认开局：'+r.count+' 人 vs '+r.enemyCount+' 只（'+r.waveCount+' 波）· 地图「'+nm+'」','ok');
});


/* ═══════════════════ 地图保存 / 加载 ═══════════════════
   需求：「允许玩家保存地图」。

   设计：
     · 存储用 localStorage（单文件游戏不能依赖服务器）
     · 保存内容 = 尺寸 + 地形 + 出生点 + 刷怪点 + 名字 + 时间
     · 地形用 **RLE 压缩**再 base64：一张 72×40 的图裸存要 2880 字符，
       RLE 后通常压到几百字符，localStorage 的额度能放很多张
     · 支持**导出 / 导入 .json 文件** —— 地图能带走、也能分享给别人
       （localStorage 只存在本机浏览器里，换机器就没了）
     · 保存时做体检，有问题的图给出提示但仍允许保存（玩家自己决定） */

const MAP_STORE_KEY='dsb_saved_maps_v1';

/* 地形 RLE 编码：每段用 [类型(1字节), 长度(2字节)] */
function rleEncode(arr){
  const pairs=[];
  let cur=arr[0]|0, n=1;
  for(let i=1;i<arr.length;i++){
    const v=arr[i]|0;
    if(v===cur&&n<65535) n++;
    else { pairs.push(cur,n); cur=v; n=1; }
  }
  pairs.push(cur,n);
  const bytes=new Uint8Array(pairs.length/2*3);
  let p=0;
  for(let i=0;i<pairs.length;i+=2){
    bytes[p++]=pairs[i]&0xff;
    bytes[p++]=pairs[i+1]&0xff;
    bytes[p++]=(pairs[i+1]>>8)&0xff;
  }
  let s='';
  for(let i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]);
  try{ return 'b64:'+btoa(s); }catch(e){ return 'raw:'+s; }
}
function rleDecode(str, expectLen){
  let bin=str;
  if(str.indexOf('b64:')===0){ try{ bin=atob(str.slice(4)); }catch(e){ bin=str.slice(4); } }
  else if(str.indexOf('raw:')===0) bin=str.slice(4);
  const out=new Uint8Array(expectLen);
  let p=0;
  for(let i=0;i+2<bin.length+1&&p<expectLen;i+=3){
    const t=bin.charCodeAt(i)&0xff;
    const n=(bin.charCodeAt(i+1)&0xff)|((bin.charCodeAt(i+2)&0xff)<<8);
    for(let k=0;k<n&&p<expectLen;k++) out[p++]=t;
  }
  return out;
}
/* 存储层：优先用 localStorage；没有（无头测试 / 隐私模式 / file:// 受限）
   就用内存兜底 —— 这样保存功能在测试里也能跑，
   而且不会因为环境不支持就整个功能失效（只是关掉页面后不保留）。 */
const _memStore={};
function storeAvailable(){
  try{ return (typeof localStorage!=='undefined'&&localStorage); }catch(e){ return false; }
}
function storeGet(k){
  const ls=storeAvailable();
  if(ls){ try{ return ls.getItem(k); }catch(e){} }
  return (k in _memStore)?_memStore[k]:null;
}
function storeSet(k,v){
  const ls=storeAvailable();
  if(ls){ try{ ls.setItem(k,v); return true; }catch(e){} }
  _memStore[k]=v;
  return true;                              // 内存兜底算成功（本次会话内有效）
}
function loadMapStore(){
  try{
    const raw=storeGet(MAP_STORE_KEY);
    if(!raw) return {};
    const o=JSON.parse(raw);
    return (o&&typeof o==='object')?o:{};
  }catch(e){ return {}; }
}
function saveMapStore(store){
  return storeSet(MAP_STORE_KEY,JSON.stringify(store));
}
function setMapSaveMsg(t,cls){
  const el=$('#mapSaveMsg');
  if(el){ el.textContent=t; el.style.color=cls==='err'?'#ff9a8a':(cls==='ok'?'#7dffa8':'#9db1cc'); }
}
/* 保存当前编辑区为一张命名地图 */
function saveNamedMap(name){
  const store=loadMapStore();
  name=String(name||'').trim()||('地图'+(Object.keys(store).length+1));
  const mem=SIZE_MAP[MSIZE]||{};
  const rec={
    name:name, size:MSIZE, gw:GW, gh:GH,
    data:rleEncode(editGrid),
    spawns:(mem.customSpawns||[]).map(function(s){ return {team:s.team|0,x:s.x,y:s.y}; }),
    spawners:(mem.customSpawners||[]).map(function(s){ return {x:s.x,y:s.y,r:s.r||40,name:s.name||'洞口'}; }),
    at:Date.now(),
  };
  store[name]=rec;                       // 同名覆盖
  const ok=saveMapStore(store);
  renderSavedMaps();
  return {ok:ok, name:name, bytes:rec.data.length};
}
/* 把一条存档载入编辑区 */
function loadSavedMap(name){
  const store=loadMapStore();
  const rec=store[name];
  if(!rec) return {ok:false,reason:'找不到这张地图'};
  if(rec.size&&rec.size!==MSIZE&&MAP_SIZES[rec.size]) setMapSize(rec.size,true,true);
  const arr=rleDecode(rec.data,GW*GH);
  editGrid=arr;
  const mem=SIZE_MAP[MSIZE]||(SIZE_MAP[MSIZE]={kind:'balanced',custom:null});
  mem.custom=Uint8Array.from(arr);
  mem.customSpawns=(rec.spawns||[]).map(function(s){ return {team:s.team|0,x:s.x,y:s.y}; });
  mem.customSpawners=(rec.spawners||[]).map(function(s){ return {x:s.x,y:s.y,r:s.r||40,name:s.name||'洞口'}; });
  G.__mainRegion=null;
  drawEditor();
  return {ok:true,name:name,size:rec.size,
          spawns:mem.customSpawns.length,spawners:mem.customSpawners.length};
}
function deleteSavedMap(name){
  const store=loadMapStore();
  delete store[name];
  saveMapStore(store);
  renderSavedMaps();
}
function renderSavedMaps(){
  const box=$('#savedMapList'); if(!box) return;
  const store=loadMapStore();
  const keys=Object.keys(store);
  box.innerHTML='';
  if(!keys.length){ box.innerHTML='<div class="legend">还没有保存过地图</div>'; return; }
  keys.sort(function(a,b){ return (store[b].at||0)-(store[a].at||0); });
  for(const k of keys){
    const r=store[k];
    const row=document.createElement('div');
    row.className='smap';
    const d=new Date(r.at||0);
    const stamp=(d.getMonth()+1)+'/'+d.getDate()+' '+d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
    row.innerHTML='<span class="nm">'+k+'</span>'+
      '<span class="meta">'+r.gw+'×'+r.gh+' '+stamp+'</span>';
    const mk=function(label,fn){
      const b=document.createElement('button'); b.className='btn'; b.textContent=label;
      b.addEventListener('click',fn); return b;
    };
    row.appendChild(mk('载入',function(){
      const res=loadSavedMap(k);
      setMapSaveMsg(res.ok?('已载入「'+k+'」'):res.reason, res.ok?'ok':'err');
    }));
    row.appendChild(mk('导出',function(){ exportSavedMap(k); }));
    row.appendChild(mk('删除',function(){ deleteSavedMap(k); setMapSaveMsg('已删除「'+k+'」','ok'); }));
    box.appendChild(row);
  }
}
/* 导出为 .json 文件 */
function exportSavedMap(name){
  const store=loadMapStore();
  const rec=store[name]; if(!rec) return;
  const maps={}; maps[name]=rec;
  const payload=JSON.stringify({format:'dsb-map',version:1,maps:maps},null,1);
  try{
    const blob=new Blob([payload],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=name+'.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); },2000);
    setMapSaveMsg('已导出「'+name+'.json」','ok');
  }catch(e){ setMapSaveMsg('导出失败：'+e.message,'err'); }
}
/* ═══════════════ 玩家社群：地图分享码 ═══════════════
   目标：让玩家能把自制地图**贴到聊天/论坛里**互相传，不需要服务器。
   做法：把地图压成一个很短的字符串（分享码），复制粘贴即可。
   这是「玩家社群地图上传」的轻量实现 —— 官网那边只需要一个
   收集帖（论坛 / GitHub Issues / 群文档），玩家贴码即可。

   分享码格式：`FUS1-<size>-<b64地形>-<出生点>`，例如
     FUS1-m-<...>
   为了短，做了两件事：
     · 地形已经 RLE+base64（见 rleEncode）
     · 再用 URL-safe 字符替换，避免聊天工具吃掉 + / =
   另外把「和预设图完全相同」的地图标记出来，导入时提示，
   避免玩家把预置图当自己的作品到处发。 */

/* ═══════════ 紧凑编码（分享码专用）═══════════
   方块只有 4 种取值（0 空地 / 1 墙 / 2 窗 / 3 门），
   所以每个字节可以塞 **4 个格子**（2 bit × 4）。
   实测：40×22 = 880 格 → 220 字节 → base64 约 294 字符，
   而 RLE 在密集城市图上要 1000+ 字符（相邻格子频繁变化，游程都很短，
   RLE 反而膨胀）。所以分享码用紧凑编码，本地存档仍用 RLE。 */
function packTiles(arr){
  const n=arr.length;
  const bytes=new Uint8Array(Math.ceil(n/4));
  for(let i=0;i<n;i++) bytes[i>>2]|=(arr[i]&3)<<((i&3)*2);
  let s='';
  for(let i=0;i<bytes.length;i++) s+=String.fromCharCode(bytes[i]);
  try{ return 'p:'+btoa(s); }catch(e){ return 'pr:'+s; }
}
function unpackTiles(str, expectLen){
  let bin=str;
  if(str.indexOf('p:')===0){ try{ bin=atob(str.slice(2)); }catch(e){ return null; } }
  else if(str.indexOf('pr:')===0) bin=str.slice(3);
  else return null;
  /* 长度必须正好 —— 多一个字节少一个字节都说明码被改过/截断 */
  if(bin.length!==Math.ceil(expectLen/4)) return null;
  const out=new Uint8Array(expectLen);
  for(let i=0;i<expectLen;i++) out[i]=(bin.charCodeAt(i>>2)>>((i&3)*2))&3;
  return out;
}
/* 统一入口：解出地形（自动识别紧凑 / RLE） */
function decodeTerrain(dataStr, expectLen){
  if(/^(p:|pr:)/.test(dataStr)) return unpackTiles(dataStr, expectLen);
  return rleDecode(dataStr, expectLen);
}

const SHARE_PREFIX='FUS1';
const SIZE_CODE={ small:'s', medium:'m', large:'l', huge:'h' };
const CODE_SIZE={ s:'small', m:'medium', l:'large', h:'huge' };

/* ★ URL-safe 替换用的字符不能和「字段分隔符」撞车。
   旧版把 base64 的 '+' 换成 '-'，而分享码的字段分隔符**也是 '-'** ——
   于是 split('-') 会把 body 切碎，解析逻辑要靠猜来重组，
   而「在末尾接一段垃圾」正好能被当成合法的 body 续接，**污染检测失效**。
   现在改用 '~'（URL-safe 且不会出现在 base64 / 数字坐标里）。 */
function toUrlSafe(b64){
  return b64.replace(/\+/g,'~').replace(/\//g,'_').replace(/=+$/,'');
}
function fromUrlSafe(s){
  let t=s.replace(/~/g,'+').replace(/_/g,'/');
  while(t.length%4) t+='=';
  return t;
}
/* 生成分享码。用紧凑编码（每字节 4 格）而不是 RLE —— 见 packTiles 注释。 */
function makeShareCode(name){
  const store=loadMapStore();
  const rec=store[name]; if(!rec) return null;
  const sz=SIZE_CODE[rec.size]||'m';
  const need={small:28*16, medium:40*22, large:56*30, huge:72*40}[rec.size];
  const arr=rleDecode(rec.data, need);
  const packed=packTiles(arr);
  /* base64 里的 + / = 会被某些聊天工具吃掉 → 换成 URL-safe */
  const body=toUrlSafe(packed.slice(packed.indexOf(':')+1));
  const sp=(rec.spawns||[]).map(function(s){ return (s.team|0)+'.'+Math.round(s.x)+'.'+Math.round(s.y); }).join(',');
  const sc=(rec.spawners||[]).map(function(s){ return Math.round(s.x)+'.'+Math.round(s.y); }).join(',');
  let code=SHARE_PREFIX+'-'+sz+'-'+body;
  if(sp) code+='-t'+sp;
  if(sc) code+='-z'+sc;
  return code;
}
/* 解析分享码 → 一条地图记录 */
function parseShareCode(code){
  code=String(code||'').trim();
  if(!code) throw new Error('分享码是空的');
  /* 去掉可能的空白/换行（聊天工具常插换行） */
  code=code.replace(/\s+/g,'');
  const parts=code.split('-');
  if(parts[0]!==SHARE_PREFIX) throw new Error('不是本作的分享码（应以 '+SHARE_PREFIX+' 开头）');
  const size=CODE_SIZE[parts[1]];
  if(!size) throw new Error('无法识别的尺寸标记：'+parts[1]);
  /* ★ 现在的编码保证 body 里**不含 '-'**（base64 的 + 换成了 ~），
     所以段结构是干净的：FUS1 - 尺寸 - 地形 - [t出生点] - [z刷怪点]。
     任何多出来的段都是被污染了，直接拒绝 —— 不再靠「拼到 t/z 为止」猜。 */
  const body=parts[2];
  if(!body) throw new Error('分享码里没有地形数据');
  const rest=parts.slice(3);
  if(rest.length>2) throw new Error('分享码含有无法识别的多余数据段（可能被改动过）');

  const need={small:28*16, medium:40*22, large:56*30, huge:72*40}[size];
  /* ★ 用紧凑解码；长度不符会被 unpackTiles 判为 null → 明确报「被截断」。
     这里额外检查「base64 字符数」是否正好等于理论值 ——
     否则有人在地图码后面接一段垃圾也能通过（unpackTiles 只看前 N 字节）。 */
  const wantChars=Math.ceil(Math.ceil(need/4)*4/3);   // 220 字节 → 296 字符（含 padding 前）
  const safeBody=fromUrlSafe(body);
  /* base64 长度必须是 4 的倍数（还原 padding 后） */
  if(safeBody.length%4!==0) throw new Error('分享码长度异常，可能被截断或掺入了多余字符');
  const rawLen=safeBody.length/4*3;
  const padCount=(safeBody.match(/=+$/)||[''])[0].length;
  const byteLen=rawLen-padCount;
  if(byteLen!==Math.ceil(need/4)) throw new Error('分享码长度不符（'+byteLen+' ≠ '+Math.ceil(need/4)+' 字节），已损坏或被截断');
  let arr=null;
  try{ arr=unpackTiles('p:'+safeBody, need); }catch(e){ arr=null; }
  if(!arr) throw new Error('分享码不完整或已损坏，可能被聊天工具截断了');

  const rec={ name:'导入的地图', size:size, data:rleEncode(arr), spawns:[], spawners:[], at:Date.now() };
  /* ★ 坐标必须**严格**解析。
     踩过的坑：`parseFloat('144AAAA')` 会返回 144（自动忽略尾部垃圾），
     于是「在地图码末尾接一段字符」能骗过校验、静默导入一张半损坏的图。
     这里用 /^\d+(\.\d+)?$/ 先做格式校验，再转数字。 */
  const num=function(s,what){
    if(!/^\d+(\.\d+)?$/.test(s)) throw new Error('分享码的'+what+'数据已损坏');
    const v=parseFloat(s);
    if(!isFinite(v)) throw new Error('分享码的'+what+'数据已损坏');
    return v;
  };
  for(const seg of rest){
    if(seg[0]==='t'&&seg.length>1){
      for(const p of seg.slice(1).split(',')){
        const a=p.split('.');
        if(a.length!==3) throw new Error('分享码的出生点数据已损坏');
        if(!/^\d+$/.test(a[0])) throw new Error('分享码的出生点数据已损坏');
        const t=parseInt(a[0],10), x=num(a[1],'出生点'), y=num(a[2],'出生点');
        if(x<0||y<0||x>VW||y>VH) throw new Error('分享码的出生点超出地图范围');
        rec.spawns.push({team:t,x:x,y:y});
      }
    } else if(seg[0]==='z'&&seg.length>1){
      for(const p of seg.slice(1).split(',')){
        const a=p.split('.');
        if(a.length!==2) throw new Error('分享码的刷怪点数据已损坏');
        const x=num(a[0],'刷怪点'), y=num(a[1],'刷怪点');
        if(x<0||y<0||x>VW||y>VH) throw new Error('分享码的刷怪点超出地图范围');
        rec.spawners.push({x:x,y:y,r:40,name:'洞口'});
      }
    } else if(seg.length){
      throw new Error('分享码含有无法识别的数据段（可能被聊天工具改动过）');
    }
  }
  return rec;
}
/* 导入分享码并保存 */
function importShareCode(code, name){
  const rec=parseShareCode(code);
  rec.name=String(name||'').trim()||('导入地图 '+new Date().toLocaleString());
  const store=loadMapStore();
  store[rec.name]=rec;
  saveMapStore(store);
  renderSavedMaps();
  return {ok:true, name:rec.name, size:rec.size,
          spawns:rec.spawns.length, spawners:rec.spawners.length};
}

function importMapText(text){
  const o=JSON.parse(String(text));
  if(!o||o.format!=='dsb-map'||!o.maps) throw new Error('不是本作的地图文件');
  const store=loadMapStore();
  let n=0;
  for(const k in o.maps){
    const rec=o.maps[k];
    if(!rec||!rec.data) continue;
    store[k]=rec; n++;
  }
  saveMapStore(store);
  renderSavedMaps();
  return n;
}

/* ---- 按钮绑定 ---- */
if($('#btnMapSave')) $('#btnMapSave').addEventListener('click',function(){
  const inp=$('#mapSaveName');
  const nm=inp?inp.value:'';
  const a=auditMap(editGrid);
  const res=saveCurrentMap(nm);
  if(!res.ok){ setMapSaveMsg('保存失败（浏览器不允许本地存储？）','err'); return; }
  setMapSaveMsg('已保存「'+res.name+'」'+(a.ok?'':'（注意：'+a.issues[0]+'）'), a.ok?'ok':'err');
  if(inp) inp.value='';
});
if($('#btnMapExport')) $('#btnMapExport').addEventListener('click',function(){
  const inp=$('#mapSaveName');
  const nm=(inp&&inp.value.trim())?inp.value.trim():('地图'+(Object.keys(loadMapStore()).length+1));
  /* 导出前先保存一次，保证导出的是当前编辑内容 */
  const r=saveCurrentMap(nm);
  if(r.ok) exportSavedMap(r.name);
  else setMapSaveMsg('导出失败','err');
});
if($('#btnMapImport')) $('#btnMapImport').addEventListener('click',function(){
  const f=$('#mapFileIn'); if(f) f.click();
});

/* ---- 分享码按钮（玩家社群互传地图的主要方式）---- */
if($('#btnMapShare')) $('#btnMapShare').addEventListener('click',function(){
  /* 生成「当前编辑区」的分享码：先临时存一份再编码，避免要求玩家先保存 */
  const inp=$('#mapSaveName');
  const nm=(inp&&inp.value.trim())?inp.value.trim():('临时'+(Date.now()&0xffff));
  const r=saveNamedMap(nm);
  if(!r||!r.ok){ setMapSaveMsg('生成失败（无法写入本地存储）','err'); return; }
  let code=null;
  try{ code=makeShareCode(r.name); }catch(e){ code=null; }
  const out=$('#mapCodeOut');
  if(out&&code){ out.value=code; }
  /* 临时存档用完就删，保持「我的地图」列表干净 */
  if(nm.indexOf('临时')===0) deleteSavedMap(r.name);
  renderSavedMaps();
  if(code) setMapSaveMsg('分享码已生成（'+code.length+' 字符），点「复制」发给别人','ok');
  else setMapSaveMsg('生成失败','err');
});
if($('#btnMapCodeCopy')) $('#btnMapCodeCopy').addEventListener('click',function(){
  const out=$('#mapCodeOut');
  if(!out||!out.value){ setMapSaveMsg('还没有分享码','err'); return; }
  try{
    out.select();
    if(typeof navigator!=='undefined'&&navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(out.value);
    } else if(document.execCommand){
      document.execCommand('copy');
    }
    setMapSaveMsg('已复制到剪贴板','ok');
  }catch(e){ setMapSaveMsg('复制失败，请手动选中复制','err'); }
});
if($('#btnMapCodeIn')) $('#btnMapCodeIn').addEventListener('click',function(){
  const inp=$('#mapCodeIn');
  const code=inp?inp.value:'';
  if(!code.trim()){ setMapSaveMsg('先粘贴分享码','err'); return; }
  try{
    const r=importShareCode(code);
    setMapSaveMsg('已导入「'+r.name+'」（'+r.size+'，出生点 '+r.spawns+' / 洞口 '+r.spawners+'）','ok');
    if(inp) inp.value='';
  }catch(e){ setMapSaveMsg('导入失败：'+e.message,'err'); }
});
if($('#mapFileIn')) $('#mapFileIn').addEventListener('change',function(e){
  const file=e.target.files&&e.target.files[0];
  if(!file) return;
  const rd=new FileReader();
  rd.onload=function(){
    try{ const n=importMapText(rd.result); setMapSaveMsg('已导入 '+n+' 张地图','ok'); }
    catch(err){ setMapSaveMsg('导入失败：'+err.message,'err'); }
  };
  rd.onerror=function(){ setMapSaveMsg('读取文件失败','err'); };
  rd.readAsText(file);
  e.target.value='';                      // 允许重复导入同一个文件
});
renderSavedMaps();

/* ═══════════ 关于页：填充官网 / 源码链接 ═══════════
   地址写在 _brand.js，构建时替换进占位符。
   ★ 空字符串时**隐藏**对应入口 —— 免得官网上线前显示一个死链接。 */
(function(){
  const site='__GAME_SITE__';
  const repo='__GAME_REPO__';
  const sw=$('#aboutSiteWrap'), sl=$('#aboutSite');
  if(sw&&sl){
    if(site&&site.indexOf('__')!==0){ sl.href=site; sl.textContent=site.replace(/^https?:\/\//,''); }
    else { sw.style.display='none'; }
  }
  const rw=$('#aboutRepoWrap'), rl=$('#aboutRepo');
  if(rw&&rl){
    if(repo&&repo.indexOf('__')!==0){ rl.href=repo; rl.textContent=repo.replace(/^https?:\/\//,''); }
    else { rw.style.display='none'; }
  }

  /* 反馈邮箱：复制按钮（玩家可能不方便点 mailto，直接复制更省事） */
  const MAIL='__GAME_CONTACT__';
  const bcm=$('#btnCopyMail');
  if(bcm){
    bcm.addEventListener('click',function(){
      const msg=$('#feedbackMsg');
      try{
        if(typeof navigator!=='undefined'&&navigator.clipboard&&navigator.clipboard.writeText){
          navigator.clipboard.writeText(MAIL);
        } else {
          const ta=document.createElement('textarea');
          ta.value=MAIL; document.body.appendChild(ta); ta.select();
          if(document.execCommand) document.execCommand('copy');
          document.body.removeChild(ta);
        }
        if(msg) msg.textContent='已复制';
      }catch(e){ if(msg) msg.textContent='复制失败，请手动选中'; }
      setTimeout(function(){ if(msg) msg.textContent=''; },1800);
    });
  }
})();


/* ★ 用「当前编辑的地图」做撤离任务（支持自定义地图）。
   旧版撤离模式只能用四张内置任务图，玩家自己在「地图」页画的图
   一勾撤离就被换掉 —— 这是「撤离模式和正式游戏冲突」的另一半。
   现在：直接把 editGrid 当任务地图，撤离区自动放到远离僵尸入场的一侧。 */
if($('#btnMissionUseEdit')) $('#btnMissionUseEdit').addEventListener('click',()=>{
  const v=validateGrid(editGrid);
  if(!v.ok){ missionMsg('当前地图不可用：'+v.reason,'err'); return; }
  /* 撤离区：放在地图左侧（人类进场侧），并校正到可通行格 */
  const reg=mainRegion(editGrid);
  let zone=null, bestD=1e9;
  for(let ty=2;ty<GH-2;ty++) for(let tx=2;tx<6;tx++){
    if(!reg.mask||!reg.mask[idx(tx,ty)]) continue;
    const d=Math.abs(ty-GH/2);
    if(d<bestD){ bestD=d; zone={x:cx_of(tx),y:cy_of(ty)}; }
  }
  zone=zone||{x:TILE*3,y:VH/2};
  G.missionZone=zone;
  G.missionArea=null;                    // 自定义地图不做区域限制
  G.__mainRegion=null;
  refreshMissionMapView(null);           // 预览也画当前地图
  $$('.mis').forEach(x=>x.classList.remove('on'));
  missionMsg('已把当前编辑的地图用作撤离任务图（撤离区在左侧）','ok');
  const cb=$('#chkMission'); if(cb&&!cb.checked) cb.checked=true;
});
/* 重设撤离区：进入「点地图选点」模式很复杂，这里直接放到地图左侧中段 */
if($('#btnMissionPickZone')) $('#btnMissionPickZone').addEventListener('click',()=>{
  const reg=mainRegion(editGrid);
  let zone=null, bestD=1e9;
  for(let ty=2;ty<GH-2;ty++) for(let tx=2;tx<6;tx++){
    if(!reg.mask||!reg.mask[idx(tx,ty)]) continue;
    const d=Math.abs(ty-GH/2);
    if(d<bestD){ bestD=d; zone={x:cx_of(tx),y:cy_of(ty)}; }
  }
  if(zone){ G.missionZone=zone; missionMsg('撤离区已重设到地图左侧中部','ok'); }
  else missionMsg('找不到合适的撤离区位置','err');
});

/* ★ 撤离模式的「救援队阵容」快捷预设。
   用户要求「撤离模式也允许自定义人类队伍」：
   这三个按钮只是**快捷模板**，点完仍然可以到「队伍与阵容」页继续细调；
   队伍配置本身是共用的，撤离模式不会覆盖它。 */
function missionLoadout(preset){
  const P={
    rescue:{name:'救援队', lineup:{rifle:6,shotgun:2,medic:2,shieldman:3,sniper:1,mg:1}},
    heavy: {name:'重装强攻', lineup:{rifle:10,shotgun:4,medic:3,shieldman:5,sniper:2,mg:4,rocketeer:2}},
    sneak: {name:'轻装快反', lineup:{rifle:5,shotgun:2,medic:2,sniper:3,shieldman:1}},
  }[preset];
  if(!P) return;
  /* 找人类队；没有就建一支 */
  let hi=teams.findIndex(t=>t.type==='h');
  if(hi<0){
    rebuildTeams([
      {name:P.name, type:'h', lineup:Object.assign({},P.lineup)},
      {name:'感染者', type:'z', lineup:{zombie:10,mother:1,runner:2}},
    ]);
  } else {
    teams[hi].name=P.name;
    teams[hi].type='h';
    teams[hi].lineup=Object.assign({},P.lineup);
    /* 确保有僵尸队，否则撤离模式开不了局 */
    if(!teams.some(t=>t.type==='z'||t.type==='mix')){
      rebuildTeams([teams[hi], {name:'感染者', type:'z', lineup:{zombie:10,mother:1,runner:2}}]);
    }
  }
  try{ renderRoster(); renderPreview(); renderGuide(); }catch(e){}
  const n=Object.keys(P.lineup).reduce((s,k)=>s+P.lineup[k],0);
  const el=$('#missionLoadoutMsg');
  if(el) el.textContent='已套用「'+P.name+'」共 '+n+' 人（可在「① 队伍与阵容」继续调整）';
  missionMsg('救援队已设为「'+P.name+'」('+n+' 人)','ok');
}
if($('#btnMissionLoadout')) $('#btnMissionLoadout').addEventListener('click',()=>missionLoadout('rescue'));
if($('#btnMissionHeavy'))    $('#btnMissionHeavy').addEventListener('click',()=>missionLoadout('heavy'));
if($('#btnMissionSneak'))    $('#btnMissionSneak').addEventListener('click',()=>missionLoadout('sneak'));

function missionMsg(t,cls){  const el=$('#missionMsg'); if(el){ el.textContent=t; el.style.color=cls==='err'?'#ff9a8a':(cls==='ok'?'#7dffa8':'#9db1cc'); }
}
/* 按下撤离专用地图：重建地图 + 采用该地图自带的撤离区位置 */
$$('.mis').forEach(b=>b.addEventListener('click',()=>{
  const kind=b.dataset.mission;
  if(!MISSION_MAPS[kind]) return;
  const built=buildMissionMap(kind);
  editGrid=built.grid;
  const mem=SIZE_MAP[MSIZE]; if(mem) mem.custom=Uint8Array.from(editGrid);
  /* ★ 撤离区由地图自己给出（不再是硬编码的右侧）。
     之前写死 VW-TILE*3，在「孤岛待援」里会落到岛的墙外 —— 平民永远走不进去。 */
  G.missionZone=built.zone;
  G.missionArea=built.civArea||null;
  G.__mainRegion=null;                       // 地图变了，连通性缓存失效
  drawEditor(); renderPreview();
  $$('.mis').forEach(x=>x.classList.toggle('on',x===b));
  refreshMissionMapView(kind);              // 同步刷新地图浏览
  const v=validateGrid(editGrid);
  missionMsg('已载入「'+MISSION_MAPS[kind].name+'」'+
    (v.ok?'':'（注意：'+v.reason+'）'), v.ok?'ok':'err');
  const cb=$('#chkMission'); if(cb&&!cb.checked){ cb.checked=true; }
}));
$('#chkMission').addEventListener('change',e=>{
  if(!e.target.checked){ QB.mission(false); missionMsg('已关闭撤离模式'); return; }
  /* ★ 撤离模式下玩家只指挥**人类的救援队**，僵尸由系统作为敌人投放。
     所以勾选时就强制把阵容调整成「1 支人类队伍 + 1 支僵尸队伍」，
     并把人类那队设成默认的救援编制。 */
  applyMissionLineup();
  if(G.phase==='battle'){
    const n=clamp(parseInt($('#civCount').value,10)||8,1,60);
    const r=QB.mission(true,{civilians:n,zone:G.missionZone});
    missionMsg('已在当前对局中投放 '+r.total+' 名平民，撤离区在地图左侧集结区','ok');
  } else {
    missionMsg('撤离模式已勾选：你指挥人类救援队，平民撤离到左侧集结区','ok');
  }
});
/* 把阵容改成撤离模式的标准配置：**人类救援队 vs 感染者**。
   撤离模式下玩家只指挥救援队，所以直接锁定成两支队伍并套用救援编制。 */
/* 撤离模式的队伍准备。
   ★ 重要改动（用户反馈「撤离模式和正式游戏存在冲突」）：
     旧版无条件 rebuildTeams()，把玩家在「队伍与阵容」里辛苦配好的
     队伍全部**推翻重来** —— 你配好 30 人的重装队，一勾撤离就变回
     默认的 15 人救援队；取消勾选后也回不去。这就是最明显的冲突。

     现在改成「**在玩家的队伍上做适配**」：
       ① 队伍里若已经有 1 支人类队 + 1 支僵尸队 → 原样保留，什么都不动，
          玩家想用多少盾卫、多少狙击都随他
       ② 队伍不成形（只有 1 队 / 都是人类 / 都是僵尸）→ 才补默认编制
       ③ 玩家可以在「撤离模式」面板里自由编辑人类队伍阵容
     这样撤离模式与正式游戏共用同一套队伍配置，互不覆盖。 */
function applyMissionLineup(force){
  const RESCUE={rifle:6,shotgun:2,medic:2,shieldman:3,sniper:1,mg:1};
  const ZOMBIE={zombie:10,mother:1,runner:2};
  const humans=teams.filter(t=>t.type==='h');
  const zombs =teams.filter(t=>t.type==='z'||t.type==='mix');
  const ok = humans.length>=1 && zombs.length>=1 && teams.length>=2;
  if(ok&&!force){
    /* 玩家的配置已经可用 → 原样保留 */
    try{ renderRoster(); renderPreview(); renderGuide(); }catch(err){}
    missionMsg('沿用当前队伍配置（'+humans.length+' 支人类 + '+zombs.length+' 支僵尸）','ok');
    return;
  }
  rebuildTeams([
    {name:'救援队', type:'h', lineup:Object.assign({},RESCUE)},
    {name:'感染者', type:'z', lineup:Object.assign({},ZOMBIE)},
  ]);
  teams[0].type='h'; teams[1].type='z';
  try{ renderRoster(); renderPreview(); renderGuide(); }catch(err){}
  missionMsg('已套用默认撤离编制：你是「救援队」，对面是「感染者」','ok');
}
$('#btnSpawnOn').addEventListener('click',()=>{
  QB.spawners(true);
  missionMsg('已开启 4 个刷怪点（地图四角紫色洞口）','ok');
  G.baseDirty=true;
});
$('#btnSpawnOff').addEventListener('click',()=>{
  QB.spawners(false); missionMsg('已关闭刷怪点'); G.baseDirty=true;
});
/* 按人类实力自动放一波僵尸（数量 + 质量都跟着人类走） */
let waveDiff=1.0;
if($('#waveDiff')) $('#waveDiff').addEventListener('input',e=>{
  waveDiff=(parseInt(e.target.value,10)||100)/100;
  if($('#waveDiffShow')) $('#waveDiffShow').textContent=waveDiff.toFixed(1)+'×';
});
if($('#btnAutoWave')) $('#btnAutoWave').addEventListener('click',()=>{
  if(G.phase!=='battle'){ missionMsg('先开始对战才能放怪','err'); return; }
  const w=QB.autoWave({difficulty:waveDiff});
  const parts=Object.keys(w.breakdown).filter(k=>w.breakdown[k]>0)
    .map(k=>(CLASSES[k]?CLASSES[k].name:k)+'×'+w.breakdown[k]).join('　');
  const txt='人类战力 '+w.power+'（'+w.humans+' 人）→ 僵尸 '+w.count+' 只：'+parts;
  missionMsg(txt,'ok');
  const el=$('#autoWaveMsg'); if(el) el.textContent=txt;
  G.baseDirty=true;
});
/* 地图体检：把 auditMap 的结果显示出来（含会卡住角色的检查） */
$('#btnAudit').addEventListener('click',()=>{
  const a=auditMap(editGrid);
  const el=$('#mapAuditMsg');
  const s=a.stats;
  el.innerHTML=(a.ok?'<b style="color:#7dffa8">体检通过</b>':'<b style="color:#ff9a8a">发现问题</b>')+
    '　不对称格 '+s.asymmetry+'　中段掩体 '+s.midBlocks+
    '　出生可站 '+s.spawnFree+'　门 '+s.door+'　窗 '+s.win+
    (a.issues.length?'<br>· '+a.issues.join('<br>· '):'');
  el.style.color='#9db1cc';
});

/* ---------------- 地图尺寸（小 / 中 / 大） ---------------- */
function syncStage(){
  const R=(VW/VH).toFixed(4);
  const st=$('#stage');
  st.style.width=document.body.classList.contains('pfull')
    ? ('min(100vw, calc(100vh * '+R+'))')
    : ('min(100%, calc((100vh - 150px) * '+R+'))');
}
function setMapSize(key,silent,force){
  const s=MAP_SIZES[key]; if(!s) return false;
  if(!force&&G.phase==='battle'&&!G.paused&&G.units.length){
    setMsg('战斗中不能改地图尺寸，请先按 E 回到配置','err'); return false;
  }
  saveCurrentMap();
  MSIZE=key; GW=s.gw; GH=s.gh; VW=GW*TILE; VH=GH*TILE;
  const mem=SIZE_MAP[key]||(SIZE_MAP[key]={kind:'plaza',custom:null});
  editGrid = mem.custom ? Uint8Array.from(mem.custom) : buildPreset(mem.kind);
  G.map=new Uint8Array(GW*GH); G.doorHP=new Float32Array(GW*GH);
  for(let i=0;i<G.map.length;i++){ G.doorHP[i]=G.map[i]===DOOR?DOOR_MAX:0; G.winHP[i]=G.map[i]===WIN?WIN_MAX:0; }
  G.map.set(editGrid);
  cvs.width=VW; cvs.height=VH;
  base.width=VW; base.height=VH;
  ED_S=ed.width/GW; ed.height=Math.round(GH*ED_S);
  G.baseDirty=true;
  $$('.msz').forEach(b=>b.classList.toggle('on',b.dataset.msize===key));
  syncStage(); drawEditor(); bakeMap(); render();
  if(!silent) setMsg('已切换为'+s.name+'（'+GW+'×'+GH+'）','ok');
  return true;
}
/* 记住当前尺寸下玩家改过的地图，切尺寸时不会丢 */
function saveCurrentMap(){
  const mem=SIZE_MAP[MSIZE];
  if(!mem||editGrid.length!==GW*GH) return;
  const ref=buildPreset(mem.kind);
  let same=ref.length===editGrid.length;
  if(same) for(let i=0;i<ref.length;i++) if(ref[i]!==editGrid[i]){ same=false; break; }
  mem.custom = same ? null : Uint8Array.from(editGrid);
}
/* 重置本尺寸地图：按当前尺寸用全新的行为友好布局重建 */
function resetMap(){
  const mem=SIZE_MAP[MSIZE]||(SIZE_MAP[MSIZE]={kind:'plaza',custom:null});
  mem.custom=null;
  editGrid=buildPreset(mem.kind);
  drawEditor();
  const v=validateGrid(editGrid);
  setMsg('已按「'+MAP_SIZES[MSIZE].name+'」重建「'+PRESETS[mem.kind].name+'」'+
         (v.ok?'，可直接开战':'：'+v.reason), v.ok?'ok':'err');
}
$$('.msz').forEach(b=>b.addEventListener('click',()=>setMapSize(b.dataset.msize)));

/* ---------------- 点击指挥开关（防误触） ---------------- */
function setCmdOn(v){
  G.cmdOn=!!v;
  const b=$('#btnLock');
  b.textContent='点击指挥：'+(G.cmdOn?'开':'关');
  b.classList.toggle('on',G.cmdOn);
}
$('#btnLock').addEventListener('click',()=>setCmdOn(!G.cmdOn));

/* ---------------- 全屏：自建伪全屏优先，浏览器原生全屏只是加成 ----------------
   无论浏览器是否允许原生全屏，伪全屏都会生效，因此全屏下不会被原生行为打断 */
function isPseudoFull(){ return document.body.classList.contains('pfull'); }
function isNativeFull(){ return !!(document.fullscreenElement||document.webkitFullscreenElement); }
function isFull(){ return isPseudoFull()||isNativeFull(); }
function enterFull(){
  if(isPseudoFull()&&isNativeFull()) return;
  document.body.classList.add('pfull');
  syncStage();
  if(!isNativeFull()){
    const el=document.documentElement;
    const fn=el.requestFullscreen||el.webkitRequestFullscreen||el.msRequestFullscreen;
    if(fn){ try{ const p=fn.call(el); if(p&&p.catch) p.catch(()=>{}); }catch(e){} }
  }
  /* 全屏后画布尺寸会变，重新量一次 */
  setTimeout(()=>{ syncStage(); bakeMap(); render(); }, 120);
}
function exitFull(){
  document.body.classList.remove('pfull');
  if(isNativeFull()){
    const fn=document.exitFullscreen||document.webkitExitFullscreen||document.msExitFullscreen;
    if(fn){ try{ const p=fn.call(document); if(p&&p.catch) p.catch(()=>{}); }catch(e){} }
  }
  syncStage(); bakeMap(); render(); drawEditor();
}
function toggleFull(){ isFull()?exitFull():enterFull(); }
/* 浏览器自己改全屏状态（Esc / 手势 / 系统通知）时同步画布尺寸 */
['fullscreenchange','webkitfullscreenchange','msfullscreenchange'].forEach(ev=>
  document.addEventListener(ev,()=>{ syncStage(); bakeMap(); render(); }));
$('#btnFull').addEventListener('click',toggleFull);
$('#btnExitFull').addEventListener('click',toggleFull);
$$('.beh').forEach(b=>b.addEventListener('click',()=>setGlobalBehavior(b.dataset.beh)));
$$('.behq').forEach(b=>b.addEventListener('click',()=>applyBehavior(b.dataset.beh)));
$('#btnAddTeam').addEventListener('click',addTeam);
$('#chkReload').addEventListener('change',e=>{
  G.reloadOn=!!e.target.checked;
  if(G.reloadOn){ for(const u of G.units){ u.magLeft=CLASSES[u.cls].mag||0; u.reloadT=0; } }
  setMsg(G.reloadOn?'已开启换弹时间：弹匣打空后需换弹，换弹期间停火':'已关闭换弹时间：弹匣无限','ok');
});
/* ---------------- 背景音乐 UI ---------------- */
function musicMsg(t,cls){
  const el=$('#musicMsg'); if(!el) return;
  el.textContent=t;
  el.style.color=cls==='err'?'#ff9a8a':(cls==='ok'?'#7dffa8':'#9db1cc');
}
$('#chkMusic').addEventListener('change',e=>{
  if(e.target.checked){ playMusic(musicTrack); musicMsg('背景音乐已开启','ok'); }
  else { stopMusic(); musicOn=false; musicMsg('背景音乐已关闭'); }
});
$$('.msc').forEach(b=>b.addEventListener('click',()=>{
  const t=b.dataset.music;
  $$('.msc').forEach(x=>x.classList.toggle('on',x===b));
  if(!playMusic(t)){ musicMsg('音频还没准备好，开始对战后会自动播放'); return; }
  const nm={music_calm:'氛围',music_tense:'紧张',music_wind:'荒凉'}[t]||t;
  musicMsg('已切换背景音乐：'+nm,'ok');
  const cb=$('#chkMusic'); if(cb&&cb.checked!==true) cb.checked=true;
}));
$('#musicVol').addEventListener('input',e=>{
  setMusicVolume((Number(e.target.value)||0)/100);
});
$('#musicFile').addEventListener('change',e=>{
  const f=e.target.files&&e.target.files[0];
  if(!f) return;
  musicMsg('正在读取「'+f.name+'」…');
  loadCustomMusic(f,function(ok,err){
    if(ok){
      $$('.msc').forEach(x=>x.classList.remove('on'));
      musicMsg('已启用自定义音乐：'+f.name+'（本机播放，不会上传）','ok');
      const cb=$('#chkMusic'); if(cb&&cb.checked!==true) cb.checked=true;
    } else {
      musicMsg('自定义音乐加载失败：'+(err||'未知错误'),'err');
    }
  });
});
$('#chkSfx').addEventListener('change',e=>{
  setSfxEnabled(!!e.target.checked);
  if(sfxEnabled) sfx('click');
  setMsg(sfxEnabled?'已开启动作音效（开火 / 盾击 / 爆炸 / 换弹等）':'已关闭动作音效','ok');
});
$('#chkWave').addEventListener('change',e=>{
  waveOn=!!e.target.checked;
  if(waveOn){
    let any=false;
    for(const w of waves) for(const k in w.lineup) if(w.lineup[k]) any=true;
    if(!any){ defaultWaves(); }
  }
  renderWaves(); renderPreview(); renderGuide();
  setMsg(waveOn?'已开启僵尸轮次：僵尸按波次投放':'已关闭僵尸轮次：僵尸队伍按阵容编制出场','ok');
});
$('#btnWaveAdd').addEventListener('click',()=>{
  waves.push({lineup:{zombie:6,mother:1},gap:25});
  renderWaves(); renderPreview();
});
$('#btnWaveReset').addEventListener('click',()=>{
  defaultWaves(); renderWaves(); renderPreview(); setMsg('已恢复默认波次','ok');
});
$('#pane-waves').addEventListener('input',e=>{
  const el=e.target, i=el.dataset.wave;
  if(i===undefined) return;
  if(el.dataset.wgap){
    waves[i].gap=clamp(parseInt(el.value,10)||0,3,180); return;
  }
  if(el.dataset.wrole!==undefined){
    waves[i].lineup[el.dataset.wrole]=clamp(Math.floor(Number(el.value)||0),0,999);
    renderWaves();
  }
});
$('#pane-waves').addEventListener('click',e=>{
  const b=e.target.closest('button[data-wdel]');
  if(!b) return;
  if(waves.length<=1) return;
  waves.splice(parseInt(b.dataset.wdel,10),1);
  renderWaves(); renderPreview();
});

/* 阵容面板内的点击 / 输入 */
$('#setup').addEventListener('click',e=>{
  const del=e.target.closest('button[data-tdel]');
  if(del){ removeTeam(parseInt(del.dataset.tdel,10)); return; }
  const b=e.target.closest('button'); if(!b) return;
  const tid=b.dataset.team, role=b.dataset.role;
  if(tid===undefined||!role) return;
  const i=parseInt(tid,10), list=teams[i].lineup;
  if(b.dataset.step) setRole(i,role,(list[role]||0)+parseInt(b.dataset.step,10));
  else if(b.dataset.n!==undefined) setRole(i,role,parseInt(b.dataset.n,10));
});
$('#setup').addEventListener('input',e=>{
  const el=e.target;
  if(el.dataset.num!==undefined&&el.dataset.team!==undefined){
    const tid=parseInt(el.dataset.team,10), role=el.dataset.num;
    setRole(tid,role,parseInt(el.value,10)||0,{silent:true});
    if(el.dataset.range){                       // 滑块带动数字框
      const box=el.closest('.tiles');
      const num=box&&box.querySelector('input.numin[data-num="'+role+'"]');
      if(num) num.value=teams[tid].lineup[role];
    }
    return;
  }
  if(el.dataset.tname!==undefined){ teams[parseInt(el.dataset.tname,10)].name=el.value||('队伍'+(parseInt(el.dataset.tname,10)+1));
    refreshPreviewOnly(); return; }
  if(el.dataset.stat){
    const k=el.dataset.stat, f=el.dataset.field, v=parseFloat(el.value);
    if(isNaN(v)) return;
    const d=CLASSES[k];
    if(d.gun&&(f==='dmg'||f==='cd'||f==='range')) d.gun[f]=v;
    else d[f]=v;
    if(f==='hp'){ for(const u of G.units){ if(u.cls===k){ const r=u.maxHp>0?u.hp/u.maxHp:1; u.maxHp=v; u.hp=Math.min(v,v*r); } } }
    renderGuide();
  }
});
$('#setup').addEventListener('change',e=>{
  const el=e.target;
  if(el.dataset.num!==undefined&&el.dataset.team!==undefined){
    renderPreview();                            // 失焦/回车后再同步方块与滑块
    return;
  }
  if(el.dataset.ttype!==undefined){ setTeamType(parseInt(el.dataset.ttype,10),el.value); return; }
  if(el.dataset.tcolor!==undefined){
    const i=parseInt(el.dataset.tcolor,10);
    teams[i].color=el.value; TEAM_HEX_clear();
    renderPreview(); drawEditor();
  }
});
$('#btnStatReset').addEventListener('click',()=>{
  for(const k in DEFAULT_STATS){
    const s=DEFAULT_STATS[k], d=CLASSES[k];
    d.hp=s.hp; d.speed=s.speed; d.dmg=s.dmg; d.cd=s.cd; d.range=s.range;
    if(d.gun&&s.gun){ d.gun.dmg=s.gun.dmg; d.gun.cd=s.gun.cd; d.gun.range=s.gun.range; }
  }
  renderStatTable(); renderGuide(); renderPreview();
  setMsg('已恢复默认数值','ok');
});
$('#btnBase').addEventListener('click',()=>{
  teams=[blankTeam(0,'h',BASE_H),blankTeam(1,'z',BASE_Z)];
  syncTeamRoles();
  renderPreview(); setMsg('已载入基础阵容（人类型 vs 僵尸型）','ok');
});
$('#btnRndAll').addEventListener('click',()=>{
  for(let i=0;i<teams.length;i++){
    const pool=teams[i].roles;
    const o={}; let tot=0;
    for(const k of pool){ const n=(rnd()*3)|0; o[k]=n; tot+=n; }
    if(tot<4){ o[pool[0]]=4; }
    for(const k of pool) if(o[k]===undefined) o[k]=0;
    teams[i].lineup=o;
  }
  renderPreview(); setMsg('已随机生成各方阵容','ok');
});
$('#btnStart').addEventListener('click',()=>{ if(startMatch()) setMsg('战斗进行中…','ok'); });
$('#btnAgain').addEventListener('click',()=>{ $('#result').classList.add('hidden'); startMatch(); });
$('#btnBackSetup').addEventListener('click',()=>{
  G.phase='setup'; $('#result').classList.add('hidden'); $('#setup').classList.remove('hidden');
  renderPreview(); drawEditor();
});
$('#btnRestart').addEventListener('click',()=>{ if(G.phase!=='setup') startMatch(); });
$('#btnPause').addEventListener('click',togglePause);
$('#btnSpeed').addEventListener('click',cycleSpeed);
$('#btnSelAll').addEventListener('click',()=>{
  G.selected.clear();
  /* 「全选」也要过权限：撤离模式下只选到人类 */
  for(const u of G.units) if(u.alive&&commandable(u)) selectUnit(u);
  syncBehaviorUI(); updateHUD(1);
});
$('#btnSelNone').addEventListener('click',()=>{ G.selected.clear(); syncBehaviorUI(); updateHUD(1); });
$('#btnNums').addEventListener('click',()=>{
  G.showNums=!G.showNums;
  $('#btnNums').textContent='显示编号：'+(G.showNums?'开':'关');
  $('#btnNums').classList.toggle('on',G.showNums);
});
$('#btnSetup').addEventListener('click',()=>{
  G.phase='setup'; $('#setup').classList.remove('hidden'); $('#result').classList.add('hidden');
  renderPreview(); drawEditor();
});
function togglePause(){
  if(G.phase!=='battle') return;
  G.paused=!G.paused;
  $('#btnPause').innerHTML=(G.paused?'继续 <span class="kbd">空格</span>':'暂停 <span class="kbd">空格</span>');
}
function cycleSpeed(){
  const steps=[1,2,4];
  G.speed=steps[(steps.indexOf(G.speed)+1)%steps.length];
  $('#btnSpeed').innerHTML='速度 '+G.speed+'× <span class="kbd">S</span>';
}
window.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT') return;
  if(e.code==='Space'){ e.preventDefault(); togglePause(); }
  else if(e.key==='r'||e.key==='R'){ if(G.phase!=='setup') startMatch(); }
  else if(e.key==='s'||e.key==='S'){ cycleSpeed(); }
  else if(e.key==='n'||e.key==='N'){ $('#btnNums').click(); }
  else if(e.key==='l'||e.key==='L'){ setCmdOn(!G.cmdOn); }
  else if(e.key==='e'||e.key==='E'){
    if(G.phase==='setup'){ $('#setup').classList.add('hidden'); if(G.units.length) G.phase='battle'; }
    else { G.phase='setup'; $('#setup').classList.remove('hidden'); $('#result').classList.add('hidden'); renderPreview(); drawEditor(); }
  }
  else if(e.key==='f'||e.key==='F'){ toggleFull(); }
  else if(e.key==='Escape'){
    if(!$('#setup').classList.contains('hidden')){ $('#setup').classList.add('hidden'); if(G.units.length) G.phase='battle'; }
    else if(!$('#result').classList.contains('hidden')) $('#result').classList.add('hidden');
    else if(G.selected.size){ G.selected.clear(); syncBehaviorUI(); updateHUD(1); }
    else if(isPseudoFull()) toggleFull();
  }
});

/* ---------------- 主帧循环 ---------------- */
let last=performance.now(), resultShown=false;
function frame(now){
  const ms=Math.min(64,now-last); last=now;
  if(G.phase==='battle'&&!G.paused){
    for(let i=0;i<G.speed;i++) stepSim(1/60);
  }
  render();
  updateHUD(ms/1000);
  if(G.phase==='result'&&!resultShown){ resultShown=true; showResult(); }
  if(G.phase!=='result') resultShown=false;
  requestAnimationFrame(frame);
}

/* ---------------- 初始化 ----------------
   ★ 所有 $('#id').textContent 都要先判空。
   教训：简化 UI 文案时删掉了 #cohShow 这个 <b>，
   但这里仍写 $('#cohShow').textContent=... ——
   于是抛 TypeError 并**中断整个脚本**，后面所有初始化（包括标题屏、
   QB 调试接口）全部没执行，页面看起来像「地图没更新 / 功能没生效」。
   这类「JS 引用了已删除的元素」必须靠判空兜住。 */
editGrid=PRESETS.balanced.build(newGrid());
syncTeamRoles();
if($('#panicShow')) $('#panicShow').textContent=PANIC_R;
if($('#cohShow')) $('#cohShow').textContent=COHESION_R;
if($('#infectShow')) $('#infectShow').textContent=INFECT_TIME.toFixed(0);
renderStatTable(); renderGuide(); renderPreview(); renderWaves(); drawEditor();
syncStage();
$$('.beh').forEach(b=>b.classList.toggle('on',b.dataset.beh===G.behavior));
G.map.set(editGrid); G.baseDirty=true; bakeMap(); render();
requestAnimationFrame(frame);

/* ---------------- 调试 / 自动化接口 ---------------- */
window.QB = {
  get state(){
    let inf=0, units=0;
    for(const u of G.units){
      if(!u.alive) continue;
      units++;
      if(u.kind==='h'&&u.infect>0) inf++;
    }
    const ts=teams.map((t,i)=>{
      let a=0, hz=0;
      for(const u of G.units){
        if(u.team!==i||!u.alive) continue;
        a++; if(u.kind==='z') hz++;
      }
      return {name:teams[i].name, type:teams[i].type, alive:a, zombies:hz, hpFrac:+hpFrac(i).toFixed(3)};
    });
    return {phase:G.phase,time:+G.time.toFixed(1),teams:ts,units:units,
      h:ts[0]?ts[0].alive:0, z:ts[1]?ts[1].alive:0,
      infected:inf,bullets:G.bullets.length,result:G.result,map:Array.from(G.map),
      kills:G.kills.slice(),infections:G.infections,converted:G.converted,
      behavior:G.behavior,selected:G.selected.size,showNums:G.showNums,
      /* ★ paused / speed 补进状态快照：
         界面上的暂停与倍速只体现在按钮文字，自动化测试与外部脚本
         没有可读的状态字段，只能去猜 —— 这里直接暴露出来。 */
      paused:!!G.paused, speed:G.speed,
      reloadOn:G.reloadOn,waveOn:waveOn,waveIdx:G.waveIdx,waves:waves.length,
      hHp:+hpFrac(0).toFixed(3), zHp:teams[1]?+hpFrac(1).toFixed(3):0,
      intactDoors:G.doorHP.reduce((n,v)=>n+(v>0?1:0),0),
      brokenDoors:G.doorHP.reduce((n,v,i)=>n+((G.map[i]===DOOR&&v<=0)?1:0),0)};
  },
  teams(){ return teams.map((t,i)=>({index:i,name:t.name,type:t.type,color:teamColor(i),
                                      roles:t.roles.slice(),lineup:Object.assign({},t.lineup)})); },
  setTeams(list){ return rebuildTeams(list).length; },
  start(cfg){
    cfg=cfg||{};
    if(cfg.teams) rebuildTeams(cfg.teams);
    syncTeamRoles();
    if(cfg.h!==undefined||cfg.z!==undefined){
      const hv=cfg.h||0, zv=cfg.z||0;
      teams[0].lineup = typeof hv==='string' ? lineupFromDigits(hv,teams[0].roles) : lineupForType(teams[0].type,hv);
      if(teams[1]) teams[1].lineup = typeof zv==='string' ? lineupFromDigits(zv,teams[1].roles) : lineupForType(teams[1].type,zv);
    }
    if(cfg.behavior) G.behavior=cfg.behavior;
    if(cfg.showNums!==undefined) G.showNums=!!cfg.showNums;
    if(cfg.size&&MAP_SIZES[cfg.size]&&cfg.size!==MSIZE) setMapSize(cfg.size,true,true);
    if(cfg.grid||cfg.map){
      const arr=cfg.grid||cfg.map;
      if(arr.length!==GW*GH){                    // 网格长度对不上时按尺寸表推断
        const hit=Object.keys(MAP_SIZES).find(k=>MAP_SIZES[k].gw*MAP_SIZES[k].gh===arr.length);
        if(hit) setMapSize(hit,true,true);
      }
    }
    if(cfg.preset) editGrid=PRESETS[cfg.preset].build(newGrid());
    if(cfg.grid) editGrid=Uint8Array.from(cfg.grid);
    if(cfg.map) editGrid=Uint8Array.from(cfg.map);
    renderPreview(); renderGuide();
    return startMatch()?this.state:null;
  },
  size(){ return {key:MSIZE,name:MAP_SIZES[MSIZE].name,gw:GW,gh:GH}; },
  /* 撤离模式：开启后在地图上撒平民 + 建撤离区 */
  mission(on,cfg){
    cfg=cfg||{};
    if(on===false){ G.mission.on=false; G.mission.civs=[]; G.mission.zone=null;
      missionFlag=false; G.missionLock=false; return {on:false}; }
    if(on===true||on===undefined&&!G.mission.on){
      /* ★ 先确保队伍能用（1 支人类 + 1 支僵尸）。
         旧版这里只调 missionSetup，队伍不成形时开局会被 startMatch 拒绝，
         而且不会自动补默认编制 —— 表现为「勾了撤离却开不了局」。
         现在与面板勾选走同一条路径。 */
      if(typeof applyMissionLineup==='function') applyMissionLineup(false);
      /* 置位程序化开关：这样 startMatch 即使读不到 DOM 也会开撤离模式 */
      missionFlag=true;
      /* 直接复用 missionSetup，避免两套逻辑不一致 */
      const m=missionSetup(cfg.civilians||8,cfg.zone,cfg.area||G.missionArea);
      return {on:true,total:m.total,zone:m.zone};
    }
    return {on:G.mission.on,total:G.mission.total,saved:G.mission.saved,left:G.mission.left,escorting:G.mission.escorting};
  },
  /* 载入撤离专用地图（同时把撤离区设为该地图自带的位置）。
     返回 {kind,name,zone,mainSize,sealed} 便于校验。 */
  missionMap(kind){
    if(!MISSION_MAPS[kind]) return null;
    /* ★ 撤离模式强制用超大地图：城市救援需要足够的街区纵深 */
    if(MSIZE!=='huge') setMapSize('huge',true,true);
    const built=buildMissionMap(kind);
    editGrid=built.grid;
    /* 注意：撤离地图**只写进「特效尺寸」的槽位**，不碰玩家选定的尺寸。
       早期版本无条件 setMapSize('huge')，会覆盖 SIZE_MAP[huge].custom，
       于是「我要玩大图」和「我要玩撤离」互相踩 —— 用户反馈的冲突就是这个。
       现在：载入撤离地图 = 当前尺寸切到 huge + 写该尺寸的槽位，
       这是玩家主动选择的结果，不会反向污染其他尺寸。 */
    const mem=SIZE_MAP[MSIZE]; if(mem) mem.custom=Uint8Array.from(editGrid);
    G.missionZone=built.zone;
    G.missionArea=built.civArea||null;
    G.__mainRegion=null;
    /* 僵尸从右侧涌入（撤离区在左侧，两者分居地图两头，不再重叠） */
    G.spawners=[
      {x:VW-TILE*2,y:VH*0.25,r:40,name:'东北入口'},
      {x:VW-TILE*2,y:VH*0.75,r:40,name:'东南入口'},
      {x:VW-TILE*5,y:VH*0.5, r:40,name:'东侧突破口'},
    ];
    G.spawnOn=true;
    const reg=mainRegion(editGrid);
    return {kind:kind, name:MISSION_MAPS[kind].name, desc:MISSION_MAPS[kind].desc,
            zone:built.zone, mainSize:reg.size, sealed:reg.sealed,
            zoneOk:!!(reg.mask&&reg.mask[((built.zone.y/TILE)|0)*GW+((built.zone.x/TILE)|0)])};
  },
  /* 撤离候选点诊断：看看某张图上到底能放几个平民 */
  missionDiag(kind,n){
    n=n||6;
    if(!MISSION_MAPS[kind]) return null;
    const built=buildMissionMap(kind);
    const g=built.grid, zone=built.zone;
    const reg=mainRegion(g);
    const TILE2=TILE;
    let inRegion=0, farEnough=0;
    const sectors=new Array(n).fill(0);
    for(let ty=1;ty<GH-1;ty++) for(let tx=1;tx<GW-1;tx++){
      const i=idx(tx,ty);
      if(!reg.mask||!reg.mask[i]) continue;
      inRegion++;
      const x=cx_of(tx),y=cy_of(ty);
      const d=Math.hypot(x-zone.x,y-zone.y);
      if(d<TILE2*6) continue;
      farEnough++;
      let a=Math.atan2(y-zone.y,x-zone.x);
      while(a<-Math.PI) a+=TAU; while(a>=Math.PI) a-=TAU;
      for(let s=0;s<n;s++){
        const a0=-Math.PI+s/n*TAU, a1=-Math.PI+(s+1)/n*TAU;
        if(a>=a0&&a<a1){ sectors[s]++; break; }
      }
    }
    return {kind:kind,zone:zone,regionSize:reg.size,sealed:reg.sealed,
            inRegion:inRegion,farEnough:farEnough,sectors:sectors};
  },
  missionState(){
    const m=G.mission;
    return {on:m.on,saved:m.saved,total:m.total,left:m.left,escorting:m.escorting,
            lost:m.lost||0, extracted:(m.extractedList||[]).length,
            zone:m.zone,complete:missionComplete()};
  },
  /* 平民逐个诊断：看清到底卡在哪一步 */
  civTrace(){
    const m=G.mission;
    if(!m||!m.on) return [];
    return m.civs.map(c=>({
      label:c.label, alive:!!c.alive, extracted:!!c.extracted,
      claimed:!!c.claimed, hasPath:!!(c.path&&c.path.length),
      pathLen:c.path?c.path.length:0, escort:!!c.escort,
      dist:m.zone?Math.round(Math.hypot(c.x-m.zone.x,c.y-m.zone.y)):null,
      tx:+(c.x/TILE).toFixed(1), ty:+(c.y/TILE).toFixed(1),
    }));
  },
  /* ---- 预设出生点（玩家在地图上点的位置）---- */
  customSpawns(){ return customSpawnsOf().map(s=>({team:s.team|0,x:s.x,y:s.y})); },
  customSpawners(){ return customSpawnersOf().map(s=>({x:s.x,y:s.y,r:s.r,name:s.name})); },
  /* 放一个出生点：kind='team'|'spawner'，team 只在 kind='team' 时有效 */
  placeSpawn(kind,team,gx,gy){
    const mem=ensureSpawnStore();
    const x=gx*TILE+TILE*0.5, y=gy*TILE+TILE*0.5;
    if(kind==='team'){
      const t=clamp(team|0,0,5);
      mem.customSpawns=mem.customSpawns.filter(s=>(s.team|0)!==t);
      mem.customSpawns.push({team:t,x:x,y:y});
      G.baseDirty=true;
      return {ok:true,kind:'team',team:t,x:x,y:y};
    }
    mem.customSpawners.push({x:x,y:y,r:40,name:'洞口'+(mem.customSpawners.length+1)});
    G.baseDirty=true;
    return {ok:true,kind:'spawner',x:x,y:y};
  },
  clearSpawns(){
    const mem=ensureSpawnStore();
    mem.customSpawns=[]; mem.customSpawners=[];
    G.baseDirty=true;
    return {ok:true};
  },
  /* 刷怪点 */
  spawners(list){    if(list!==undefined){
      if(list===false){ G.spawnOn=false; return {on:false}; }
      G.spawnOn=true;
      G.spawners=(Array.isArray(list)&&list.length?list:defaultSpawners()).map(s=>({
        x:s.x!==undefined?s.x:VW/2, y:s.y!==undefined?s.y:VH/2, r:s.r||34, name:s.name||'洞口',
      }));
    }
    return {on:G.spawnOn, list:G.spawners.map(s=>({x:s.x,y:s.y,r:s.r,name:s.name}))};
  },
  emit(idx,n,cls){                          // 从第 idx 个刷怪点放出 n 只
    const sp=G.spawners[idx]; if(!sp) return 0;
    return spawnerEmit(sp,n||5,cls||'zombie',1).length;
  },
  /* ★ 按人类方实力自动生成一波僵尸。
     用户要求：「刷怪点自动识别入局人类方水平生成对应质量和数量的僵尸」。
     做法：
       ① 算人类方的「战力」（综合血量 / 输出 / 人数 / 兵种质量）
       ② 用战力换算出僵尸的**总预算**（质量分）
       ③ 按预算挑选兵种组合（跑尸/僵尸/大胃袋/母体/终极母体，
          终极母体只在人类战力很高时才出现）
       ④ 从各洞口按比例投放
     返回 {wave, count, budget, breakdown} 便于调试与显示。 */
  autoWave(opts){
    opts=opts||{};
    const diff=opts.difficulty!==undefined?opts.difficulty:1.0;   // 难度系数
    /* ① 人类战力：只统计人类队伍（含已倒戈的不算） */
    let power=0, humans=0, breakdown={};
    for(const u of G.units){
      if(!u.alive||u.kind!=='h') continue;
      const d=CLASSES[u.cls]; if(!d) continue;
      humans++;
      /* 单兵战力 = 血量权重 + 输出权重（dmg/cd 即 DPS）+ 射程权重 */
      const dps=d.cd>0?(d.dmg*(d.shot||1))/d.cd:0;
      const p = d.hp*0.09 + Math.min(dps,90)*0.55 + Math.min(d.range,600)*0.030 + 6;
      power += p;
      breakdown[u.cls]=(breakdown[u.cls]||0)+1;
    }
    if(!humans) return {wave:0,count:0,budget:0,breakdown:breakdown,humans:0};
    /* ② 僵尸总预算：人类战力 × 难度 × 基准比。
       基准比 1.15 的含义是「僵尸在质量上略微超模」，
       因为僵尸需要靠数量淹没人（单挑打不过枪械）。 */
    const budget=Math.max(24, power*1.15*diff);
    /* ③ 兵种质量分（越强的僵尸分越高，决定能出几只） */
    const COST={ runner:9, zombie:14, bigbelly:34, mother:78, umother:190 };
    const ORDER=['runner','zombie','bigbelly','mother','umother'];
    /* 终极母体只在人类战力足够高（≥ 900）时才放，避免开局就被碾压 */
    const allowU=power>=900;
    let left=budget, picks={}, total=0;
    /* 先按「从强到弱」试着放一个，能放就放，保证有 Boss 级压力 */
    for(let i=ORDER.length-1;i>=0;i--){
      const k=ORDER[i];
      if(k==='umother'&&!allowU) continue;
      const c=COST[k];
      /* 高级单位数量受限：母体不超过人类数的 1/3，终极母体最多 2 只 */
      let cap = k==='umother'?2 : (k==='mother'?Math.max(1,Math.ceil(humans/3))
                : (k==='bigbelly'?Math.max(2,Math.ceil(humans/2)) : 999));
      while(left>=c&&cap>0&&(picks[k]||0)<cap){
        picks[k]=(picks[k]||0)+1; left-=c; total++; cap--;
        /* 母体不要一次放太多 */
        if(k==='mother'&&(picks[k]||0)>=2) break;
      }
    }
    /* 剩下的预算全买跑尸/僵尸（用最小的填满，保证数量感） */
    while(left>=COST.runner){
      if(left>=COST.zombie&&rnd()<0.55){ picks.zombie=(picks.zombie||0)+1; left-=COST.zombie; }
      else { picks.runner=(picks.runner||0)+1; left-=COST.runner; }
      total++;
      if(total>400) break;                       // 安全上限
    }
    /* ④ 投放：按洞口轮流放 */
    const out={runner:0,zombie:0,bigbelly:0,mother:0,umother:0};
    Object.assign(out,picks);
    const list=[];
    const sps=G.spawners.length?G.spawners:defaultSpawners();
    let si=0;
    for(const k of ORDER){
      for(let i=0;i<(out[k]||0);i++){
        const sp=sps[si++%sps.length];
        list.push({cls:k,x:sp.x,y:sp.y});
      }
    }
    G.spawnOn=true;
    if(opts.place!==false) spawnerEmitMix(list);
    return {wave:total, count:total, budget:Math.round(budget),
            power:Math.round(power), humans:humans, breakdown:out};
  },
  /* 地图体检：按 AI 逻辑检查当前编辑地图是否可用 */
  auditMap(){ return auditMap(editGrid); },
  /* 兵种在「选择界面」显示的那行简介（用于测试文案正确性） */
  roleStatLine(k){ return roleStatLine(k); },

  /* ---- 翻窗机制探针 ---- */
  vaultTest(){
    const save={
      units:G.units, map:G.map, counter:G.counter,
      sel:G.selected, parts:G.parts, bullets:G.bullets,
    };
    const out={};
    try{
      /* 造一小片地形：中间一扇窗，两侧空地 */
      const cx=Math.floor(GW/2), cy=Math.floor(GH/2);
      const g=newGrid();
      for(let y=1;y<GH-1;y++) for(let x=1;x<GW-1;x++) gSet(g,x,y,EMPTY);
      gBorder(g);
      const wx=cx, wy=cy;
      gSet(g,wx,wy,WIN);
      G.map=g;
      G.doorHP.fill(0); G.winHP.fill(0);
      G.winHP[idx(wx,wy)]=WIN_MAX;
      G.units=[]; G.counter=1;

      /* 人类：站在窗格上 */
      const h=makeUnit('rifle',0,cx_of(wx),cy_of(wy),1);
      h.spawnT=0; h.vaultT=0;
      G.units.push(h);
      updateVault(h);
      out.humanVaulting=(h.vaultT>0);
      /* 速度对比：翻越中 vs 正常 */
      const moved=(u)=>{
        u.x=cx_of(wx); u.y=cy_of(wy); u.vx=0; u.vy=0;
        const x0=u.x;
        steer(u,60,0,1/60,1);
        return Math.abs(u.x-x0);
      };
      const dVault=moved(h);
      const h2=makeUnit('rifle',0,cx_of(wx),cy_of(wy),2); h2.vaultT=0;
      const dFree=moved(h2);
      out.speedRatio=dFree>0?+(dVault/dFree).toFixed(3):0;
      out.mayShoot=shieldMayShoot(h);

      /* 僵尸：同样站在窗格上，不该进入翻越状态 */
      const z=makeUnit('zombie',1,cx_of(wx),cy_of(wy),3);
      z.spawnT=0; z.vaultT=0;
      G.units.push(z);
      updateVault(z);
      out.zombieVaulting=(z.vaultT>0);

      /* 离开窗格 → 状态解除 */
      h.x=cx_of(wx)+TILE*2;
      updateVault(h);
      out.released=(h.vaultT===0);

      /* 寻路代价 */
      out.pathCost=hCost(wx,wy);
      const zc=zCost(wx,wy);
      out.zCost=(zc===Infinity)?'Infinity':zc;
    }catch(e){ out.error=String(e&&e.message||e); }
    /* 还原 */
    G.units=save.units; G.map=save.map; G.counter=save.counter;
    G.selected=save.sel; G.parts=save.parts; G.bullets=save.bullets;
    G.__mainRegion=null;
    return out;
  },

  /* 把「自定义地图」清掉，恢复成预置图。
     回归测试里必须用：前面的用例可能写过自定义网格到 SIZE_MAP，
     不清的话后续用例跑的不是预想的图，结果无法复现。 */
  resetMapState(){
    for (const k in SIZE_MAP) {
      SIZE_MAP[k].custom = null;
      SIZE_MAP[k].kind = 'balanced';
      SIZE_MAP[k].customSpawns = [];
      SIZE_MAP[k].customSpawners = [];
    }
    missionFlag = false;
    G.missionLock = false;
    G.mission.on = false;
    G.mission.civs = [];
    G.mission.zone = null;
    G.__mainRegion = null;
    return true;
  },

  /* ---- 随机地图 ---- */
  buildRandomMap(seed, style){ return buildRandomMap(seed, style); },
  randomMapReliability(n){ return randomMapReliability(n); },
  /* 把一张地图直接塞进编辑区（测试随机图用） */
  applyGridToEdit(g){
    if(!g||g.length!==GW*GH) return false;
    editGrid=Uint8Array.from(g);
    const mem=SIZE_MAP[MSIZE]; if(mem) mem.custom=Uint8Array.from(editGrid);
    G.__mainRegion=null;
    return true;
  },

  /* ---- 预算模式 ---- */
  prices(){
    const out={};
    for(const k in CLASSES) out[k]={name:CLASSES[k].name, price:unitPrice(k)};
    return out;
  },
  budgetPresets(){
    const out=[];
    for(const k in BUDGET_PRESETS){
      const P=BUDGET_PRESETS[k];
      out.push({key:k,name:P.name,budget:P.budget,enemyCount:P.enemyCount,
                waves:P.waves,diff:P.diff,desc:P.desc,
                pool:P.pool.slice(),enemyPool:(P.enemyPool||[]).slice()});
    }
    return out;
  },
  /* 预算模式可选地图（与难度独立） */
  budgetMaps(){ return BUDGET_MAPS.map(function(m){ return {key:m.key,name:m.name}; }); },
  /* 用算法给出一份建议编成（玩家可以照着改） */
  budgetSuggest(key, opts){
    const P=BUDGET_PRESETS[key]; if(!P) return null;
    const r=buildBudgetLineup(P.budget,P.pool,opts||{});
    const waves=buildBudgetWaves(key);
    return {key:key, name:P.name, budget:P.budget, enemyCount:P.enemyCount,
            lineup:r.lineup, spent:r.spent, count:r.count, left:r.left,
            waves:waves.map(function(w){ return {lineup:w.lineup,count:w.count,gap:w.gap}; })};
  },
  /* 应用一个预算预设：玩家队伍用建议编成，敌人用隐藏波次 */
  applyBudget(key, opts){
    const P=BUDGET_PRESETS[key]; if(!P) return null;
    opts=opts||{};
    /* 允许玩家手动指定编成（UI 里加减过）；没给就用算法配的 */
    const r=opts.lineup
      ? {lineup:Object.assign({},opts.lineup),
         spent:(function(){ let s=0; for(const k in opts.lineup) s+=unitPrice(k)*opts.lineup[k]; return s; })(),
         count:(function(){ let n=0; for(const k in opts.lineup) n+=opts.lineup[k]; return n; })(),
         left:0}
      : buildBudgetLineup(P.budget,P.pool);
    /* ★ 变量名不能叫 waves —— 那是模块级的全局轮次数组。 */
    const wv=buildBudgetWaves(key);
    const eWaves=wv.map(function(w){
      return {lineup:Object.assign({},w.lineup), gap:w.gap};
    });
    /* ★ 地图与难度独立：优先用调用方指定的地图，否则用 UI 当前选的 */
    const mapKey=opts.map||bgMapKey||'balanced';
    let mg=null;
    if(mapKey==='random'){
      mg=buildRandomMap(opts.seed||bgRandSeed||((Date.now()&0xffffff)>>>0));
    } else if(PRESETS[mapKey]){
      mg=PRESETS[mapKey].build(newGrid());
    }
    if(mg&&mg.length===GW*GH){
      editGrid=mg;
      const mem=SIZE_MAP[MSIZE]; if(mem) mem.custom=Uint8Array.from(editGrid);
      G.__mainRegion=null;
      try{ drawEditor(); }catch(e){}
    }
    rebuildTeams([
      {name:'我的队伍', type:'h', lineup:Object.assign({},r.lineup)},
      {name:'感染者',   type:'z', lineup:Object.assign({},eWaves[0].lineup)},
    ]);
    try{ renderRoster(); renderPreview(); renderGuide(); }catch(e){}
    /* 用轮次系统投放（后续波次在局内才知道内容） */
    waveOn=true;
    waves=eWaves;
    return {key:key, name:P.name, budget:P.budget, spent:r.spent,
            lineup:r.lineup, count:r.count, enemyCount:P.enemyCount,
            waveCount:eWaves.length, map:mapKey};
  },

  /* ---- 地图保存 / 加载 ---- */
  mapStoreKeys(){ return Object.keys(loadMapStore()); },
  saveMap(name){
    try{ return saveNamedMap(name); }
    catch(e){ return {ok:false,error:String(e&&e.message||e)}; }
  },
  loadMap(name){ return loadSavedMap(name); },
  deleteMap(name){ deleteSavedMap(name); return Object.keys(loadMapStore()); },
  clearMaps(){ saveMapStore({}); renderSavedMaps(); return []; },
  /* 导出成字符串（测试用，不触发浏览器下载） */
  exportMapText(name){
    const store=loadMapStore();
    const rec=store[name]; if(!rec) return null;
    const maps={}; maps[name]=rec;
    return JSON.stringify({format:'dsb-map',version:1,maps:maps});
  },
  importMapText(t){ return importMapText(t); },
  /* ---- 随机种子（回归测试用：固定后结果可复现）---- */
  seed(v){
    if(v===undefined) return fixedSeed;
    fixedSeed=(v===null)?null:(v>>>0);
    return fixedSeed;
  },

  /* ---- 地图分享码（玩家社群互传）---- */
  shareCode(name){
    try{ return makeShareCode(name); }
    catch(e){ return null; }
  },
  importCode(code, name){
    try{ return importShareCode(code, name); }
    catch(e){ return {ok:false, error:String(e&&e.message||e)}; }
  },
  parseCode(code){
    try{ const r=parseShareCode(code); return {ok:true, size:r.size, spawns:r.spawns.length, spawners:r.spawners.length}; }
    catch(e){ return {ok:false, error:String(e&&e.message||e)}; }
  },
  /* RLE 编解码往返测试入口 */
  _rleEncode(a){ return rleEncode(a); },
  _rleDecode(s,n){ return Array.from(rleDecode(s,n)); },
  /* 模式切换 */
  mode(){ return gameMode; },
  setMode(m){ return setGameMode(m); },

  /* 最近一次开局被拒的原因（调试用） */
  lastValidateFail(){
    try{ return (typeof window!=='undefined')?window.__lastValidateFail:null; }catch(e){ return null; }
  },
  /* ---- 指挥权限（撤离模式只能控制人类）---- */
  missionLock(){ return !!G.missionLock; },
  selected(){
    const out=[];
    const byId=new Map();
    for(const u of G.units) byId.set(u.id,u);
    for(const id of G.selected){ const u=byId.get(id); if(u) out.push({id:u.id,kind:u.kind,cls:u.cls,team:u.team}); }
    return out;
  },
  selectAll(){
    G.selected.clear();
    for(const u of G.units) if(u.alive&&commandable(u)) selectUnit(u);
    return G.selected.size;
  },
  /* 强行尝试选中一个敌方（用来验证权限锁真的拦得住） */
  trySelectEnemy(){
    for(const u of G.units){
      if(u.alive&&u.kind!=='h'){ selectUnit(u); return {tried:true,id:u.id,kind:u.kind}; }
    }
    return {tried:false};
  },
  /* 某个世界坐标是否可通行（验证刷怪点没落在墙里） */
  passableAt(x,y){
    const tx=(x/TILE)|0, ty=(y/TILE)|0;
    if(!inB(tx,ty)) return false;
    return passableForHuman(G.map,tx,ty);
  },
  /* 直接跑一遍 validateGrid，看当前队伍数下能不能开局 */
  validateNow(){ return validateGrid(editGrid); },
  auditPreset(kind){
    const g=PRESETS[kind]?PRESETS[kind].build(newGrid()):null;
    return g?auditMap(g):null;
  },
  /* 列出所有预置地图及其关卡设计指标（用于对比与调优） */
  presets(){
    const out=[];
    /* 只列「真实可用」的地图：排除旧 key 的别名（plaza→balanced 等） */
    const ALIAS={plaza:1,fortress:1,warehouse:1,city:1};
    for(const k in PRESETS){
      if(ALIAS[k]) continue;
      const g=PRESETS[k].build(newGrid());
      const a=auditMap(g);
      out.push({key:k, name:PRESETS[k].name, ok:a.ok, issues:a.issues,
                mainSize:a.stats.mainSize, sealed:a.stats.sealed,
                chokepoints:a.stats.chokepoints, maxSight:a.stats.maxSight,
                coverRatio:a.stats.coverRatio, door:a.stats.door, win:a.stats.win});
    }
    return out;
  },
  /* 把某张预置地图生成到编辑区并返回字符画（调试用，直观看结构） */
  previewMap(kind){
    if(!PRESETS[kind]) return null;
    const g=PRESETS[kind].build(newGrid());
    const rows=[];
    for(let y=0;y<GH;y++){
      let s='';
      for(let x=0;x<GW;x++){
        const t=g[idx(x,y)];
        s += t===WALL?'#':(t===WIN?'=':(t===DOOR?'+':'.'));
      }
      rows.push(s);
    }
    return rows;
  },
  /* 撤离任务地图的字符画（会自动切到 huge 尺寸） */
  previewMissionMap(kind){
    if(!MISSION_MAPS[kind]) return null;
    if(MSIZE!=='huge') setMapSize('huge',true,true);
    const built=buildMissionMap(kind);
    const g=built.grid;
    const rows=[];
    for(let y=0;y<GH;y++){
      let s='';
      for(let x=0;x<GW;x++){
        const t=g[idx(x,y)];
        s += t===WALL?'#':(t===WIN?'=':(t===DOOR?'+':'.'));
      }
      rows.push(s);
    }
    return {rows:rows, zone:built.zone};
  },
  reload(v){ if(v!==undefined){ G.reloadOn=!!v; $('#chkReload').checked=G.reloadOn;
      for(const u of G.units){ u.magLeft=CLASSES[u.cls].mag||0; u.reloadT=0; } } return G.reloadOn; },
  waves(v){
    if(v!==undefined){
      if(v===false){ waveOn=false; }
      else {
        waveOn=true;
        if(Array.isArray(v)) waves=v.map(w=>({lineup:Object.assign({},w.lineup||{}),gap:w.gap||25}));
      }
      $('#chkWave').checked=waveOn; renderWaves();
    }
    return {on:waveOn, list:waves.map(w=>({lineup:Object.assign({},w.lineup),gap:w.gap})),
            idx:G.waveIdx, log:G.waveLog.slice()};
  },
  setMapSize(k){ return setMapSize(k,true,true); },
  cmdOn(v){ if(v!==undefined) setCmdOn(!!v); return G.cmdOn; },
  sfx(v){ if(v!==undefined){ setSfxEnabled(!!v); const el=$('#chkSfx'); if(el) el.checked=sfxEnabled; } return sfxEnabled; },
  sfxPlay(name){ sfx(name); return name; },
  sfxNames(){ return Object.keys(SFX_RECIPES); },
  grenades(){ return (G.grenades||[]).map(g=>({x:+g.x.toFixed(1),y:+g.y.toFixed(1),
      x1:+g.x1.toFixed(1),y1:+g.y1.toFixed(1),t:+g.t.toFixed(2),flight:g.flight,team:g.team})); },
  defaults(){ return {h:Object.assign({},BASE_H), z:Object.assign({},BASE_Z)}; },
  lineup(i){ return teams[i||0].lineup; },
  simulate(sec,dt){
    dt=dt||1/60;
    const n=Math.round(sec/dt);
    for(let i=0;i<n&&G.phase==='battle';i++) stepSim(dt);
    render(); updateHUD(1);
    if(G.phase==='result'&&!resultShown){ resultShown=true; showResult(); }
    return this.state;
  },
  setSpeed(s){ G.speed=s; },
  pause(v){ G.paused=!!v; },
  healAll(){ for(const u of G.units){ u.hp=u.maxHp; u.alive=true; if(u.kind==='h') u.infect=0; } },
  embedded(){
    const out=[];
    for(const u of G.units){
      if(!u.alive) continue;
      const tx=(u.x/TILE)|0, ty=(u.y/TILE)|0;
      if(!inB(tx,ty)){ out.push(u.label+' 出界'); continue; }
      if(blocksMove(G.map[idx(tx,ty)],tx,ty,u.kind))
        out.push(u.label+' 嵌在 '+['空','墙','窗','门'][G.map[idx(tx,ty)]]+'('+tx+','+ty+')');
    }
    return out;
  },
  units(){
    return G.units.filter(u=>u.alive).map(u=>({label:u.label,cls:u.cls,kind:u.kind,team:u.team,
      x:+u.x.toFixed(1),y:+u.y.toFixed(1),hp:+u.hp.toFixed(1),infect:+u.infect.toFixed(2),
      behavior:u.behavior||G.behavior,selected:G.selected.has(u.id),rateMul:+u.rateMul.toFixed(2),
      magLeft:u.magLeft,reloadT:+u.reloadT.toFixed(2),reloading:u.reloadT>0,
      dispatching:!!u.dispatch,dispX:u.dispatch?+u.dispatch.x.toFixed(1):null,
      dispY:u.dispatch?+u.dispatch.y.toFixed(1):null,
      cover:u.cover?{x:+u.cover.x.toFixed(1),y:+u.cover.y.toFixed(1)}:null,
      isCiv:!!u.isCiv, saved:!!u.saved,
      escorting:!!u.escort}));
  },
  select(labels){
    G.selected.clear();
    for(const u of G.units){
      if(!u.alive) continue;
      if(!labels||labels.indexOf(u.label)>=0) G.selected.add(u.id);
    }
    syncBehaviorUI();
    return G.selected.size;
  },
  dispatch(x,y){ return dispatchSelected(x,y); },
  teamsInfo(){
    const info=teams.map(()=>({}));
    for(const u of G.units){ if(u.alive) info[u.team][u.name]=(info[u.team][u.name]||0)+1; }
    return info;
  },
  classes(){ return ALL_ROLES.map(k=>Object.assign({key:k},CLASSES[k])); },
  /* 机制直查 / 确定性验证 */
  probe(){
    const c=counts();
    const saveMap=G.map, saveDoor=G.doorHP;
    function scratch(t,hp,kind){
      const g=new Uint8Array(GW*GH); G.map=g; G.doorHP=new Float32Array(GW*GH);
      const X=17,Y=9; g[idx(X,Y)]=t; if(hp) G.doorHP[idx(X,Y)]=hp;
      const r={human:blocksMove(t,X,Y,'h'),zombie:blocksMove(t,X,Y,'z'),sight:blocksSight(t,X,Y)};
      G.map=saveMap; G.doorHP=saveDoor;
      return r;
    }
    const empty=scratch(EMPTY,0), wall=scratch(WALL,0), win=scratch(WIN,0),
          doorOpen=scratch(DOOR,0), doorClosed=scratch(DOOR,DOOR_MAX);
    const los=(function(){
      const sm=G.map, sd=G.doorHP;
      const g=new Uint8Array(GW*GH); G.map=g; G.doorHP=new Float32Array(GW*GH);
      const y=9;
      g[idx(17,y)]=WIN;                        const throughWin=losClear(cx_of(14),cy_of(y),cx_of(21),cy_of(y));
      g[idx(17,y)]=WALL;                       const throughWall=losClear(cx_of(14),cy_of(y),cx_of(21),cy_of(y));
      g[idx(17,y)]=DOOR; G.doorHP[idx(17,y)]=DOOR_MAX; const throughDoor=losClear(cx_of(14),cy_of(y),cx_of(21),cy_of(y));
      G.doorHP[idx(17,y)]=0;                   const throughBroken=losClear(cx_of(14),cy_of(y),cx_of(21),cy_of(y));
      g[idx(17,y)]=EMPTY;                      const throughOpen=losClear(cx_of(14),cy_of(y),cx_of(21),cy_of(y));
      g[idx(17,y)]=WIN;                        const meleeWin=meleeReach(cx_of(14),cy_of(y),cx_of(21),cy_of(y));
      g[idx(17,y)]=EMPTY;                      const meleeOpen=meleeReach(cx_of(14),cy_of(y),cx_of(21),cy_of(y));
      G.map=sm; G.doorHP=sd;
      return {throughWin,throughWall,throughDoor,throughBroken,throughOpen,meleeWin,meleeOpen};
    })();
    const speedRank=ALL_ROLES.map(k=>[CLASSES[k].name,CLASSES[k].speed])
      .sort((a,b)=>b[1]-a[1]).map(x=>x[0]+':'+x[1]);
    const dmgRank=ALL_ROLES.map(k=>{ const d=CLASSES[k], g=d.gun||d;
      return [d.name, +(g.dmg*(g.pellets||1)).toFixed(0)]; })
      .sort((a,b)=>b[1]-a[1]).map(x=>x[0]+':'+x[1]);
    const dpsRank=ALL_ROLES.map(k=>{ const d=CLASSES[k], g=d.gun||d;
      return [d.name, +(g.dmg*(g.pellets||1)/g.cd).toFixed(1)]; })
      .sort((a,b)=>b[1]-a[1]).map(x=>x[0]+':'+x[1]);
    function snapshot(){
      return {map:G.map,door:G.doorHP,phase:G.phase,units:G.units,time:G.time,tick:G.tick,
              result:G.result,counter:G.counter,feed:G.feed,bullets:G.bullets,parts:G.parts,
              corpses:G.corpses,sel:G.selected,mark:G.dispatchMark,kills:G.kills,
              grenades:G.grenades||[],reloadOn:G.reloadOn,behavior:G.behavior};
    }
    function restore(s){
      G.map=s.map; G.doorHP=s.door; G.phase=s.phase; G.units=s.units; G.time=s.time;
      G.tick=s.tick; G.result=s.result; G.counter=s.counter; G.feed=s.feed;
      G.bullets=s.bullets; G.parts=s.parts; G.corpses=s.corpses; G.selected=s.sel;
      G.dispatchMark=s.mark; G.kills=s.kills;
      G.grenades=s.grenades||[];
      if(s.reloadOn!==undefined) G.reloadOn=s.reloadOn;
      if(s.behavior!==undefined) G.behavior=s.behavior;
    }
    function scratchBattle(){
      G.map=new Uint8Array(GW*GH); G.doorHP=new Float32Array(GW*GH);
      G.units=[]; G.counter=1; G.parts=[]; G.bullets=[]; G.corpses=[]; G.feed=[];
      G.grenades=[];
      /* ★ 必须一并重置 spawnArmies 才会设置的字段：
         G.civPos（平民光环位置）、G.stats、G.kills、G.startCount、G.zCap…
         否则「第一次」调用会读到上一局的残留值，
         表现为同一场景首次与后续结果不同（实测 0.1 vs 10.7，间歇性测试失败）。 */
      G.civPos=[]; G.stats={byClass:{}}; G.kills=teams.map(()=>0);
      G.startCount=teams.map(()=>0); G.teamNum=teams.map(()=>0);
      G.infections=0; G.converted=0; G.zCap=9999;
      G.waveIdx=0; G.waveT=0; G.waveLog=[];
      /* 空间网格作废：单位列表整个换掉了 */
      GRID=null; gridDirty=true;
      G.phase='battle'; G.time=0; G.tick=0; G.result=null; G.selected=new Set(); G.dispatchMark=null;
    }
    return {
      counts:{teams:c.teams.map((t,i)=>({name:teams[i].name,type:teams[i].type,map:t.map,total:t.total})),
              grand:c.grand},
      invalid:!validateGrid(editGrid).ok, reason:validateGrid(editGrid).reason||'',
      walkable:{empty,wall,win,doorOpen,doorClosed},
      sight:{empty:empty.sight,wall:wall.sight,win:win.sight,doorClosed:doorClosed.sight,doorOpen:doorOpen.sight},
      los, speedRank, dmgRank, dpsRank,
      infect:{time:INFECT_TIME,fresh:ZOMBIE_FRESH},
      rules:{panicR:PANIC_R,cohesionR:COHESION_R,auraR:CIVILIAN_AURA_R,aura:CIVILIAN_AURA,
             healInterval:HEAL_INTERVAL,healBurst:HEAL_BURST,coverRefresh:COVER_REFRESH,
             dispatchEps:DISPATCH_EPS,infectTime:INFECT_TIME,infectedAvoidR:INFECTED_AVOID_R,
             rs:RS,humanSpeedMul:HUMAN_SPEED_MUL,knockbackPx:TILE,hitPad:HIT_PAD,
             burnTime:BURN_TIME,burnDps:BURN_DPS,shieldWindow:SHIELD_HIT_WINDOW,
             grenadeCd:GRENADE_CD,rocketR:ROCKET_R,grenadeR:GRENADE_R},
      /* ============ 第①项：喷火兵 —— 穿透 + 可刷新灼烧 + 打空才能换弹 ============ */
      burnTest(){
        const s=snapshot(); scratchBattle();
        const out={};
        G.reloadOn=true;
        /* 每段场景前重置 phase/time，避免上一段结束比赛后 stepSim 空转 */
        function seg(){
          G.phase='battle'; G.time=0; G.tick=0; G.result=null;
          G.units=[]; G.bullets=[]; G.grenades=[]; G.parts=[]; G.feed=[];
        }
        /* 注意：喷火兵射程只有 ~94px（缩放后更短），场景必须放得足够近，
           否则火舌在飞到目标前就消失了。这里把敌人放在射程内。 */
        const d=CLASSES.flamer;
        const fl=makeUnit('flamer',0,cx_of(4),cy_of(11),1);
        const z1=makeUnit('zombie',1,cx_of(4)+d.range*0.45,cy_of(11),1);
        const z2=makeUnit('zombie',1,cx_of(4)+d.range*0.85,cy_of(11),2);
        z1.hp=z2.hp=500; z1.maxHp=z2.maxHp=500;
        /* 把僵尸定住：超长攻击间隔 + 每帧回写坐标（下面循环里做），
           否则它们会朝喷火兵走过来，命中几何每帧都在变。 */
        z1.cd=z2.cd=999; z1.spawnT=fl.spawnT=z2.spawnT=0;
        fl.aim=0;
        G.units.push(fl,z1,z2);
        // 一发火舌应该同时点燃两个敌人（穿透 + 灼烧）
        const mag0=fl.magLeft;
        fireWith(fl,CLASSES.flamer); spendShot(fl);
        fl.cd=999;                                   // 关掉自动连发，让读数可预测
        out.piercedHits=G.bullets.length;
        out.burnFlag=!!(G.bullets[0]&&G.bullets[0].burn);
        out.pierceVal=G.bullets[0]?G.bullets[0].pierce:null;
        /* 火舌 bspeed=430，飞到最远靶（~80px）约需 12 帧；给足 20 帧确保穿过两人。
           cd 已设成 999，这段时间不会再有第二发干扰读数。 */
        for(let i=0;i<20;i++){
          z1.x=cx_of(4)+d.range*0.45; z1.y=cy_of(11);      // 钉住目标，稳定命中几何
          z2.x=cx_of(4)+d.range*0.85; z2.y=cy_of(11);
          stepSim(1/60);
        }
        out.bulletsLeftAfter=G.bullets.length;
        out.hitBoth=(z1.burnT>0&&z2.burnT>0);
        out.burnT1=+z1.burnT.toFixed(2); out.burnT2=+z2.burnT.toFixed(2);
        out.ignitedBoth=(z1.burnT>0&&z2.burnT>0);
        out.magSpent=mag0-fl.magLeft;
        /* 可刷新、不叠加：记录当前剩余时间，再点一次，剩余时间应回到 BURN_TIME 附近而非翻倍 */
        const before=z1.burnT;
        z1.x=fl.x+d.range*0.45; z1.y=fl.y; z2.x=fl.x+d.range*0.85; z2.y=fl.y;
        G.bullets=[]; fl.cd=0; fl.aim=0;
        fireWith(fl,CLASSES.flamer); spendShot(fl);
        fl.cd=999;
        for(let i=0;i<20;i++){ z1.x=fl.x+d.range*0.45; z2.x=fl.x+d.range*0.85; stepSim(1/60); }
        out.refreshBefore=+before.toFixed(2); out.refreshAfter=+z1.burnT.toFixed(2);
        out.noStack=z1.burnT<=BURN_TIME+0.01&&z1.burnT>0;
        /* 灼烧持续扣血：把两个僵尸都挪远并定住，只让灼烧跳，不允许再被火舌打中 */
        for(const z of [z1,z2]){ z.x=fl.x-400; z.y=fl.y-400; z.cd=999; }
        const hp0=z1.hp;
        const t0=z1.burnT;
        for(let i=0;i<60;i++) stepSim(1/60);
        out.burnDamaged=+(hp0-z1.hp).toFixed(1);
        out.burnTickDown=+(t0-z1.burnT).toFixed(2);
        out.burnTicks=out.burnDamaged>0&&out.burnTickDown>0.9;
        /* 打空才能换弹：没打空时 canReload 必须为 false */
        const fl2=makeUnit('flamer',0,cx_of(4),cy_of(15),2);
        fl2.spawnT=0; fl2.magLeft=CLASSES.flamer.mag; G.units.push(fl2);
        out.reloadWhenFull=canReload(fl2);
        fl2.magLeft=1; out.reloadWhenPartly=canReload(fl2);
        fl2.magLeft=0; out.reloadWhenEmpty=canReload(fl2);
        out.emptyOnly=!!CLASSES.flamer.emptyOnly;
        restore(s); return out;
      },
      /* ============ 第②项：火箭兵 —— 弹容 1 + 命中即爆 / 到射程自爆 ============ */
      rocketTest(){
        const s=snapshot(); scratchBattle();
        const out={};
        G.reloadOn=false;
        out.mag=CLASSES.rocketeer.mag;
        /* 注意（移交文档 8.4 的坑）：每段场景都要重置 phase/time，
           否则上一段把某一方打光后 phase 变 result，后面的 stepSim 全部空转。 */
        function seg(){
          G.phase='battle'; G.time=0; G.tick=0; G.result=null;
          G.units=[]; G.bullets=[]; G.grenades=[]; G.parts=[]; G.feed=[];
        }
        // 命中即爆
        const rk=makeUnit('rocketeer',0,cx_of(6),cy_of(11),1);
        const zo=makeUnit('zombie',1,cx_of(6)+CLASSES.rocketeer.range*0.5,cy_of(11),1);
        zo.hp=zo.maxHp=400; zo.cd=999; zo.spawnT=0; rk.spawnT=0; rk.aim=0;
        G.units.push(rk,zo);
        fireWith(rk,CLASSES.rocketeer);
        out.bulletsAfterFire=G.bullets.length;
        out.isRocket=!!(G.bullets[0]&&G.bullets[0].rocket);
        for(let i=0;i<80;i++) stepSim(1/60);
        out.hitBoomDmg=+(400-zo.hp).toFixed(1);
        out.rocketGone=G.bullets.filter(b=>b.rocket).length;
        // 打空 → 到最大射程自爆（对空处发射）
        seg();
        const rk2=makeUnit('rocketeer',0,cx_of(6),cy_of(11),2);
        rk2.spawnT=0; rk2.aim=Math.PI;               // 朝左空旷处
        /* 必须留一个存活敌人，否则 checkEnd() 立刻判胜、stepSim 停摆（移交文档 6 节坑①）。
           把它放在很远处，且速度设 0.01 定住，不影响火箭飞行。
           注意别放在火箭的飞行路线上（火箭朝左飞，敌人放右侧）。 */
        const watcher=makeUnit('zombie',1,VW-TILE*2,cy_of(2),99);
        watcher.spawnT=0; watcher.cd=999;
        G.units.push(rk2,watcher);
        fireWith(rk2,CLASSES.rocketeer);
        const flew=G.bullets.length;
        for(let i=0;i<300;i++) stepSim(1/60);
        out.emptyShotFired=flew;
        out.emptyShotCleared=G.bullets.filter(b=>b.rocket).length;
        out.emptyPhase=G.phase;
        // 范围伤害：爆炸应波及爆心附近多人，且远端伤害更低。
        // 注意：火箭会在碰到第一个敌人时引爆，所以两个靶子的间距必须落在 ROCKET_R 之内。
        seg();
        const rk3=makeUnit('rocketeer',0,cx_of(6),cy_of(11),3);
        const hitX=cx_of(6)+CLASSES.rocketeer.range*0.5;
        const near=makeUnit('zombie',1,hitX,cy_of(11),10);                 // 引爆点
        const far =makeUnit('zombie',1,hitX+ROCKET_R*0.6,cy_of(11),11);    // 爆炸半径内侧
        near.hp=near.maxHp=600; far.hp=far.maxHp=600;
        near.cd=far.cd=999; rk3.spawnT=near.spawnT=far.spawnT=0; rk3.aim=0;
        near.behavior='hold'; far.behavior='hold';
        G.units.push(rk3,near,far);
        fireWith(rk3,CLASSES.rocketeer);
        out.phase0=G.phase;
        out.unitsAtFire=G.units.length;
        for(let i=0;i<80;i++) stepSim(1/60);
        out.phase1=G.phase;
        out.timeAfter=+G.time.toFixed(2);
        out.bulletsLeft=G.bullets.length;
        out.nearDmg=+(600-near.hp).toFixed(1);
        out.farDmg=+(600-far.hp).toFixed(1);
        out.falloff=out.farDmg<out.nearDmg;
        out.splashed=out.nearDmg>0&&out.farDmg>0;
        restore(s); return out;
      },
      /* ============ 第③项：步枪手手雷 —— 长冷却 + 抛物线 + 范围伤害 ============ */
      grenadeTest(){
        const s=snapshot(); scratchBattle();
        const out={};
        G.grenades=[];
        const rf=makeUnit('rifle',0,cx_of(6),cy_of(11),1);
        rf.spawnT=0;
        G.units.push(rf);
        out.cdInit=+rf.throwCd.toFixed(2);
        out.cooldown=GRENADE_CD;
        // 抛物线：手雷有飞行时间，落地前不应结算
        const tx=cx_of(12), ty=cy_of(11);
        throwGrenade(rf,tx,ty);
        out.spawned=G.grenades.length;
        out.flight=+G.grenades[0].flight.toFixed(2);
        out.throwAnim=+rf.throwing.toFixed(2);
        out.cdAfterThrow=+rf.throwCd.toFixed(2);
        const zs=[];
        for(let i=0;i<3;i++){
          const z=makeUnit('zombie',1,tx+(i-1)*14,ty,10+i);
          z.hp=z.maxHp=400; z.cd=999; z.spawnT=0; G.units.push(z); zs.push(z);
        }
        stepSim(1/60);
        out.movedMid=+G.grenades[0].t.toFixed(3);
        out.notYetExploded=G.grenades.length;
        for(let i=0;i<120;i++) stepSim(1/60);
        out.cleared=G.grenades.length;
        out.dmgEach=zs.map(z=>+(400-z.hp).toFixed(1));
        out.hitMultiple=zs.filter(z=>z.hp<400).length;
        out.isSplash=out.hitMultiple>=2;
        // 冷却内不会再次投掷
        out.canThrowAgain=rf.throwCd<=0;
        restore(s); return out;
      },
      /* ============ 第④项：盾卫 —— 盾击 / 击退 / 2 秒未受击才开枪 ============ */
      shieldTest(){
        const s=snapshot(); scratchBattle();
        const out={};
        const d=CLASSES.shieldman;
        out.hasShield=!!d.shield;
        out.window=SHIELD_HIT_WINDOW;
        // 「未受击」门禁：受击后 2 秒内不能开枪
        const sh=makeUnit('shieldman',0,cx_of(6),cy_of(11),1);
        sh.spawnT=0; G.units.push(sh);
        out.mayShootFresh=shieldMayShoot(sh);
        sh.hurtT=SHIELD_HIT_WINDOW;  out.mayShootHit=shieldMayShoot(sh);
        sh.hurtT=0.001;              out.mayShootAlmost=shieldMayShoot(sh);
        sh.hurtT=0;                  out.mayShootRecovered=shieldMayShoot(sh);
        out.otherClassUnaffected=shieldMayShoot({cls:'rifle',hurtT:5});
        // damage() 会设置 hurtT
        const sh2=makeUnit('shieldman',0,cx_of(6),cy_of(15),2);
        sh2.spawnT=0; G.units.push(sh2);
        damage(sh2,5,{team:1});
        out.hurtTSetByDamage=+sh2.hurtT.toFixed(2);
        // 盾击：把僵尸击退（pushV 生效 → 距离拉开）并造成少量伤害
        G.units=[];
        const sh3=makeUnit('shieldman',0,cx_of(10),cy_of(11),3);
        const zb=makeUnit('zombie',1,cx_of(10)+1.2*d.radius+d.radius,cy_of(11),1);
        zb.cd=999; zb.spawnT=0; sh3.spawnT=0;
        G.units.push(sh3,zb);
        const d0=Math.hypot(zb.x-sh3.x,zb.y-sh3.y);
        const hp0=zb.hp;
        const bashed=shieldBash(sh3,d,zb,d0);
        out.bashed=bashed;
        out.bashDmg=+(hp0-zb.hp).toFixed(1);
        out.pushV=+Math.hypot(zb.pushVx||0,zb.pushVy||0).toFixed(0);
        for(let i=0;i<45;i++) stepSim(1/60);
        out.distBefore=+d0.toFixed(1);
        out.distAfter=+Math.hypot(zb.x-sh3.x,zb.y-sh3.y).toFixed(1);
        out.knockedBack=out.distAfter>out.distBefore+6;
        // 正面之外（背后）不应被盾击
        G.units=[];
        const sh4=makeUnit('shieldman',0,cx_of(10),cy_of(11),4);
        sh4.shieldDir=0; sh4.spawnT=0;
        const behind={x:sh4.x-20,y:sh4.y,alive:true,radius:CLASSES.zombie.radius,hp:100,maxHp:100};
        out.bashBehind=shieldBash(sh4,d,behind,20);
        restore(s); return out;
      },
      /* ============ 第⑤项：人类更易主动后退 + 移速上调 ============ */
      panicTest(){
        const s=snapshot(); scratchBattle();
        const out={};
        out.panicR=PANIC_R;
        out.speedMul=HUMAN_SPEED_MUL;
        out.humanSpeeds=ROLES_H.map(k=>[CLASSES[k].name,CLASSES[k].speed]);
        out.zombieSpeeds=ROLES_Z.map(k=>[CLASSES[k].name,CLASSES[k].speed]);
        /* 速度对照：人类移速确实被上调过（对比未乘系数的原始值） */
        out.baseSpeeds=ROLES_H.map(k=>[CLASSES[k].name,Math.round(CLASSES[k].speed/HUMAN_SPEED_MUL*10)/10]);
        out.allBuffed=ROLES_H.every(k=>CLASSES[k].speed>Math.round(CLASSES[k].speed/HUMAN_SPEED_MUL*10)/10-0.06);
        /* 后撤「意图」：把僵尸速度设为 0 定住，只看人类是否主动远离。
           这样测的是行为逻辑本身，不受「僵尸更快所以追得上」的干扰。 */
        const h=makeUnit('rifle',0,cx_of(20),cy_of(11),1);
        const z=makeUnit('zombie',1,cx_of(20)+PANIC_R-8,cy_of(11),1);
        h.behavior='hold'; h.spawnT=z.spawnT=0;
        z.cd=999;
        G.units.push(h,z);
        const d0=Math.hypot(h.x-z.x,h.y-z.y);
        for(let i=0;i<120;i++){
          z.x=cx_of(20)+PANIC_R-8; z.y=cy_of(11);   // 定住僵尸
          stepSim(1/60);
        }
        const d1=Math.hypot(h.x-z.x,h.y-z.y);
        out.startDist=+d0.toFixed(1); out.endDist=+d1.toFixed(1);
        out.retreatIntent=d1>d0+10;
        out.beyondPanic=d1>PANIC_R;
        /* 僵尸贴脸时也必须无条件后撤（本能优先级最高） */
        G.units=[];
        const h2=makeUnit('rifle',0,cx_of(20),cy_of(11),2);
        const z2=makeUnit('zombie',1,cx_of(20)+24,cy_of(11),2);
        h2.behavior='push'; h2.spawnT=z2.spawnT=0; z2.cd=999;
        G.units.push(h2,z2);
        const away0={x:h2.x-z2.x,y:h2.y-z2.y};
        const a0=Math.hypot(away0.x,away0.y);
        for(let i=0;i<90;i++){
          z2.x=cx_of(20)+24; z2.y=cy_of(11);
          stepSim(1/60);
        }
        const mv={x:h2.x-(cx_of(20)),y:h2.y-cy_of(11)};
        out.awayMove=+(mv.x*away0.x/a0+mv.y*away0.y/a0).toFixed(1);
        out.panicBeatsPush=out.awayMove>10;
        /* 速度对照结论（供平衡参考）：僵尸是否普遍快于人类 */
        out.slowerThanZombie=ROLES_H.filter(k=>CLASSES[k].speed<=CLASSES.zombie.speed).map(k=>CLASSES[k].name);
        restore(s); return out;
      },
      /* ============ 第⑥项：全体缩小（半径 ×RS） ============ */
      scaleTest(){
        const s=snapshot();
        const out={};
        out.rs=RS;
        out.radii=ALL_ROLES.map(k=>[CLASSES[k].name,CLASSES[k].radius]);
        out.maxRadius=Math.max.apply(null,ALL_ROLES.map(k=>CLASSES[k].radius));
        // 缩放后间距 / 掩体扫描 / 咽喉探测等常量都应同步变小
        out.cohesionDead=COHESION_DEAD;
        out.infectedAvoidR=INFECTED_AVOID_R;
        out.doorDodgeR=DOOR_DODGE_R;
        out.auraR=CIVILIAN_AURA_R;
        out.coverScan=COVER_SCAN;
        out.hitPad=HIT_PAD;
        // 实测：两个单位靠在一起时不会重叠（分离半径 = r1+r2）
        scratchBattle();
        const a=makeUnit('rifle',0,cx_of(10),cy_of(11),1);
        const b=makeUnit('rifle',0,cx_of(10)+1,cy_of(11),2);
        a.spawnT=b.spawnT=0;
        G.units.push(a,b);
        for(let i=0;i<60;i++) stepSim(1/60);
        const dd=Math.hypot(a.x-b.x,a.y-b.y);
        out.sepDist=+dd.toFixed(1);
        out.sepNeeded=+(a.radius+b.radius).toFixed(1);
        out.notOverlapping=dd>=out.sepNeeded-1.5;
        let embed=0;
        for(const u2 of G.units){
          if(!u2.alive) continue;
          const tx2=(u2.x/TILE)|0, ty2=(u2.y/TILE)|0;
          if(!inB(tx2,ty2)||blocksMove(G.map[idx(tx2,ty2)],tx2,ty2,u2.kind)) embed++;
        }
        out.embedded=embed;
        out.noEmbedded=embed===0;
        restore(s); return out;
      },
      /* ============ 动作音效开关（无头环境下必须安全降级） ============ */
      sfxTest(){
        const out={};
        out.names=Object.keys(SFX_RECIPES);
        out.count=out.names.length;
        out.defaultOn=SFX_ON_DEFAULT;
        const on=setSfxEnabled(true), off=setSfxEnabled(false);
        out.toggleOn=on; out.toggleOff=off;
        setSfxEnabled(true);
        sfx('shoot'); sfx('explode');            // 无 AudioContext 时不应抛异常
        out.safeHeadless=true;
        out.hasAudioCtx=(typeof window!=='undefined'&&!!(window.AudioContext||window.webkitAudioContext));
        return out;
      },
      /* ============ 盾卫：正面免疫 + 侧后受伤 ============ */
      shieldTest(){
        const s=snapshot(); scratchBattle();
        const out={};
        const d=CLASSES.shieldman;
        out.hasShield=!!d.shield;
        out.window=SHIELD_HIT_WINDOW;
        out.radius=d.radius;
        out.sameAsRifle=d.radius===CLASSES.rifle.radius;
        const sh=makeUnit('shieldman',0,cx_of(6),cy_of(11),1);
        sh.spawnT=0; sh.shieldDir=0; G.units.push(sh);
        out.mayShootFresh=shieldMayShoot(sh);
        /* 注意：正面免疫意味着「正面挨打」不会设置 hurtT，
           所以这里直接操作 hurtT 来验证射击门禁本身。 */
        sh.hurtT=SHIELD_HIT_WINDOW;  out.mayShootHit=shieldMayShoot(sh);
        sh.hurtT=0.001;              out.mayShootAlmost=shieldMayShoot(sh);
        sh.hurtT=0;                  out.mayShootRecovered=shieldMayShoot(sh);
        out.otherClassUnaffected=shieldMayShoot({cls:'rifle',hurtT:5});
        /* 正面（来源在盾牌朝向内）→ 应完全免疫 */
        const hp0=sh.hp;
        damage(sh,50,{team:1,x:sh.x+40,y:sh.y});        // 正右方，shieldDir=0
        out.frontImmune=(sh.hp===hp0);
        out.frontDamage=+(hp0-sh.hp).toFixed(1);
        /* 侧后（来源在背后）→ 应受伤，并且会记录受击时间戳 */
        const hp1=sh.hp;
        sh.hurtT=0;
        damage(sh,50,{team:1,x:sh.x-40,y:sh.y});        // 正左方 = 背后
        out.sideDamage=+(hp1-sh.hp).toFixed(1);
        out.hurtTSetByDamage=+sh.hurtT.toFixed(2);
        /* 非盾卫：同样伤害应全额生效 */
        const rf=makeUnit('rifle',0,cx_of(6),cy_of(15),2); rf.spawnT=0; G.units.push(rf);
        const hp2=rf.hp;
        damage(rf,50,{team:1,x:rf.x+40,y:rf.y});
        out.otherUnaffected=Math.abs((hp2-rf.hp)-50)<0.01;
        /* 盾牌缓慢转向：角速度有限 */
        out.turn=SHIELD_TURN;
        /* 盾击 */
        G.units=[];
        const sh3=makeUnit('shieldman',0,cx_of(10),cy_of(11),3);
        const zb=makeUnit('zombie',1,cx_of(10)+1.2*d.radius+d.radius,cy_of(11),1);
        zb.cd=999; zb.spawnT=0; sh3.spawnT=0;
        G.units.push(sh3,zb);
        const dd0=Math.hypot(zb.x-sh3.x,zb.y-sh3.y);
        const zhp=zb.hp;
        out.bashed=shieldBash(sh3,d,zb,dd0);
        out.bashDmg=+(zhp-zb.hp).toFixed(1);
        out.pushV=+Math.hypot(zb.pushVx||0,zb.pushVy||0).toFixed(0);
        /* 新增：硬直（打断进攻）与盾牌不可破坏 */
        out.bashStun=+(zb.stunT||0).toFixed(2);
        out.unbreakable=!!SHIELD_UNBREAKABLE;
        out.sideDR=SHIELD_DR_SIDE;
        out.shieldArc=SHIELD_ARC;
        out.shieldTurn=SHIELD_TURN;
        out.shieldHP=CLASSES.shieldman.hp;
        for(let i=0;i<45;i++) stepSim(1/60);
        out.knockedBack=Math.hypot(zb.x-sh3.x,zb.y-sh3.y)>dd0+6;
        out.distBefore=+dd0.toFixed(1);
        out.distAfter=+Math.hypot(zb.x-sh3.x,zb.y-sh3.y).toFixed(1);
        const sh4=makeUnit('shieldman',0,cx_of(10),cy_of(11),4);
        sh4.shieldDir=0; sh4.spawnT=0;
        out.bashBehind=shieldBash(sh4,d,{x:sh4.x-20,y:sh4.y,alive:true,radius:CLASSES.zombie.radius,hp:100,maxHp:100},20);
        /* ============ 盾牌挡住时「连感染一起免疫」 ============
           正面：僵尸在盾牌朝向内撕咬 → 不该被感染
           背后：僵尸从侧后咬 → 应当被感染 */
        G.units=[];
        const fw=makeUnit('shieldman',0,cx_of(20),cy_of(11),10); fw.spawnT=0; fw.shieldDir=0;
        const zf=makeUnit('zombie',1,fw.x+fw.radius+CLASSES.zombie.radius,cy_of(11),11);
        zf.spawnT=0; zf.cd=999;
        const watcher=makeUnit('rifle',0,cx_of(3),cy_of(20),12); watcher.spawnT=0; watcher.behavior='hold';
        G.units.push(fw,zf,watcher);
        out.frontBlocked=shieldBlocked(fw,zf);
        /* 正面命中：不掉血也不感染（用很高的感染概率确保能测出来） */
        for(let i=0;i<80;i++){ zf.x=fw.x+fw.radius+CLASSES.zombie.radius; zf.y=fw.y; stepSim(1/60); }
        out.frontNoInfect=(fw.infect<=0);
        out.frontNoDamage=(fw.hp===fw.maxHp);
        /* 背后命中：应当受伤且被感染 */
        G.units=[];
        const bw=makeUnit('shieldman',0,cx_of(20),cy_of(11),20); bw.spawnT=0; bw.shieldDir=0;
        const zb2=makeUnit('zombie',1,bw.x-bw.radius-CLASSES.zombie.radius,cy_of(11),21);
        zb2.spawnT=0; zb2.cd=0;
        const w2=makeUnit('rifle',0,cx_of(3),cy_of(20),22); w2.spawnT=0; w2.behavior='hold';
        G.units.push(bw,zb2,w2);
        out.backNotBlocked=!shieldBlocked(bw,zb2);
        for(let i=0;i<80&&bw.infect<=0;i++){ zb2.x=bw.x-bw.radius-CLASSES.zombie.radius; zb2.y=bw.y; zb2.cd=0; stepSim(1/60); }
        out.backInfected=(bw.infect>0);
        restore(s); return out;
      },
      /* ============ 僵尸破拆：门 / 窗 / 墙 ============ */
      breakTest(){
        const s=snapshot(); scratchBattle();
        const out={};
        const d=CLASSES.zombie;
        /* 造一格门、一格窗、一格墙，各放一只僵尸在旁边 */
        const mk=(t,hp,x,y)=>{
          const gx=(x/TILE)|0, gy=(y/TILE)|0;
          G.map[idx(gx,gy)]=t;
          if(t===DOOR) G.doorHP[idx(gx,gy)]=hp;
          if(t===WIN)  G.winHP[idx(gx,gy)]=hp;
          return {gx:gx,gy:gy};
        };
        /* 门 */
        const dcell=mk(DOOR,DOOR_MAX,cx_of(14),cy_of(11));
        const z1=makeUnit('zombie',1,cx_of(13),cy_of(11),1); z1.spawnT=0; z1.cd=0;
        /* 窗 */
        const wcell=mk(WIN,WIN_MAX,cx_of(14),cy_of(15));
        const z2=makeUnit('zombie',1,cx_of(13),cy_of(15),2); z2.spawnT=0; z2.cd=0;
        /* 墙（不可破坏） */
        const wallcell=mk(WALL,0,cx_of(14),cy_of(7));
        const z3=makeUnit('zombie',1,cx_of(13),cy_of(7),3); z3.spawnT=0; z3.cd=0;
        /* 留一个活着的「目标」让僵尸有方向感 */
        const prey=makeUnit('rifle',0,cx_of(20),cy_of(11),9); prey.spawnT=0; prey.behavior='hold';
        G.units.push(z1,z2,z3,prey);
        /* 反复调用破拆判定，模拟持续攻击 */
        for(let i=0;i<400;i++){
          const a=nearestBreakable(z1,prey); if(a) breakTile(a.tx,a.ty,d.dmg*1.5,z1);
          const b=nearestBreakableAny(z2); if(b) breakTile(b.tx,b.ty,d.dmg*1.5,z2);
          const c=nearestBreakableAny(z3); if(c) breakTile(c.tx,c.ty,d.dmg*1.5,z3);
        }
        out.doorBroken = G.doorHP[idx(dcell.gx,dcell.gy)]<=0;
        out.winBroken  = G.winHP[idx(wcell.gx,wcell.gy)]<=0;
        out.winBecameEmpty = G.map[idx(wcell.gx,wcell.gy)]===EMPTY;
        out.wallIntact = G.map[idx(wallcell.gx,wallcell.gy)]===WALL;
        out.breakScan = BREAK_SCAN;
        restore(s); return out;
      },
      /* ============ 团队态势：被包围 / 火力冗余 ============ */
      teamSituationTest(){
        const s=snapshot(); scratchBattle();
        const out={};
        /* ① 造包围：人 1 个在中，僵尸 8 个围一圈 */
        const h=makeUnit('rifle',0,cx_of(20),cy_of(11),1); h.spawnT=0;
        G.units.push(h);
        for(let i=0;i<8;i++){
          const a=i/8*TAU;
          const z=makeUnit('zombie',1,h.x+Math.cos(a)*90,h.y+Math.sin(a)*90,10+i);
          z.spawnT=0; z.cd=999; G.units.push(z);
        }
        gridMarkDirty(); gridEnsure();
        const sit=teamSituation(h);
        out.surroundedDetected=sit.surrounded;
        out.escapeDir=sit.escapeDir?{x:+sit.escapeDir.x.toFixed(2),y:+sit.escapeDir.y.toFixed(2)}:null;
        /* 诊断用：把每个方向最近僵尸距离带出来，便于核对判定阈值 */
        out.dirNear=(sit.diag&&sit.diag.near?sit.diag.near.map(d=>d===1e9?-1:Math.round(d)):null);
        out.closed=sit.diag?sit.diag.closed:null;
        out.unitsAtTest=G.units.length;
        /* ② 造火力冗余：很多友军打同一个敌人 */
        G.units=[];
        const foe=makeUnit('zombie',1,cx_of(20),cy_of(11),99); foe.spawnT=0; foe.cd=999;
        G.units.push(foe);
        for(let i=0;i<8;i++){
          const a=i/8*TAU;
          const f=makeUnit('rifle',0,foe.x+Math.cos(a)*70,foe.y+Math.sin(a)*70,100+i);
          f.spawnT=0; f.targetRef=foe; f.target=foe;
          G.units.push(f);
        }
        gridMarkDirty(); gridEnsure();
        const sit2=teamSituation(G.units[1]);
        out.spareDetected=sit2.spare;
        out.friendsNear=G.units.length-1;
        restore(s); return out;
      },
      /* ============ 切预设后计划是否立即清空 ============ */
      instantBehaviorTest(labels,beh){
        const out={};
        G.selected.clear();
        for(const u of G.units){
          if(u.alive&&labels.indexOf(u.label)>=0) G.selected.add(u.id);
        }
        /* 先塞一些「旧计划」进去，验证会被清掉 */
        let touched=0;
        for(const u of G.units){
          if(!u.alive||!G.selected.has(u.id)) continue;
          u.planT=99; u.plan='cover'; u.targetT=99; u.pathT=99; u.coverT=99;
          u.path=[{x:u.x+50,y:u.y}]; u.cover={x:u.x+40,y:u.y};
          touched++;
        }
        applyBehavior(beh);
        let planCleared=true, targetCleared=true, behSet=true;
        for(const u of G.units){
          if(!u.alive||!G.selected.has(u.id)) continue;
          if(u.planT!==0||u.plan) planCleared=false;
          if(u.targetT!==0||u.pathT!==0||u.coverT!==0||u.path||u.cover) targetCleared=false;
          if(u.behavior!==beh) behSet=false;
        }
        out.touched=touched; out.planCleared=planCleared;
        out.targetCleared=targetCleared; out.behSet=behSet;
        G.selected.clear();
        return out;
      },
      forceInfect(label,from){
        const u=G.units.find(x=>x.alive&&x.label===label); if(!u) return null;
        infect(u,from===undefined?null:from); return u.infect;
      },
      forceBehavior(labels,beh){
        for(const u of G.units){ if(labels.indexOf(u.label)>=0) u.behavior=beh; }
      },
      /* 走真实的框选→改预设路径：select 为空时改全局，否则只改选中那批 */
      applyBehaviorProbe(labels,beh){
        G.selected.clear();
        for(const u of G.units){ if(u.alive&&labels.indexOf(u.label)>=0) G.selected.add(u.id); }
        applyBehavior(beh);
        const all=G.units.filter(u=>u.alive&&u.kind==='h');   // 预设只作用于人类型
        const sel=all.filter(u=>G.selected.has(u.id)), unsel=all.filter(u=>!G.selected.has(u.id));
        return {global:G.behavior, selected:sel.length,
                selSet:sel.filter(u=>u.behavior===beh).length,
                unselOverridden:unsel.filter(u=>u.behavior!=null).length,
                unselFollowGlobal:unsel.filter(u=>(u.behavior||G.behavior)===G.behavior).length};
      },
      /* 换弹：开启后弹匣打空会进入换弹，期间不能开火 */
      reloadTest(on){
        const s=snapshot();
        scratchBattle();
        const prevOn=G.reloadOn;
        CLASSES.rifle.mag=3; CLASSES.rifle.reload=2.0;
        const h=makeUnit('rifle',0,cx_of(10),cy_of(11),1); h.spawnT=0; h.behavior='hold';
        const z=makeUnit('zombie',1,cx_of(14),cy_of(11),1); z.spawnT=0;
        G.units.push(h,z);
        const zsp=CLASSES.zombie.speed; CLASSES.zombie.speed=0.01;
        G.reloadOn=on===undefined?true:!!on;
        let sawEmpty=false, sawReload=false, minMag=99;
        for(let i=0;i<260;i++){
          stepSim(1/60);
          minMag=Math.min(minMag,h.magLeft);
          if(h.magLeft===0) sawEmpty=true;
          if(h.reloadT>0) sawReload=true;
          if(sawEmpty&&sawReload&&h.magLeft>0) break;
        }
        const out={sawEmpty, sawReload, refilled:h.magLeft>0, minMag, mag:CLASSES.rifle.mag};
        G.reloadOn=prevOn;
        CLASSES.rifle.mag=DEFAULT_STATS.rifle.mag; CLASSES.rifle.reload=DEFAULT_STATS.rifle.reload;
        CLASSES.zombie.speed=zsp;
        restore(s);
        return out;
      },
      /* 无战斗时主动换弹：视野内没人也会把弹匣补满 */
      idleReloadTest(){
        const s=snapshot();
        const reloadWasOn=G.reloadOn;
        scratchBattle();
        const h=makeUnit('rifle',0,cx_of(5),cy_of(11),1); h.spawnT=0; h.behavior='hold';
        const far=makeUnit('zombie',1,cx_of(38),cy_of(20),1); far.spawnT=0;   // 远远的敌人，看不见
        G.units.push(h,far);
        const zsp=CLASSES.zombie.speed; CLASSES.zombie.speed=0.01;
        G.reloadOn=true;
        h.magLeft=5;
        const before=h.magLeft;
        let started=false;
        for(let i=0;i<240;i++){ stepSim(1/60); if(h.reloadT>0) started=true; if(magFull(h)) break; }
        const out={before, after:h.magLeft, started, mag:CLASSES.rifle.mag};
        G.reloadOn=reloadWasOn;
        CLASSES.zombie.speed=zsp;
        restore(s);
        return out;
      },
      /* 霰弹枪逐发装填 + 无战斗时主动换弹 */
      shellReloadTest(){
        const s=snapshot();
        const reloadWasOn=G.reloadOn;
        scratchBattle();
        const zs=makeUnit('zombie',1,cx_of(20),cy_of(2),1); zs.spawnT=0;   // 有个敌人，但人类视野内无战事时先换弹
        const h=makeUnit('shotgun',0,cx_of(5),cy_of(20),1); h.spawnT=0; h.behavior='hold';
        G.units.push(h,zs);
        const zsp=CLASSES.zombie.speed; CLASSES.zombie.speed=0.01;
        G.reloadOn=true;
        h.magLeft=0; h.reloadT=0;
        const seq=[];
        for(let i=0;i<720;i++){
          stepSim(1/60);
          if(i%60===59) seq.push(h.magLeft);
        }
        const out={seq:seq, full:CLASSES.shotgun.mag, reloadT:+h.reloadT.toFixed(2),
                   fullAtEnd:h.magLeft===CLASSES.shotgun.mag};
        G.reloadOn=reloadWasOn;
        CLASSES.zombie.speed=zsp;
        restore(s);
        return out;
      },
      /* 大胃袋死亡爆裂：周围敌人受伤且可被感染 */
      burstTest(){
        const s=snapshot();
        scratchBattle();
        const b=makeUnit('bigbelly',1,cx_of(20),cy_of(11),1); b.spawnT=0;
        const v1=makeUnit('rifle',0,cx_of(21),cy_of(11),1);  v1.spawnT=0;
        const v2=makeUnit('rifle',0,cx_of(24),cy_of(11),2);  v2.spawnT=0;   // 远处，不该被波及
        G.units.push(b,v1,v2);
        const hp1=v1.hp, hp2=v2.hp;
        const cfgChance=CLASSES.bigbelly.deathBurst.infect;
        CLASSES.bigbelly.deathBurst.infect=1;           // 先确定性验证「会感染」这条链路
        damage(b,9999,null);                           // 击杀大胃袋
        const v1Infect=v1.infect>0;
        CLASSES.bigbelly.deathBurst.infect=cfgChance;
        const out={v1Damaged:hp1-v1.hp, v2Damaged:hp2-v2.hp, v1Infect:v1Infect,
                   chance:cfgChance, r:CLASSES.bigbelly.deathBurst.r,
                   dmg:CLASSES.bigbelly.deathBurst.dmg};
        restore(s);
        return out;
      },
      /* 终极母体：一口咬下去立刻感染成功（尸变） */
      instantInfectTest(){
        const s=snapshot();
        scratchBattle();
        /* 测的是「终极母体命中即刻感染」这条机制本身，
           所以必须把被咬者固定在射程内 —— 否则它会因为 panic 本能后撤
           （人类移速已上调，跑得比母体快）而永远咬不到，
           测试结果就会随机。这里每帧把双方坐标钉回原位。 */
        const m=makeUnit('umother',1,cx_of(20),cy_of(11),1); m.spawnT=0;
        const v=makeUnit('rifle',0,cx_of(20)+22,cy_of(11),1); v.spawnT=0;
        const keep=makeUnit('rifle',0,cx_of(3),cy_of(20),2); keep.spawnT=0; keep.behavior='hold';
        G.units.push(m,v,keep);
        const mx0=m.x, my0=m.y, vx0=v.x, vy0=v.y;
        let converted=false;
        for(let i=0;i<180;i++){
          m.x=mx0; m.y=my0; v.x=vx0; v.y=vy0;      // 钉住，保证一直贴身
          m.hp=m.maxHp;                             // 母体不能被反杀，隔离变量
          stepSim(1/60);
          if(v.kind!=='h'){ converted=true; break; }
        }
        const out={converted, team:v.team, cls:v.cls, infect:v.infect};
        restore(s);
        return out;
      },
      /* 终极母体一次孵化两只、累计上限 20 */
      twinHatchTest(){
        const s=snapshot();
        scratchBattle();
        CLASSES.umother.hatch=0.5;
        const m=makeUnit('umother',1,cx_of(30),cy_of(5),1); m.spawnT=0; m.children=0; m.childT=0.4;
        const keep=makeUnit('rifle',0,cx_of(3),cy_of(20),1); keep.spawnT=0;   // 别让比赛提前结束
        keep.behavior='hold';
        G.units.push(m,keep);
        const before=G.units.length;
        for(let i=0;i<180;i++) stepSim(1/60);
        const out={hatched:G.units.length-before, children:m.children, maxChild:CLASSES.umother.maxChild,
                   twins:CLASSES.umother.twins};
        CLASSES.umother.hatch=DEFAULT_STATS.umother.hatch;
        restore(s);
        return out;
      },
      /* 同伴被感染时非医疗兵会躲开（医疗兵不躲）
         ★ 测「本能方向」而不是「净位移」：
         净位移会被 separation（分离力）、寻路抖动、群体挤压污染，
         导致同一场景因 id 分配/PRNG 状态不同而漂移（实测 0.1 vs 10.7）。
         这里把被考察者单独放在空地上（场内没有其他单位），
         只留「被感染的同伴」一个邻居，直接看它第一帧往哪边走。
         这样测的是 AI 决策本身，不受群集物理干扰，结果稳定。 */
      avoidInfectedTest(){
        const _avoidDbg=[];
        const s=snapshot();
        const holdWas=HOLD_SPOT_ON; HOLD_SPOT_ON=false;
        const rngWas=rng;
        const reloadWas=G.reloadOn;
        const run=(cls)=>{
          rng=mulberry32(0x5eed1234);
          /* ★ 必须固定相关全局开关，否则本探针的结果会随「之前跑过哪些测试」而变：
             前面若有 QB.reload(true) 的段落，会把 G.reloadOn 留成 true，
             步枪手于是走进换弹分支（reloadT 影响 cd 与移动），
             同一个场景第一次与后续调用结果不同（实测 0.1 vs 10.7）。
             本探针测的是「躲开被感染者」这一条本能，与换弹无关，故固定为关。 */
          G.reloadOn=false;
          scratchBattle();
          G.reloadOn=false;                 // scratchBattle 之后再固定一次
          const v=makeUnit('rifle',0,cx_of(20),cy_of(11),9); v.spawnT=0; v.behavior='hold';
          const a=makeUnit(cls,0,cx_of(21),cy_of(11),2);     a.spawnT=0; a.behavior='free';
          if(CLASSES[a.cls].heal) a.healCd=9999;
          /* ★ 清掉目标搜索缓存：
             tickHuman/tickZombie 有 TARGET_REFRESH 缓存（大编制性能优化），
             若首次调用时缓存状态与后续不同，单位会「前几帧站着不动」，
             导致净位移差一个量级（实测 0.1 vs 10.7，表现为间歇性测试失败）。
             本探针测的是躲开本能，与索敌缓存无关，统一清零保证可复现。 */
          for(const x of [v,a]){ x.targetT=0; x.targetRef=null; x.target=null; }
          G.units.push(v,a);
          infect(v,null);
          const vx0=v.x, vy0=v.y, ax0=a.x, ay0=a.y;
          const d0=Math.hypot(ax0-vx0,ay0-vy0);
          const ux=(ax0-vx0)/d0, uy=(ay0-vy0)/d0;
          /* ★ 判据改为「首帧速度方向」而不是「多帧累积位移」：
             累积位移会把 AI 决策、分离物理、寻路、索敌缓存全耦合进来，
             任何一帧的微小差异都会分叉成 0.1 vs 10.7（间歇性失败）。
             本源能的作用是「立刻朝背离方向加速」，看速度投影即可，
             既确定又能真实反映行为。 */
          v.x=vx0; v.y=vy0;
          stepSim(1/60);
          const velAlong=a.vx*ux+a.vy*uy;          // 首帧速度沿背离方向的分量
          /* 再跑一段时间，作为「行为确实发生」的辅助证据 */
          for(let i=0;i<90;i++){
            if(CLASSES[a.cls].heal) a.healCd=9999;
            v.x=vx0; v.y=vy0;
            stepSim(1/60);
          }
          const d1=Math.hypot(a.x-v.x,a.y-v.y);
          const along=(a.x-ax0)*ux+(a.y-ay0)*uy;
          return {d0:+d0.toFixed(1), d1:+d1.toFixed(1), away:+(d1-d0).toFixed(1),
                  along:+along.toFixed(1), velAlong:+velAlong.toFixed(2),
                  stillInfected:v.infect>0};
        };
        const rifle=run('rifle'), civ=run('civilian'), medic=run('medic');
        rng=rngWas;
        G.reloadOn=reloadWas;                 // 还原调用前的换弹开关
        const out={_dbg:_avoidDbg, rifle:rifle, civilian:civ, medic:medic,
                   avoidMove:rifle.away, distAfter:rifle.d1,
                   avoidClosing:rifle.away, medicClosing:medic.away};
        HOLD_SPOT_ON=holdWas;
        restore(s);
        return out;
      },
      /* 僵尸轮次：清空一波后自动开下一波 */
      waveTest(){
        const s=snapshot();
        scratchBattle();
        const oldWaves=waves.slice(), oldOn=waveOn;
        waves=[{lineup:{zombie:2},gap:60},{lineup:{zombie:3},gap:60}];
        waveOn=true;
        G.teamNum=[0,0];
        const keep=makeUnit('rifle',0,cx_of(3),cy_of(11),1); keep.spawnT=0; keep.behavior='hold';
        G.units.push(keep);
        placeTeam(1,{zombie:2},k=>(G.teamNum[1]=(G.teamNum[1]||0)+1));
        G.startCount=[0,2];
        G.waveIdx=1; G.waveT=60; G.waveLog=[];
        for(const u of G.units) u.spawnT=0;
        const first=G.units.length;
        for(const u of G.units.slice()) if(u.team===1) damage(u,9999,null);   // 清空第一波
        for(let i=0;i<30;i++) stepSim(1/60);                                   // 下一帧就该投第二波
        const second=G.units.filter(u=>u.alive&&u.team===1).length;
        const out={first, second, waveIdx:G.waveIdx, log:G.waveLog.length};
        waves=oldWaves; waveOn=oldOn; G.waveIdx=1; G.waveT=60; G.waveLog=[];
        restore(s);
        return out;
      },
      /* 行军锁定：被派遣移动途中依然朝敌人开火 */
      marchAimTest(){
        const s=snapshot();
        const reloadWasOn=G.reloadOn; G.reloadOn=false;
        scratchBattle();
        const h=makeUnit('mg',0,cx_of(4),cy_of(11),1); h.spawnT=0; h.behavior='free';
        const e=makeUnit('rifle',1,cx_of(9),cy_of(11),1); e.spawnT=0; e.behavior='hold';
        G.units.push(h,e);
        const esp=CLASSES.rifle.speed; CLASSES.rifle.speed=0.01;   // 定住目标
        G.selected.clear(); G.selected.add(h.id);
        dispatchSelected(cx_of(24),cy_of(11));                     // 朝远处迁移，途中应当继续开火
        const hp0=e.hp;
        let firedWhileMoving=0, moved=0;
        const x0=h.x;
        for(let i=0;i<300;i++){
          stepSim(1/60);
          if(h.dispatch&&h.gunFlash>0) firedWhileMoving++;
        }
        moved=Math.abs(h.x-x0);
        const out={firedWhileMoving:firedWhileMoving, moved:+moved.toFixed(1),
                   damage:+(hp0-e.hp).toFixed(1), hitWhileMarching:hp0-e.hp>0};
        G.reloadOn=reloadWasOn;
        CLASSES.rifle.speed=esp;
        restore(s);
        return out;
      },
      /* 狙击手：子弹无限穿透，且每穿一人伤害打 25% */
      pierceTest(){
        const s=snapshot();
        const reloadWasOn=G.reloadOn; G.reloadOn=false;
        scratchBattle();
        const g=G.map;
        for(let y=1;y<GH-1;y++) g[idx(clamp(GW-2,1,GW-1),y)]=WALL;   // 挡一下，别让子弹飞出界
        const sn=makeUnit('sniper',0,cx_of(5),cy_of(11),1); sn.spawnT=0; sn.behavior='hold';
        sn.aim=0; sn.cd=999;                                // 只测这一发，避免连射干扰
        const ys=[11,11,11], xs=[10,13,16];
        const targets=[];
        for(let i=0;i<3;i++){
          const t=makeUnit('rifle',1,cx_of(xs[i]),cy_of(ys[i]),i+1);
          t.spawnT=0; t.behavior='hold';
          targets.push(t);
        }
        const keep=makeUnit('rifle',1,cx_of(2),cy_of(20),9); keep.spawnT=0;
        G.units.push(sn,keep);
        for(const t of targets) G.units.push(t);
        const hp0=targets.map(t=>t.hp);
        fireWith(sn,CLASSES.sniper);
        for(let i=0;i<26;i++){ stepSim(1/60); sn.cd=999; }
        const dmg=targets.map((t,i)=>+(hp0[i]-t.hp).toFixed(1));
        const out={dmg:dmg, base:CLASSES.sniper.dmg, mul:CLASSES.sniper.pierceMul,
                   pierce:CLASSES.sniper.pierce,
                   hitAll:dmg.every(v=>v>0)};
        G.reloadOn=reloadWasOn;
        restore(s);
        return out;
      },
      /* 自由行动：按态势在「推进 / 借掩体」之间切换 */
      freeStanceTest(){
        const s=snapshot();
        scratchBattle();
        const mk=(x,y)=>{ const u=makeUnit('rifle',0,cx_of(x),cy_of(y),1); u.spawnT=0; u.behavior='free'; return u; };
        const zs=makeUnit('zombie',1,cx_of(30),cy_of(11),1); zs.spawnT=0;
        const keep=makeUnit('rifle',0,cx_of(2),cy_of(20),5); keep.spawnT=0; keep.behavior='hold';
        G.units.push(zs,keep);
        // ① 落单且贴脸 → 应当选择借掩体
        const lone=mk(28,11); G.units.push(lone);
        lone.planT=0; lone.plan=null;
        const planLone=freeStance(lone,zs,120,CLASSES.rifle.range,1/60);
        // ② 人多且离得远 → 应当推进
        const crowd=[];
        for(let i=0;i<5;i++){ const u=mk(6+i,9); crowd.push(u); G.units.push(u); }
        /* 网格必须重建：freeStance 用 forEachNear 统计友军，
           不重建的话新 push 的单位不在桶里，会被判成「落单」→ 不推进。 */
        gridMarkDirty(); gridEnsure();
        const pusher=crowd[0];
        pusher.planT=0; pusher.plan=null;
        const planPush=freeStance(pusher,zs,400,CLASSES.rifle.range,1/60);
        const out={planLone:planLone, planPush:planPush, pooled:mixed_plan_names()};
        restore(s);
        return out;
      },
      /* 掩体：隔窗射击的位置得分应当高于空地 */
      windowCoverTest(){
        const s=snapshot();
        scratchBattle();
        const g=G.map;
        for(let y=8;y<=14;y++) g[idx(20,y)]=WALL;         // 一堵墙
        g[idx(20,11)]=WIN;                                 // 中间开窗
        const h=makeUnit('rifle',0,cx_of(18),cy_of(11),1); h.spawnT=0; h.behavior='skirmish';
        const z=makeUnit('zombie',1,cx_of(26),cy_of(11),1); z.spawnT=0;
        G.units.push(h,z);
        const dummy={x:cx_of(21),y:cy_of(11)};
        const atWin=coverAt(h,cx_of(19),cy_of(11),dummy,CLASSES.rifle.range);
        const atOpen=coverAt(h,cx_of(18),cy_of(4),dummy,600);
        const out={atWin:+atWin.toFixed(1), atOpen:atOpen<=-1e8?null:+atOpen.toFixed(1),
                   winBonus:WIN_SHOOT_BONUS};
        restore(s);
        return out;
      },
      /* 地图识别：能找出「好守的点」 */
      holdSpotTest(){
        const s=snapshot();
        const saved={msize:MSIZE};
        setMapSize('medium',true,true);
        G.phase='setup';
        G.map.set(editGrid);
        const spot=bestHoldSpot(0);
        const score=spot?holdScoreAt(spot.tx,spot.ty):null;
        const out={found:!!spot, score:score===null?null:+score.toFixed(1),
                   tx:spot?spot.tx:null, ty:spot?spot.ty:null};
        restore(s);
        return out;
      },
      /* 跨队伍交火：不同队伍互相攻击（含人类型 vs 人类型） */
      crossTeamTest(){
        const s=snapshot();
        scratchBattle();
        const a=makeUnit('rifle',0,cx_of(8),cy_of(11),1);  a.spawnT=0; a.behavior='push';
        const b=makeUnit('rifle',1,cx_of(16),cy_of(11),1); b.spawnT=0; b.behavior='push';
        G.units.push(a,b);
        for(let i=0;i<240;i++) stepSim(1/60);
        const out={aHp:+a.hp.toFixed(1), bHp:+b.hp.toFixed(1),
                   aKills:a.kills, bKills:b.kills,
                   mutual:a.hp<a.maxHp&&b.hp<b.maxHp};
        restore(s);
        return out;
      },
      /* 三方混战：任何两队都互为敌人（狙击手无散布，结果确定） */
      threeWayTest(){
        const s=snapshot();
        scratchBattle();
        const a=makeUnit('sniper',0,cx_of(9),cy_of(11),1);  a.spawnT=0; a.behavior='hold';
        const b=makeUnit('sniper',1,cx_of(17),cy_of(9),1);  b.spawnT=0; b.behavior='hold';
        const c=makeUnit('sniper',2,cx_of(15),cy_of(14),1); c.spawnT=0; c.behavior='hold';
        G.units.push(a,b,c);
        let maxBullets=0;
        for(let i=0;i<900;i++){
          stepSim(1/60);
          if(G.bullets.length>maxBullets) maxBullets=G.bullets.length;
        }
        const alive=G.units.filter(u=>u.alive);
        const deadTeams=[...new Set(G.units.filter(u=>!u.alive).map(u=>u.team))];
        const out={alive:alive.length, deadTeams:deadTeams,
                   casualties:G.units.filter(u=>!u.alive).length,
                   maxBullets:maxBullets};
        restore(s);
        return out;
      },
      /* 右键派遣：3 个单位从左侧被派往右侧指定点，抵达后指令解除 */
      dispatchTest(){
        const s=snapshot();
        scratchBattle();
        const tx=cx_of(22), ty=cy_of(11);
        for(let i=0;i<3;i++){
          const u=makeUnit('rifle',0,cx_of(6),cy_of(9+i*2),i+1);
          u.behavior=null; u.spawnT=0;
          G.units.push(u);
        }
        const zs=makeUnit('zombie',1,cx_of(37),cy_of(20),1);
        zs.spawnT=0; G.units.push(zs);
        const zsp=CLASSES.zombie.speed; CLASSES.zombie.speed=0.01;   // 定住僵尸，排除后撤本能干扰
        const start=G.units.slice(0,3).map(u=>Math.hypot(tx-u.x,ty-u.y));
        G.selected.clear();
        for(const u of G.units.slice(0,3)) G.selected.add(u.id);
        const n=dispatchSelected(tx,ty);
        const minD=[1e9,1e9,1e9];
        let clearedFrames=0;
        for(let i=0;i<900;i++){
          stepSim(1/60);
          G.units.slice(0,3).forEach((u,k)=>{ if(u.alive) minD[k]=Math.min(minD[k],Math.hypot(tx-u.x,ty-u.y)); });
          if(G.units.slice(0,3).every(u=>!u.dispatch)){ clearedFrames=i+1; break; }
        }
        CLASSES.zombie.speed=zsp;
        const humans=G.units.filter(u=>u.alive&&u.team===0);
        const out={dispatched:n, before:+Math.max.apply(null,start).toFixed(1),
                   closest:+Math.max.apply(null,minD.map(d=>Math.min(d,1e6))).toFixed(1),
                   closestMin:+Math.min.apply(null,minD).toFixed(1),
                   frames:clearedFrames, cleared:humans.filter(u=>!u.dispatch).length};
        restore(s);
        return out;
      },
      /* 游击找掩体：人类型应当贴到方块边，同时视线里始终有敌人 */
      coverTest(){
        const s=snapshot();
        scratchBattle();
        const g=G.map;
        for(let y=7;y<=9;y++) g[idx(18,y)]=WALL;          // 人右侧上方一根柱子
        const h=makeUnit('rifle',0,cx_of(16),cy_of(11),1);
        h.behavior='skirmish'; h.spawnT=0;
        const z=makeUnit('zombie',1,cx_of(24),cy_of(11),1); z.spawnT=0;
        G.units.push(h,z);
        const zsp=CLASSES.zombie.speed; CLASSES.zombie.speed=0.01;   // 定住僵尸
        const d0=Math.hypot(h.x-z.x,h.y-z.y);
        let minCover=1e9, losFrames=0;
        for(let i=0;i<420;i++){
          stepSim(1/60);
          if(!h.alive) break;
          const tx=(h.x/TILE)|0, ty=(h.y/TILE)|0;
          for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++){
            const nx=tx+dx, ny=ty+dy;
            if(!inB(nx,ny)) continue;
            const t=g[idx(nx,ny)];
            if(t!==WALL&&t!==WIN) continue;
            minCover=Math.min(minCover,Math.hypot(h.x-cx_of(nx),h.y-cy_of(ny)));
          }
          if(z.alive&&losClear(h.x,h.y,z.x,z.y)) losFrames++;
        }
        CLASSES.zombie.speed=zsp;
        const out={dist:+d0.toFixed(1),
                   minCoverDist:minCover<1e8?+minCover.toFixed(1):null,
                   losFrames:losFrames, moved:+Math.hypot(h.x-cx_of(16),h.y-cy_of(11)).toFixed(1)};
        restore(s);
        return out;
      },
      /* 确定性验证：1 医疗兵 + 1 被感染步枪手，贴着放置（窗口 3 秒） */
      cureTest(){
        const s=snapshot();
        scratchBattle();
        const m=makeUnit('medic',0,cx_of(3),cy_of(11),1);
        const r=makeUnit('rifle',0,cx_of(4),cy_of(11),2);
        const z=makeUnit('zombie',1,cx_of(37),cy_of(1),1);
        m.spawnT=r.spawnT=z.spawnT=0;
        G.units.push(m,r,z);
        infect(r,1);
        const before=r.infect, zBefore=z.hp;
        let cured=false, converted=false, frames=0;
        for(let i=0;i<400;i++){
          stepSim(1/60); frames=i+1;
          if(r.kind!=='h'){ converted=true; break; }
          if(r.infect<=0){ cured=true; break; }
          if(!r.alive) break;
        }
        const out={before:+(before||0).toFixed(2), cured, converted, stillHuman:r.alive&&r.kind==='h',
                   frames, seconds:+(frames/60).toFixed(2), zombieUntouched:Math.abs(z.hp-zBefore)<1e-6,
                   medicHealCd:+m.healCd.toFixed(2)};
        restore(s);
        return out;
      },
      /* 尸变倒戈：被队伍2 感染的人应当加入队伍2 */
      convertTest(){
        const s=snapshot();
        scratchBattle();
        const r=makeUnit('rifle',0,cx_of(5),cy_of(11),1);
        const z=makeUnit('zombie',1,cx_of(37),cy_of(1),1);
        r.spawnT=z.spawnT=0;
        G.units.push(r,z);
        infect(r,1);
        for(let i=0;i<400;i++){ stepSim(1/60); if(r.kind!=='h') break; }
        const out={kind:r.kind, team:r.team, isZombie:r.cls==='zombie',
                   hpFrac:+ (r.hp/r.maxHp).toFixed(2), labelled:r.label};
        restore(s);
        return out;
      },
      /* 抱团 / 后撤 / 鼓舞的确定性场景 */
      behaviorTest(){
        const s=snapshot();
        scratchBattle();
        const out={};
        // ① 后撤：人类型在僵尸正前方且贴得很近 → 位移方向必须背离僵尸
        const h1=makeUnit('rifle',0,cx_of(20),cy_of(11),1);
        const z1=makeUnit('zombie',1,cx_of(22),cy_of(11),1);
        h1.behavior='hold'; h1.spawnT=z1.spawnT=0;
        G.units.push(h1,z1);
        const d0=Math.hypot(h1.x-z1.x,h1.y-z1.y);
        const h0={x:h1.x,y:h1.y};
        const away={x:(h1.x-z1.x)/d0, y:(h1.y-z1.y)/d0};
        for(let i=0;i<90;i++) stepSim(1/60);
        const mv={x:h1.x-h0.x, y:h1.y-h0.y};
        const along=mv.x*away.x+mv.y*away.y;
        out.panic={start:+d0.toFixed(1), end:+Math.hypot(h1.x-z1.x,h1.y-z1.y).toFixed(1),
                   awayMove:+along.toFixed(1), lateral:+(mv.x*(-away.y)+mv.y*away.x).toFixed(1)};
        // ①b 对照：僵尸在射程外且预设为坚守 → 不该主动贴上去
        /* ★ 距离要按**射程**算，不能写死格数。
           TILE 从 32 改成 24 后，原来「10 格 = 320px」变成了 240px，
           正好落进步枪射程（240）里 → 人类当然会靠近，测试就失败了。
           现在按「射程 × 1.4」放，保证一定在射程外。 */
        G.units=[]; G.time=0; G.tick=0;
        const _rifleRange = CLASSES.rifle.range;      // 240
        const _gapPx = _rifleRange * 1.4;              // 336px，稳在射程外
        const _gapTiles = Math.max(2, Math.round(_gapPx / TILE));
        const h2=makeUnit('rifle',0,cx_of(8),cy_of(Math.floor(GH/2)),1);
        const z2=makeUnit('zombie',1,cx_of(8+_gapTiles),cy_of(Math.floor(GH/2)),1);
        h2.behavior='hold'; h2.spawnT=z2.spawnT=0;
        G.units.push(h2,z2);
        const h2a={x:h2.x,y:h2.y};
        const d2a=Math.hypot(h2.x-z2.x,h2.y-z2.y);
        for(let i=0;i<120;i++) stepSim(1/60);
        out.hold={start:+d2a.toFixed(1),
                  humanAdvance:+Math.hypot(h2.x-h2a.x,h2.y-h2a.y).toFixed(1),
                  humanClosing:+((h2a.x-z2.x)-(h2.x-z2.x)).toFixed(1)};
        // ② 抱团：近处两人会靠拢，远处孤立者不该跑过去
        G.units=[]; G.time=0; G.tick=0;
        const a=makeUnit('rifle',0,cx_of(6),cy_of(4),1);
        const b=makeUnit('rifle',0,cx_of(7),cy_of(4),2);
        const far=makeUnit('rifle',0,cx_of(36),cy_of(20),3);
        a.spawnT=b.spawnT=far.spawnT=0;
        G.units.push(a,b,far);
        for(const u of G.units) u.behavior='hold';
        const far0={x:far.x,y:far.y};
        for(let i=0;i<120;i++) stepSim(1/60);
        out.cohesion={farMoved:+Math.hypot(far.x-far0.x,far.y-far0.y).toFixed(1),
                      nearMoved:+Math.hypot(a.x-b.x,a.y-b.y).toFixed(1)};
        // ③ 平民鼓舞：只看同队
        G.units=[]; G.time=0; G.tick=0;
        const rA=makeUnit('rifle',0,cx_of(5),cy_of(11),1); rA.spawnT=0;
        G.units.push(rA);
        rA.rateMul=civilianAuraMul(rA);
        out.auraAlone=+rA.rateMul.toFixed(2);
        const civ=makeUnit('civilian',0,cx_of(5),cy_of(12),2); civ.spawnT=0;
        G.units.push(civ);
        updateTeamTargets();
        rA.rateMul=civilianAuraMul(rA);
        out.auraWithCiv=+rA.rateMul.toFixed(2);
        // ③c 敌方（队伍2）的平民不提供加成：同队平民阵亡后只剩敌方平民
        civ.alive=false;
        const civZ=makeUnit('civilian',1,cx_of(5),cy_of(13),4); civZ.spawnT=0;
        G.units.push(civZ);
        updateTeamTargets();
        out.auraEnemyCiv=+civilianAuraMul(rA).toFixed(2);
        restore(s);
        return out;
      }
    };
  }
};
function mixed_plan_names(){
  const o={};
  for(const u of G.units){ if(u.planName) o[u.planName]=(o[u.planName]||0)+1; }
  return o;
}
function TEAM_HEX_clear(){
  for(const k in TEAM_HEX) delete TEAM_HEX[k];
  G.baseDirty=true;
}

/* ---------------- 标题屏 ----------------
   进入游戏先看到「__GAME_FULL_TITLE__」的标题屏，再进入配置/调试界面。
   两个入口：
     开始配置 —— 关掉标题屏、进入配置面板（原来的一堆参数页）
     快速开战 —— 直接用当前配置开局
   标题屏只是**视觉层**：不影响任何游戏状态，随时可回到配置。 */
(function(){
  /* 用项目统一的 $() 取元素（无头测试的假 DOM 只实现了 $ / $$，
     直接写 document.getElementById 会在测试里报 is not a function）。 */
  let ts=null, app=null;
  try{ ts=$('#titleScreen'); app=$('#appRoot'); }catch(e){ return; }
  if(!ts||!app) return;
  function enter(){
    ts.classList.add('hidden');
    app.hidden=false;
    try{ syncStage(); render(); }catch(e){}
  }
  const bc=$('#btnEnterConfig');
  const bq=$('#btnQuickPlay');
  if(bc) bc.addEventListener('click',enter);
  if(bq) bq.addEventListener('click',()=>{
    enter();
    try{ startMatch(); }catch(e){}
  });
  window.__titleEnter=enter;
})();
