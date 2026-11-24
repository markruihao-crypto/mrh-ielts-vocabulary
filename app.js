(function () {
  'use strict';
  const C = window.WordCore;
  const STORAGE_KEY = 'shici-word-studio-v1';
  const sampleWords = [
    [6,1,'allocate','分配；拨给'],[6,1,'approach','方法；接近'],[6,1,'benefit','益处；使受益'],[6,1,'capacity','容量；能力'],
    [6,2,'decline','下降；拒绝'],[6,2,'diverse','多样的'],[6,2,'estimate','估计'],[6,2,'factor','因素'],
    [6,3,'generate','产生；生成'],[6,3,'indicate','表明；指出'],[6,3,'maintain','维持；保养'],[6,3,'obtain','获得'],
    [6,4,'policy','政策'],[6,4,'require','要求；需要'],[6,4,'significant','重要的；显著的'],[6,4,'vary','变化；不同']
  ].map(([band,list,english,chinese]) => ({ id:`demo-${band}-${list}-${english}`,band,list,english,chinese }));
  function blankState() { return { version:1, scheduleVersion:2, lexicon:window.BOOK_WORDS||[], source:'bundled', demo:false, startDate:'2026-11-17', dateOverrides:{0:'2026-11-18'}, scheduleAnchor:{index:2,date:'2026-11-24'}, stats:{}, completed:{}, completedLists:{}, sundays:{}, run:null, mode:'meaning', accent:'en-US', gender:'female', batchSize:50, lastSummary:null }; }
  function prepareState(data) {
    let result={...blankState(),...data};
    if(data.startDate&&data.startDate!=='2026-11-17'&&!data.dateOverrides)result.dateOverrides={};
    if(!Object.prototype.hasOwnProperty.call(data,'scheduleAnchor')&&(result.startDate!=='2026-11-17'||Object.keys(data.completed||{}).some(index=>Number(index)>=2)))result.scheduleAnchor=null;
    if(result.demo)result.source='demo';
    else if(!data.source&&data.lexicon?.length)result.source='custom';
    if(result.source==='bundled'&&window.BOOK_WORDS?.length)result.lexicon=window.BOOK_WORDS;
    else if(!result.demo&&!result.lexicon.length&&window.BOOK_WORDS?.length){result.lexicon=window.BOOK_WORDS;result.source='bundled';}
    if(data.scheduleVersion!==2)result=C.migrateLegacyState({...result,scheduleVersion:1});
    return result;
  }
  function load() {
    try {
      const data=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
      if(!data||data.version!==1)return blankState();
      const result=prepareState(data);
      if(data.scheduleVersion!==2||!Object.prototype.hasOwnProperty.call(data,'scheduleAnchor')){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(result));}catch{}}
      return result;
    } catch { return blankState(); }
  }
  let state=load(), view='home', busy=false, toastTimer;
  const root=document.getElementById('view-root');
  const cloudEnabled=Boolean(window.VOICE_CLOUD_ENABLED);
  const bundledIds=new Set((window.BOOK_WORDS||[]).map(w=>w.id));
  let stopActiveAudio=null;
  const words=()=>state.demo?sampleWords:state.lexicon;
  const wordMap=()=>new Map(words().map(w=>[w.id,w]));
  const sessions=()=>C.buildSessions(state.startDate,state.dateOverrides||{},state.scheduleAnchor);
  const completedSessions=()=>sessions().filter(s=>state.completed[s.index]);
  const studiedWords=()=>words().filter(w=>state.completedLists[`${w.band}-${w.list}`]);
  const sessionWords=(session)=>{ const keys=new Set(session.lists.map(l=>`${l.band}-${l.list}`)); return words().filter(w=>keys.has(`${w.band}-${w.list}`)); };
  const nextSession=()=>sessions().find(s=>!state.completed[s.index]);
  const isDue=(date)=>date<=C.dateKey(new Date());
  const stat=(id)=>state.stats[id]||(state.stats[id]={seen:0,correct:0,mistakes:0,skips:0,reviewCount:0,focus:false,focusReasons:[]});
  const focusWords=()=>words().filter(w=>state.stats[w.id]?.focus).sort((a,b)=>(state.stats[b.id]?.mistakes||0)-(state.stats[a.id]?.mistakes||0));
  const remainingReviews=()=>studiedWords().reduce((sum,w)=>sum+Math.max(0,C.goalFor(state.stats[w.id])-(state.stats[w.id]?.reviewCount||0)),0);
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const dayName=(key)=>'周'+'日一二三四五六'[C.parseDate(key).getDay()];
  const prettyDate=(key)=>{const d=C.parseDate(key);return `${d.getMonth()+1}月${d.getDate()}日`;};
  const fullDate=(key)=>{const d=C.parseDate(key);return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;};
  const listName=(x)=>C.labelForList(x.band,x.list);
  const shortLists=(items)=>items.length ? items.length===1?listName(items[0]):`${listName(items[0])} — ${listName(items.at(-1))}`:'无';
  function save(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch{toast('浏览器存储已满，请先导出备份。');}}
  function toast(message){const el=document.getElementById('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3200);}
  function navigate(target){ view=target;document.querySelector('.sidebar').classList.remove('open');render();window.scrollTo({top:0,behavior:'smooth'}); }
  function setMode(mode){state.mode=mode;save();render();}
  function voiceGender(name){
    const n=String(name||'').toLowerCase();
    if(/\b(female|woman)\b|aria|jenny|zira|samantha|allison|ava|sonia|libby|hazel|serena|kate|emma|amy|maisie|joanna|kendra|salli/.test(n))return 'female';
    if(/\b(male|man)\b|\bguy\b|david|mark|christopher|eric|roger|ryan|george|daniel|brian|arthur|oliver/.test(n))return 'male';
    return 'unknown';
  }
  function chooseVoice(){
    if(!('speechSynthesis' in window))return {voice:null,exactAccent:false,exactGender:false,available:false};
    const all=window.speechSynthesis.getVoices(),accent=state.accent||'en-US',gender=state.gender||'female';
    const exact=all.filter(v=>v.lang?.replace('_','-').toLowerCase()===accent.toLowerCase());
    const english=all.filter(v=>/^en[-_]/i.test(v.lang||''));
    const chosen=exact.find(v=>voiceGender(v.name)===gender)||exact.find(v=>voiceGender(v.name)==='unknown')||exact[0]||english.find(v=>voiceGender(v.name)===gender)||english[0]||null;
    return {voice:chosen,exactAccent:!!chosen&&exact.includes(chosen),exactGender:!!chosen&&voiceGender(chosen.name)===gender,available:all.length>0};
  }
  function voiceStatus(){
    const label=`${state.accent==='en-GB'?'英式':'美式'}${state.gender==='male'?'男声':'女声'}`;
    if(cloudEnabled){
      const card=view==='quiz'?currentCard():null;
      return card?.word&&!bundledIds.has(card.word.id)?`自定义词暂用设备语音；${label}是否可用取决于浏览器和系统。`:`当前使用 Azure 云端${label}；首次播放生成音频，之后直接重播。`;
    }
    if(!('speechSynthesis' in window))return '当前浏览器不支持语音朗读。';
    const selected=chooseVoice();
    if(!selected.available)return `正在读取设备语音。${label}是否可用取决于浏览器和系统。`;
    if(!selected.voice)return '未检测到英语语音；浏览器会尝试系统默认朗读，口音和声线无法保证。';
    if(selected.exactAccent&&selected.exactGender)return `当前语音：${selected.voice.name}`;
    if(selected.exactAccent)return `未找到可确认的${label}，当前使用同口音语音：${selected.voice.name}`;
    return `未找到${label}，当前使用：${selected.voice.name}`;
  }
  function voiceControls(){return `<div class="voice-toolbar"><span class="voice-caption">发音偏好</span><div class="voice-options"><div class="mode-pill" role="group" aria-label="英语口音"><button data-action="accent" data-accent="en-US" class="${state.accent==='en-US'?'active':''}">美音</button><button data-action="accent" data-accent="en-GB" class="${state.accent==='en-GB'?'active':''}">英音</button></div><div class="mode-pill" role="group" aria-label="朗读声线"><button data-action="gender" data-gender="female" class="${state.gender==='female'?'active':''}">女声</button><button data-action="gender" data-gender="male" class="${state.gender==='male'?'active':''}">男声</button></div></div><small id="voice-status">${esc(voiceStatus())}</small></div>`;}
  function setVoicePref(key,value){state[key]=value;save();document.querySelectorAll(`[data-action="${key}"]`).forEach(b=>b.classList.toggle('active',b.dataset[key]===value));const status=document.getElementById('voice-status');if(status)status.textContent=voiceStatus();if(view==='quiz'){const card=currentCard();if(card?.word)speak(card.word);}}
  function speakDevice(text){
    return new Promise(resolve=>{
      if(!('speechSynthesis' in window)){toast('当前浏览器不支持语音朗读。');resolve();return;}
      try{
        const synth=window.speechSynthesis;synth.cancel();const utterance=new SpeechSynthesisUtterance(text),choice=chooseVoice();utterance.lang=state.accent||'en-US';utterance.rate=.88;if(choice.voice)utterance.voice=choice.voice;
        let settled=false;const finish=()=>{if(!settled){settled=true;resolve();}};
        utterance.onend=finish;utterance.onerror=finish;synth.speak(utterance);setTimeout(finish,3500);
      }catch{toast('朗读失败，请检查浏览器的语音设置。');resolve();}
    });
  }
  function speak(word){
    if(!cloudEnabled||!bundledIds.has(word.id))return speakDevice(word.english);
    if(stopActiveAudio)stopActiveAudio();
    if('speechSynthesis' in window)window.speechSynthesis.cancel();
    return new Promise(resolve=>{
      const params=new URLSearchParams({word:word.id,accent:state.accent||'en-US',gender:state.gender||'female'});
      const audio=new Audio(`/api/audio?${params}`);
      let settled=false;
      const cleanup=()=>{if(settled)return false;settled=true;clearTimeout(timeout);audio.pause();if(stopActiveAudio===finish)stopActiveAudio=null;return true;};
      const finish=()=>{if(cleanup())resolve();};
      const failed=()=>{if(!cleanup())return;toast('云端发音暂不可用，已临时改用设备语音。');speakDevice(word.english).then(resolve);};
      const timeout=setTimeout(failed,12000);
      stopActiveAudio=finish;
      audio.addEventListener('ended',finish,{once:true});
      audio.addEventListener('error',failed,{once:true});
      audio.play().catch(failed);
    });
  }
  function updateNav(){
    document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===(['quiz','finish'].includes(view)?'home':view)));
    document.getElementById('focus-nav-count').textContent=focusWords().length;
    document.getElementById('today-label').textContent=`${fullDate(C.dateKey(new Date()))} · ${dayName(C.dateKey(new Date()))}`;
    document.getElementById('breadcrumb-current').textContent=({home:'今日计划',focus:'重点复习',schedule:'听写日历',library:'词表管理',quiz:'听写进行中',finish:'本次完成'})[view];
  }
  function statCard(label,value,unit,bottom){return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}<span class="stat-unit">${unit}</span></div><div class="stat-bottom">${bottom}</div></div>`;}
  function todayMini(){
    const today=C.dateKey(new Date()), week=C.mondayKey(new Date()), weekSessions=sessions().filter(s=>s.week===week);
    const rows=weekSessions.map(s=>({date:s.date,label:`第 ${s.index+1} 次听写`,sub:shortLists(s.lists),done:!!state.completed[s.index],active:s.date===today,exception:s.date!==s.regularDate}));
    rows.push({date:C.sundayKey(week),label:'周日随机抽查',sub:'本周词汇中抽取 200 词',done:!!state.sundays[week],active:C.sundayKey(week)===today});
    return rows.map(r=>`<div class="schedule-item ${r.active?'active':''}"><div class="day-badge">${prettyDate(r.date).replace('月','/').replace('日','')}<small>${dayName(r.date)}</small></div><div class="schedule-info"><b>${r.label}</b><small>${esc(r.sub)}</small></div><span class="state">${r.done?'已完成':r.active?'今天':r.exception?'已改期':'待开始'}</span></div>`).join('');
  }
  function renderHome(){
    const current=nextSession(), loaded=words().length, totalLists=state.demo?4:70, doneLists=Object.keys(state.completedLists).length, focus=focusWords().length;
    const firstException=sessions()[0].date!==sessions()[0].regularDate;
    const heroTitle=!loaded?'为你的 2828 个词，安排一张清晰的复习路线图。':state.run?'上次的听写还在这里，继续完成吧。':!current?'70 个 List 已经走完，继续巩固记忆。':`下一站：${esc(shortLists(current.lists))}`;
    const heroText=!loaded?'导入词表后，每周二、四、六按顺序听写：6 分每次 2 个 List，7 分每次 4 个 List；周日随机抽查。也可以先用示例词体验。':state.demo?'当前为示例模式：16 个演示词并非原书内容。导入词表后将切换为正式计划。':current?`${prettyDate(current.date)} · ${dayName(current.date)} · 第 ${current.index+1} 次听写。每题可选中文提示或英语发音，答对后自动朗读。`:'正式词表已完成，强化复习会继续追踪每词 6 次、重点词 7 次的后续出现。';
    const heroAction=state.run?`<button class="button primary" data-action="resume">继续听写 ↗</button>`:!loaded?`<button class="button primary" data-action="go-library">导入我的词表 ↗</button><button class="button secondary" data-action="demo">体验示例词</button>`:current?`<button class="button primary" data-action="start-session" data-index="${current.index}" ${isDue(current.date)?'':'disabled'}>${isDue(current.date)?`开始第 ${current.index+1} 次听写 ↗`:`${prettyDate(current.date)} 开始`}</button>`:`<button class="button primary" data-action="go-focus">前往强化复习 ↗</button>`;
    const datasetNotice=!loaded?`<div class="notice"><span class="notice-icon">ⓘ</span><div><b>等待完整词表</b>　本站已配置 6 分 42 个 List、7 分 28 个 List 的计划。导入词表后即可按原书顺序开始。</div></div>`:state.demo?`<div class="notice"><span class="notice-icon">ⓘ</span><div><b>示例模式</b>　目前使用 16 个演示词，不代表《雅思词汇胜经》的原书词表。<button data-action="use-bundled">使用内置原书词表</button></div></div>`:loaded!==2828?`<div class="notice"><span class="notice-icon">ⓘ</span><div><b>词表数量待核对</b>　目前已导入 ${loaded} 词，与你设定的 2828 词不一致。可继续练习，建议在词表管理中核对。</div></div>`:'';
    const historyNotice=state.migratedLegacy&&doneLists?`<div class="notice"><span class="notice-icon">✓</span><div><b>历史记录已保留</b>　原来完成的 ${doneLists} 个 List 和 ${Object.keys(state.stats).length} 条单词练习记录已计入新计划。</div></div>`:'';
    const browserNotice=!doneLists&&Object.keys(state.stats).length?`<div class="notice"><span class="notice-icon">ⓘ</span><div><b>此浏览器尚无已完成的听写</b>　如果你在其他浏览器练习过，请点击“恢复个人进度”选择备份 JSON；当前错词会合并保留。</div></div>`:'';
    root.innerHTML=`<div class="page-head"><div><div class="eyebrow">YOUR LEARNING DESK</div><h1 class="page-title">把每一个词，练成下意识。</h1><p class="page-subtitle">${state.scheduleAnchor?'6 分词汇 List 5–6 改至 11 月 24 日；后续按周二、四、六顺延。':firstException?'首场改至 11 月 18 日（周三）；其余听写日期不变。':'周二 · 周四 · 周六听写，周日回顾；让进步看得见。'}</p></div><div class="head-actions"><button class="button secondary" data-action="restore-backup">恢复个人进度</button><button class="button secondary" data-action="go-schedule">查看完整计划 →</button></div></div>${datasetNotice}${historyNotice}${browserNotice}<div class="stat-row">${statCard('已完成 List',doneLists,totalLists===4?' / 4':' / 70','6 分 2 个 · 7 分 4 个')}${statCard('已练习词汇',studiedWords().length,'词',`词表已载入 ${loaded} 词`)}${statCard('重点复习册',focus,'词','错两次 / 停留超一分钟')}${statCard('待补足复习',remainingReviews(),'次','每词目标 6 次，重点词 7 次')}</div><div class="home-grid"><section class="card hero-card"><div class="hero-top"><span class="hero-dot"></span> ${state.run?'进行中':!loaded?'准备开始':'下一次听写'}</div><h2>${heroTitle}</h2><p>${heroText}</p><div class="hero-actions">${heroAction}</div><div class="progress-wrap"><div class="progress-track"><div class="progress-fill" style="width:${Math.round(doneLists/totalLists*100)}%"></div></div><div class="progress-meta"><span>学习进度</span><span>${doneLists} / ${totalLists} List</span></div></div></section><section class="card panel"><div class="panel-title-row"><h3>本周节奏</h3><span class="panel-sub">TUE / THU / SAT / SUN</span></div><div class="schedule-mini">${todayMini()||'<p class="field-note">计划从所选开始日期启动。</p>'}</div></section></div><div class="section-head"><div><h2>保持记忆在线</h2><p>几种练法，照顾不同状态的你。</p></div></div><div class="bottom-grid"><section class="card feature-card"><span class="feature-icon">✧</span><div class="feature-body"><b>周日 · 200 词抽查</b><p>从本周已听写的词里抽取，反复出错词提高抽中机会。</p></div><button class="feature-arrow" data-action="go-schedule" aria-label="查看周日抽查">↗</button></section><section class="card feature-card green"><span class="feature-icon">◎</span><div class="feature-body"><b>重点 · 强化复习</b><p>每次额外练 3–5 个旧词；强化训练补足个人复习目标。</p></div><button class="feature-arrow" data-action="go-focus" aria-label="查看重点复习">↗</button></section></div><div class="footer-note">周日抽查在有本周已完成听写时开放。词汇与进度保存在当前浏览器，建议定期导出备份。</div>`;
  }
  function renderFocus(){
    const all=studiedWords(), focus=focusWords(), covered=all.filter(w=>(state.stats[w.id]?.reviewCount||0)>=C.goalFor(state.stats[w.id])).length, remaining=remainingReviews();
    root.innerHTML=`<div class="page-head"><div><div class="eyebrow">REVIEW JOURNAL</div><h1 class="page-title">重点复习册</h1><p class="page-subtitle">卡住的词先记下，练熟之后再放下。</p></div><div class="head-actions"><button class="button secondary" data-action="restore-backup">合并其他浏览器备份</button><button class="button secondary" data-action="export">导出进度备份 ↓</button></div></div><div class="focus-summary">${statCard('重点词',focus.length,'词','错两次、停留一分钟或跳过')}${statCard('已达复习目标',covered,'词',`已学习 ${all.length} 词`)}${statCard('还需出现',remaining,'次','普通词 6 次 · 重点词 7 次')}</div><div class="card panel"><div class="panel-title-row"><div><h3>强化复习</h3><p class="page-subtitle">优先安排复习次数少、反复出错的词；可随时继续练。</p></div></div><div class="field-row"><div><label class="field-label" for="batch-size">本轮题量</label><select class="field" id="batch-size"><option value="20" ${state.batchSize===20?'selected':''}>20 词 · 短练</option><option value="50" ${state.batchSize===50?'selected':''}>50 词 · 标准</option><option value="100" ${state.batchSize===100?'selected':''}>100 词 · 集中</option><option value="200" ${state.batchSize===200?'selected':''}>200 词 · 深练</option></select></div><button class="button primary" data-action="start-booster" ${remaining?'':'disabled'}>开始强化复习 ↗</button></div><div class="field-note">正式听写每次额外穿插 3–5 个旧词。强化复习承担其余次数，达到目标的词会自动退出待复习池。</div></div><div class="section-head"><div><h2>需要多看几眼的词</h2><p>可点朗读按钮重听发音。</p></div><span class="panel-sub">${focus.length} WORDS</span></div><div class="card focus-list">${focus.length?focus.slice(0,80).map(w=>{const s=state.stats[w.id];return `<div class="focus-row"><div class="word">${esc(w.english)}</div><div class="meaning">${esc(w.chinese)}</div><div class="mini">${w.band}分 L${w.list}</div><div class="mini">复习 ${s.reviewCount||0}/${C.goalFor(s)}</div><button class="button secondary small" data-action="speak" data-word="${esc(w.id)}" aria-label="朗读 ${esc(w.english)}">▶</button></div>`;}).join(''):`<div class="empty-state"><div class="empty-icon">✦</div><h3>这里还很清爽</h3><p>连续拼错两次、单题停留超过一分钟或跳过的词，会自动进入重点复习册。</p><button class="button secondary" data-action="go-home">返回今日计划</button></div>`}</div>${focus.length>80?'<p class="footer-note">此处显示最需要关注的前 80 词，其他词也会进入强化复习。</p>':''}`;
  }
  function renderSchedule(){
    const ss=sessions(), weeks=[...new Set(ss.map(s=>s.week))], today=C.dateKey(new Date());
    const first=ss[0], firstException=first.date!==first.regularDate;
    const timeline=weeks.flatMap(week=>{
      const rows=ss.filter(s=>s.week===week).map(s=>({type:'session',s,date:s.date}));
      rows.push({type:'sunday',week,date:C.sundayKey(week)});return rows;
    });
    root.innerHTML=`<div class="page-head"><div><div class="eyebrow">A PLAN THAT MOVES WITH YOU</div><h1 class="page-title">听写日历</h1><p class="page-subtitle">${firstException?'首场周三听写；其余':'固定'}周二、周四、周六，6 分每次 2 个 List、7 分每次 4 个 List；周日从本周词汇中抽查最多 200 个。</p></div><button class="button secondary" data-action="go-library">调整开始日期</button></div><div class="notice"><span class="notice-icon">✦</span><div>第一场为 <b>${fullDate(first.date)}（${dayName(first.date)}）</b>${state.scheduleAnchor?'；6 分 List 5–6 从 '+fullDate(state.scheduleAnchor.date)+' 开始，之后按周二、四、六顺延':firstException?'，仅本场改期，后续日期不变':''}。共 28 次正式听写：6 分词汇 21 次、7 分词汇 7 次。可以补做已过日期的听写。</div></div><div class="card schedule-table"><div class="schedule-row header"><div>日期</div><div>安排</div><div>词汇范围</div><div>状态</div><div>操作</div></div>${timeline.map(row=>{
      if(row.type==='session'){const s=row.s,done=!!state.completed[s.index],n=sessionWords(s).length,available=n&&isDue(s.date)&&s.index===nextSession()?.index&&!state.run;return `<div class="schedule-row"><div class="date">${prettyDate(s.date)}<small>${dayName(s.date)}</small></div><div>第 ${s.index+1} 次听写</div><div class="lists">${esc(shortLists(s.lists))}<div class="num">${n} 词</div></div><div class="${done?'done':'pending'}">${done?'✓ 已完成':s.date===today?'今天':s.date!==s.regularDate?'已改期':'待开始'}</div><div>${done?'<span class="panel-sub">已完成</span>':`<button class="button secondary small" data-action="start-session" data-index="${s.index}" ${available?'':'disabled'}>${available?'开始听写':'按计划解锁'}</button>`}</div></div>`;}
      const pool=weeklyWords(row.week),done=!!state.sundays[row.week],n=Math.min(200,pool.length),available=n&&isDue(row.date)&&!state.run;return `<div class="schedule-row"><div class="date">${prettyDate(row.date)}<small>周日</small></div><div>本周随机抽查</div><div class="lists">已听写词汇中抽取<div class="num">${n} / 200 词可抽</div></div><div class="${done?'done':'pending'}">${done?'✓ 已完成':'待开始'}</div><div>${done?'<span class="panel-sub">已完成</span>':`<button class="button secondary small" data-action="start-sunday" data-week="${row.week}" ${available?'':'disabled'}>${available?'开始抽查':'周日开放'}</button>`}</div></div>`;
    }).join('')}</div><p class="footer-note">若当周已听写词汇不足 200 个，会抽取全部可用词。出错较多的词拥有更高抽中概率；每词达到复习目标后不再进入新抽查。</p>`;
  }
  function renderLibrary(){
    const listCounts=Array.from({length:70},(_,i)=>{const m=C.listMeta(i);return words().filter(w=>w.band===m.band&&w.list===m.list).length;});
    const loaded=words().length, filled=listCounts.filter(Boolean).length;
    const first=sessions()[0], firstException=first.date!==first.regularDate;
    root.innerHTML=`<div class="page-head"><div><div class="eyebrow">YOUR WORD LIBRARY</div><h1 class="page-title">词表管理</h1><p class="page-subtitle">把词书整理成可听、可写、可追踪的个人词库。</p></div><button class="button secondary" data-action="export">导出完整备份 ↓</button></div><div class="library-grid"><section class="card library-card"><h3>恢复进度或导入词表</h3><p>选择拾词导出的 JSON 备份，可合并其他浏览器的听写和错词记录；当前浏览器新增的错词也会保留。本站已内置 PDF 词表，共 2828 词；如需替换词表，也可导入 CSV、TSV 或 JSON。</p><label class="upload-zone"><input id="file-import" type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json"><div class="upload-icon">⇧</div><b>选择进度备份或词表文件</b><small>JSON 备份可恢复进度 · 文件仅在当前浏览器中处理</small></label><div class="field-row"><button class="button secondary" data-action="paste">粘贴词表</button><button class="button ghost" data-action="download-template">下载 CSV 模板 ↓</button></div><div class="code-sample">band,list,english,chinese<br>6,1,example,例子<br>7,1,analysis,分析</div><div class="field-note" style="margin-top:12px">导入新词表会重建听写计划；同 ID 单词的练习记录保留。请先导出备份以防浏览器数据丢失。</div></section><section class="card library-card"><h3>当前词库</h3><div class="library-status"><span class="status-icon">▤</span><div><strong>${state.demo?'示例模式':state.source==='bundled'?'PDF 原书词表':loaded===2828?'完整词表':loaded?'已导入词表':'尚未导入'}</strong><br>已载入 ${loaded} / ${C.TARGET_WORDS} 词 · ${filled} / 70 个 List</div></div><p>目标结构：6 分词汇 42 个 List，7 分词汇 28 个 List。6 分每次 2 个 List，7 分每次 4 个 List。</p><div class="list-dots">${listCounts.map((n,i)=>`<span class="list-dot ${n?state.completedLists[C.listMeta(i).band+'-'+C.listMeta(i).list]?'complete':'filled':''}" title="${C.listMeta(i).band}分 List ${C.listMeta(i).list} · ${n}词">${i<42?i+1:i-41}</span>`).join('')}</div><div class="legend"><span><i></i>空</span><span><i class="filled"></i>已导入</span><span><i class="complete"></i>已完成</span></div><div class="field-row" style="margin-top:26px"><div><label class="field-label" for="start-date">整体计划起始日期</label><input class="field" id="start-date" type="date" value="${state.startDate}" ${Object.keys(state.completed).length?'disabled':''}></div></div><div class="field-note">${state.scheduleAnchor?'6 分词汇 List 5–6 从 '+prettyDate(state.scheduleAnchor.date)+' 开始，后续按周二、四、六顺延。':firstException?'首场单独安排在 '+prettyDate(first.date)+'，后续日期不变。':''}调整此项会重排整体计划；完成听写后锁定。</div>${state.source!=='bundled'&&window.BOOK_WORDS?.length?'<button class="button secondary small" data-action="use-bundled" style="margin-top:14px;margin-right:8px">使用内置原书词表</button>':''}${!state.demo&&loaded?'<button class="button ghost small" data-action="demo" style="margin-top:14px">切换到示例模式</button>':''}</section></div><p class="footer-note">本站使用浏览器本地存储；换设备、换浏览器或清除数据后，需通过备份恢复。原书词表连接云端时使用四种固定声线；未连接时使用设备语音。</p>`;
  }
  function weeklyWords(week){
    const listKeys=new Set(sessions().filter(s=>s.week===week&&state.completed[s.index]).flatMap(s=>s.lists.map(l=>`${l.band}-${l.list}`)));
    const from=C.parseDate(week).getTime(),to=C.addDays(C.parseDate(week),7).getTime();
    for(const [key,time] of Object.entries(state.completedLists))if(Number(time)>=from&&Number(time)<to)listKeys.add(key);
    return words().filter(w=>listKeys.has(`${w.band}-${w.list}`));
  }
  function renderQuiz(){
    const run=state.run;if(!run){navigate('home');return;}
    const item=run.queue[run.index];if(!item){finishRun();return;}
    const w=wordMap().get(item.id);if(!w){toast('词表已变化，本轮听写已结束。');state.run=null;save();navigate('home');return;}
    const mode=state.mode,progress=Math.round(run.index/run.queue.length*100),title=run.type==='session'?`第 ${run.sessionIndex+1} 次听写`:run.type==='sunday'?'周日随机抽查':'强化复习';
    const prompt=mode==='meaning'?`<div class="quiz-prompt">${esc(w.chinese)}</div>`:`<div class="quiz-prompt audio-mode">听发音，拼出这个单词</div><button class="speak-button" data-action="speak-current">▶　播放英语读音</button>`;
    root.innerHTML=`<div class="page-head"><div><div class="eyebrow">LISTEN · SPELL · REMEMBER</div><h1 class="page-title">${title}</h1><p class="page-subtitle">${run.type==='session'?esc(shortLists(run.legacyLists||sessions()[run.sessionIndex]?.lists||[])):'每一遍都在加深记忆。'}</p></div><button class="button secondary" data-action="quit-run">暂存并返回</button></div><div class="dictation-layout"><section class="card quiz-card"><div class="quiz-top"><div class="quiz-count">第 ${run.index+1} / ${run.queue.length} 题 · ${item.type==='new'?'本次新词':'旧词复习'}</div><div class="mode-pill" role="group" aria-label="听写模式"><button data-action="mode" data-mode="meaning" class="${mode==='meaning'?'active':''}">中文释义</button><button data-action="mode" data-mode="audio" class="${mode==='audio'?'active':''}">听音拼写</button></div></div><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div><div class="quiz-overline">${mode==='meaning'?'根据释义拼写英文':'LISTEN & SPELL'}</div>${prompt}${voiceControls()}<div class="answer-label">你的答案</div><input id="answer" class="answer-input" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="输入英文单词" placeholder="在这里输入英文单词 …"><div class="answer-actions"><button class="button primary" data-action="submit">确认答案 ↗</button><button class="button secondary" data-action="skip">想不起来，下一题</button></div><div id="quiz-feedback" class="quiz-feedback" aria-live="polite"></div></section><aside class="card quiz-side"><h3>这一题</h3><div class="quiz-fact"><span>来自</span><b>${state.demo?'示例 · ':''}${w.band}分词汇 · List ${w.list}</b></div><div class="quiz-fact"><span>当前题已停留</span><b id="timer">0 秒</b></div><div class="quiz-fact"><span>本题拼写错误</span><b id="mistake-count">${run.mistakes} 次</b></div><div class="quiz-fact"><span>复习进度</span><b>${state.stats[w.id]?.reviewCount||0} / ${C.goalFor(state.stats[w.id])} 次</b></div><div id="focus-trigger" class="hint-card">拼错会清空输入，让你重新拼写。连续错两次、停留一分钟或跳过，会自动加入重点复习册。</div></aside></div>`;
    const input=document.getElementById('answer');input.focus();
    if(mode==='audio')setTimeout(()=>{if(state.run===run&&run.index===state.run.index)speak(w);},230);
    updateTimer();
  }
  function renderFinish(){const x=state.lastSummary||{};root.innerHTML=`<div class="card run-finish"><div class="finish-icon">✓</div><div class="eyebrow" style="margin-top:24px">SESSION COMPLETE</div><h2>${esc(x.title||'这一轮完成了')}</h2><p>完成 ${x.total||0} 题 · 首次答对 ${x.firstTry||0} 题 · 跳过 ${x.skipped||0} 题。<br>值得再看一眼的词已经归入重点复习册。</p><div class="finish-actions"><button class="button primary" data-action="go-home">返回今日计划</button><button class="button secondary" data-action="go-focus">查看重点复习</button></div></div>`;}
  function render(){updateNav();({home:renderHome,focus:renderFocus,schedule:renderSchedule,library:renderLibrary,quiz:renderQuiz,finish:renderFinish})[view]();}
  function createRun(type,queue,extras={}){if(state.run){toast('已有未完成的听写，请先继续完成。');navigate('quiz');return;}if(!queue.length){toast('当前没有可练习的单词。');return;}state.run={type,queue,index:0,cardStarted:Date.now(),mistakes:0,firstTry:0,skipped:0,...extras};save();navigate('quiz');}
  function startSession(index){
    const s=sessions()[index];if(!s||state.completed[index])return;
    if(index!==nextSession()?.index){toast('请按 List 顺序完成听写。');return;}
    if(!isDue(s.date)){toast(`第 ${index+1} 次听写将在 ${prettyDate(s.date)} 开放。`);return;}
    const newWords=sessionWords(s).filter(w=>!state.completedLists[`${w.band}-${w.list}`]);
    if(!newWords.length){toast('这些 List 还没有待听写的词汇，请先检查词表。');return;}
    const prior=studiedWords();
    const review=C.chooseDictationReviews(prior,new Set(newWords.map(w=>w.id)),state.stats);
    const queue=newWords.map(w=>({id:w.id,type:'new'}));
    review.forEach((w,i)=>{const pos=Math.min(queue.length,Math.round((i+1)*newWords.length/(review.length+1))+i);queue.splice(pos,0,{id:w.id,type:'review'});});
    createRun('session',queue,{sessionIndex:index});
  }
  function startSunday(week){if(state.sundays[week])return;if(!isDue(C.sundayKey(week))){toast('周日抽查将在当周周日开放。');return;}const selected=C.chooseSunday(weeklyWords(week),state.stats);createRun('sunday',selected.map(w=>({id:w.id,type:'review'})),{week});}
  function startBooster(){const selected=C.chooseBooster(studiedWords(),state.stats,state.batchSize);createRun('booster',selected.map(w=>({id:w.id,type:'review'})));}
  function markFocus(id,reason){const s=stat(id);if(!s.focus)s.focus=true;if(!s.focusReasons.includes(reason))s.focusReasons.push(reason);save();document.getElementById('focus-nav-count').textContent=focusWords().length;const hint=document.getElementById('focus-trigger');if(hint)hint.textContent='已加入重点复习册。本题结束后，它会优先进入后续复习。';}
  function currentCard(){const run=state.run;return run?{run,item:run.queue[run.index],word:wordMap().get(run.queue[run.index]?.id)}:null;}
  function updateTimer(){const card=currentCard();if(!card?.item)return;const elapsed=Math.floor((Date.now()-card.run.cardStarted)/1000), el=document.getElementById('timer');if(el)el.textContent=`${elapsed} 秒`;if(elapsed>=60){const s=stat(card.item.id);if(!s.focusReasons.includes('停留超一分钟'))markFocus(card.item.id,'停留超一分钟');}}
  function finishCard(kind){
    const card=currentCard();if(!card?.item||busy)return;
    const {run,item,word}=card, s=stat(item.id);updateTimer();s.seen++;s.lastSeen=Date.now();
    if(kind==='correct'){s.correct++;if(run.mistakes===0)run.firstTry++;}
    if(kind==='skip'){s.skips++;run.skipped++;markFocus(item.id,'跳过');toast(`已跳过：${word.english}`);}
    if(item.type==='review')s.reviewCount=Math.min(7,(s.reviewCount||0)+1);
    save();
    if(kind==='correct'){
      const feedback=document.getElementById('quiz-feedback');if(feedback){feedback.classList.add('good');feedback.textContent=`拼对了！${word.english}`;}
      busy=true;const oldIndex=run.index;speak(word).then(()=>{setTimeout(()=>{busy=false;if(state.run===run&&run.index===oldIndex)advance();},180);});
    }else advance();
  }
  function advance(){const run=state.run;if(!run)return;run.index++;run.mistakes=0;run.cardStarted=Date.now();save();if(run.index>=run.queue.length)finishRun();else if(view==='quiz')renderQuiz();else render();}
  function finishRun(){const run=state.run;if(!run)return;
    if(run.type==='session'){
      const finishedAt=Date.now();
      const lists=run.legacyLists||sessions()[run.sessionIndex]?.lists||[];
      for(const list of lists)state.completedLists[`${list.band}-${list.list}`]=finishedAt;
      for(const session of sessions()){
        if(session.lists.every(list=>state.completedLists[`${list.band}-${list.list}`])){
          state.completed[session.index] ||= Math.max(...session.lists.map(list=>Number(state.completedLists[`${list.band}-${list.list}`])));
        }
      }
    }
    if(run.type==='sunday')state.sundays[run.week]=Date.now();
    state.lastSummary={title:run.type==='session'?`第 ${run.sessionIndex+1} 次听写完成`:run.type==='sunday'?'本周抽查完成':'强化复习完成',total:run.queue.length,firstTry:run.firstTry,skipped:run.skipped};
    state.run=null;save();navigate('finish');
  }
  function submit(){
    if(busy)return;const input=document.getElementById('answer'),card=currentCard();if(!input||!card?.word)return;
    const answer=C.normalizeAnswer(input.value);if(!answer){toast('先写下你想到的拼写。');input.focus();return;}
    if(answer===C.normalizeAnswer(card.word.english)){finishCard('correct');return;}
    card.run.mistakes++;const s=stat(card.item.id);s.mistakes++;if(card.run.mistakes>=2||s.mistakes>=2)markFocus(card.item.id,'拼错两次');save();
    input.value='';input.classList.remove('wrong');void input.offsetWidth;input.classList.add('wrong');input.focus();
    document.getElementById('mistake-count').textContent=`${card.run.mistakes} 次`;
    const feedback=document.getElementById('quiz-feedback');feedback.classList.remove('good');feedback.textContent='拼写还不对，清空后再试一次。';
  }
  function activateDemo(){if(state.run){toast('请先完成当前听写，再切换词表。');return;}state={...blankState(),lexicon:[],source:'demo',demo:true,startDate:state.startDate,dateOverrides:state.dateOverrides,scheduleAnchor:state.scheduleAnchor,mode:state.mode,accent:state.accent,gender:state.gender};save();toast('已进入示例模式：16 个示例词，不属于原书词表。');navigate('home');}
  function useBundled(){if(state.run&&!state.demo){toast('请先完成当前听写，再切换词表。');return;}if(!window.BOOK_WORDS?.length){toast('内置词表尚未就绪。');return;}const previous=state.stats;state={...blankState(),startDate:state.startDate,dateOverrides:state.dateOverrides,scheduleAnchor:state.scheduleAnchor,mode:state.mode,accent:state.accent,gender:state.gender,stats:Object.fromEntries(window.BOOK_WORDS.filter(w=>previous[w.id]).map(w=>[w.id,previous[w.id]]))};save();toast(`已启用 PDF 原书词表：${window.BOOK_WORDS.length} 词。`);navigate('home');}
  function download(name,content,mime){const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function exportBackup(){download(`拾词-备份-${C.dateKey(new Date())}.json`,JSON.stringify({schema:'word-studio-backup-v1',exportedAt:new Date().toISOString(),state},null,2),'application/json');toast('完整备份已下载。');}
  function importText(text,name){
    let parsed;
    try{parsed=JSON.parse(text);}catch{}
    if(parsed?.schema==='word-studio-backup-v1'&&parsed.state?.version===1&&Array.isArray(parsed.state.lexicon)){
      if(state.run?.index>0&&!window.confirm('合并备份会结束当前未完成的听写；已经记录的拼写和错词统计会保留。是否继续？'))return;
      state=C.mergeProgress(state,prepareState(parsed.state));
      save();toast(`进度已合并：${Object.keys(state.completedLists).length} 个 List、${focusWords().length} 个重点词。`);navigate('home');return;
    }
    if(state.run){toast('请先完成当前听写，再更换词表。');return;}
    try{const result=C.parseLexicon(text,name);const prev=state.stats;state.lexicon=result.words;state.source='custom';state.demo=false;state.stats=Object.fromEntries(result.words.filter(w=>prev[w.id]).map(w=>[w.id,prev[w.id]]));state.completed={};state.completedLists={};state.sundays={};state.run=null;state.lastSummary=null;save();closeModal();toast(`已导入 ${result.words.length} 词、${result.listCount} 个 List${result.issues.length?`；跳过 ${result.issues.length} 行`:''}。`);navigate('library');}
    catch(error){toast(`导入失败：${error.message}`);}
  }
  function openPaste(){document.getElementById('modal-root').innerHTML=`<div class="modal-overlay"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">粘贴词表</h2><button class="icon-button" data-action="close-modal" aria-label="关闭">×</button></div><p>第一行需要表头：band,list,english,chinese。可粘贴 CSV、制表符分隔内容或 JSON 词条数组。</p><textarea id="paste-data" class="field" placeholder="band,list,english,chinese&#10;6,1,example,例子"></textarea><div class="modal-actions"><button class="button secondary" data-action="close-modal">取消</button><button class="button primary" data-action="import-paste">导入词表</button></div></div></div>`;document.getElementById('paste-data').focus();}
  function closeModal(){document.getElementById('modal-root').innerHTML='';}
  document.addEventListener('click',e=>{
    const nav=e.target.closest('[data-view]');if(nav){navigate(nav.dataset.view);return;}
    const button=e.target.closest('[data-action]');if(!button)return;
    const action=button.dataset.action;
    if(action==='go-home')navigate('home');if(action==='restore-backup'){navigate('library');document.getElementById('file-import')?.click();}if(action==='go-focus')navigate('focus');if(action==='go-library')navigate('library');if(action==='go-schedule')navigate('schedule');
    if(action==='resume'&&state.run)navigate('quiz');if(action==='demo')activateDemo();if(action==='use-bundled')useBundled();
    if(action==='start-session')startSession(Number(button.dataset.index));if(action==='start-sunday')startSunday(button.dataset.week);if(action==='start-booster')startBooster();
    if(action==='mode')setMode(button.dataset.mode);if(action==='accent')setVoicePref('accent',button.dataset.accent);if(action==='gender')setVoicePref('gender',button.dataset.gender);if(action==='submit')submit();if(action==='skip')finishCard('skip');if(action==='quit-run')navigate('home');
    if(action==='speak-current'){const card=currentCard();if(card?.word)speak(card.word);}
    if(action==='speak'){const word=wordMap().get(button.dataset.word);if(word)speak(word);}
    if(action==='export')exportBackup();if(action==='download-template')download('拾词-词表模板.csv','band,list,english,chinese\n6,1,example,例子\n7,1,analysis,分析\n','text/csv;charset=utf-8');
    if(action==='paste')openPaste();if(action==='close-modal')closeModal();if(action==='import-paste'){const value=document.getElementById('paste-data')?.value||'';if(value.trim())importText(value,'pasted.csv');else toast('请先粘贴词表内容。');}
  });
  document.getElementById('mobile-menu').addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('open'));
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='answer'){e.preventDefault();submit();}if(e.key==='Escape')closeModal();});
  document.addEventListener('change',e=>{
    if(e.target.id==='start-date'&&e.target.value&&!Object.keys(state.completed).length){state.startDate=e.target.value;state.dateOverrides={};state.scheduleAnchor=null;save();render();}
    if(e.target.id==='batch-size'){state.batchSize=Number(e.target.value);save();}
    if(e.target.id==='file-import'){const file=e.target.files?.[0];if(!file)return;if(!/\.(csv|tsv|txt|json)$/i.test(file.name)){toast('站点支持 CSV、TSV、JSON；Excel 或 PDF 请上传到聊天。');return;}const reader=new FileReader();reader.onload=()=>importText(String(reader.result||''),file.name);reader.onerror=()=>toast('无法读取文件。');reader.readAsText(file,'utf-8');}
  });
  if('speechSynthesis' in window)window.speechSynthesis.onvoiceschanged=()=>{const status=document.getElementById('voice-status');if(status)status.textContent=voiceStatus();};
  setInterval(updateTimer,1000);
  render();
})();
