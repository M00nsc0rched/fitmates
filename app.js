/* ============================================================================
   FIT MATES — edzéskövető PWA
   A verziószám EGYEZIK a sw.js CACHE nevében lévő számmal (fitmates-vN).
   ========================================================================== */
'use strict';
const APP_VERSION = 1;

/* ---------------------------------------------------------------- ÁLLAPOT */
const DEFAULT_STATE = {
  user:{level:1,xp:0,streak:0,lastWorkoutDate:null,totalXp:0},
  goal:'build',
  muscleRecovery:{chest:0,back:0,legs:0,shoulders:0,arms:0,core:0},
  lastWeights:{},
  personalRecords:{},
  workouts:[],
  completedToday:false,
  achievements:[],
  activeSession:null,
  customTodayExercises:[],
  customExercisesDate:null,
  anatomyView:'front',
  selectedMuscleFilter:null,
  highlightedExercise:null,
  diet:{
    selectedDate:new Date().toDateString(),
    calorieGoal:2500,
    macrosGoal:{p:150,c:250,f:70},
    meals:{},
    supplements:[
      {id:'s1',name:'Kreatin monohidrát',dose:'5g',time:'Bármikor'},
      {id:'s2',name:'Multivitamin',dose:'1 tabletta',time:'Reggel'},
      {id:'s3',name:'Omega-3 halolaj',dose:'2g',time:'Reggel'},
      {id:'s4',name:'Tejsavófehérje',dose:'30g',time:'Edzés után'},
      {id:'s5',name:'ZMA',dose:'3 tabletta',time:'Alvás előtt'}
    ],
    takenSupplements:{},
    fasting:{active:false,startTime:null,protocol:16}
  }
};

const LS_KEY = 'fitmates_state';
const LS_LEGACY = 'pulse_state';

// A régi shallow merge miatt az új mezők nem jelentek meg a visszatérő
// mentésekben (pl. a diet alobjektumai) — ezért mély összefésülés.
function deepMerge(base, over){
  if(Array.isArray(base)) return Array.isArray(over) ? over : base;
  if(base && typeof base === 'object'){
    const out = {};
    for(const k of Object.keys(base)) out[k] = deepMerge(base[k], over ? over[k] : undefined);
    if(over && typeof over === 'object') for(const k of Object.keys(over)) if(!(k in out)) out[k] = over[k];
    return out;
  }
  return over === undefined ? base : over;
}
function loadState(){
  try{
    const raw = localStorage.getItem(LS_KEY) || localStorage.getItem(LS_LEGACY);
    if(raw) return deepMerge(JSON.parse(JSON.stringify(DEFAULT_STATE)), JSON.parse(raw));
  }catch(e){ console.warn('Mentés betöltése sikertelen', e); }
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}
function saveState(){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }
  catch(e){ showToast('Mentés sikertelen (tele a tár?)'); }
}
let state = loadState();

/* ---------------------------------------------------------------- IKONOK */
function ic(name, size){
  return `<svg class="ic"${size?` style="font-size:${size}px"`:''}><use href="#i-${name}"/></svg>`;
}

/* ---------------------------------------------------------------- ADATOK */
const gymExercises = {
  chest:[
    {name:'Fekvenyomás rúddal',base:60,type:'compound'},
    {name:'Ferde fekvenyomás súlyzóval',base:22,type:'compound'},
    {name:'Gépes mellnyomás',base:30,type:'isolation'},
    {name:'Kábeles keresztezés',base:15,type:'isolation'},
    {name:'Pec deck (tárogató gép)',base:25,type:'isolation'}
  ],
  back:[
    {name:'Evezés rúddal',base:50,type:'compound'},
    {name:'Felső csigás lehúzás',base:45,type:'compound'},
    {name:'Ülő kábeles evezés',base:50,type:'compound'},
    {name:'Román felhúzás',base:60,type:'compound'},
    {name:'Egykezes súlyzós evezés',base:25,type:'compound'}
  ],
  legs:[
    {name:'Guggolás rúddal',base:60,type:'compound'},
    {name:'Lábtolás gépen',base:100,type:'compound'},
    {name:'Kitörés súlyzóval',base:20,type:'compound'},
    {name:'Lábhajlítás gépen',base:30,type:'isolation'},
    {name:'Vádliemelés gépen',base:60,type:'isolation'}
  ],
  shoulders:[
    {name:'Katonai nyomás rúddal',base:30,type:'compound'},
    {name:'Oldalemelés súlyzóval',base:8,type:'isolation'},
    {name:'Arc-húzás kábellel',base:15,type:'isolation'},
    {name:'Hátsó váll emelés',base:10,type:'isolation'}
  ],
  triceps:[
    {name:'Tricepsz lenyomás kábellel',base:20,type:'isolation'},
    {name:'Fej mögötti tricepsznyújtás',base:15,type:'isolation'},
    {name:'Szűk fogású fekvenyomás',base:40,type:'compound'}
  ],
  biceps:[
    {name:'Bicepsz hajlítás rúddal',base:20,type:'compound'},
    {name:'Bicepsz hajlítás súlyzóval',base:10,type:'isolation'},
    {name:'Kalapácshajlítás',base:12,type:'isolation'}
  ],
  core:[
    {name:'Függeszkedő lábemelés',base:0,type:'bodyweight'},
    {name:'Kábeles crunch',base:25,type:'isolation'},
    {name:'Deszka (plank)',base:0,type:'bodyweight',isTime:true},
    {name:'Orosz csavarás súlyzóval',base:5,type:'bodyweight'}
  ]
};

const calisthenicsExercises = {
  chest:[
    {name:'Fekvőtámasz',base:0,type:'bodyweight'},
    {name:'Tolódzkodás',base:0,type:'bodyweight'},
    {name:'Planche',base:0,type:'skill',advanced:true},
    {name:'Muscle-up',base:0,type:'skill',advanced:true}
  ],
  back:[
    {name:'Húzódzkodás',base:0,type:'bodyweight'},
    {name:'Fordított evezés',base:0,type:'bodyweight'},
    {name:'Front lever',base:0,type:'skill',advanced:true},
    {name:'Back lever',base:0,type:'skill',advanced:true}
  ],
  legs:[
    {name:'Guggolás (saját súly)',base:0,type:'bodyweight'},
    {name:'Kitörés (saját súly)',base:0,type:'bodyweight'},
    {name:'Nordic lábhajlítás',base:0,type:'bodyweight'},
    {name:'Pisztolyguggolás',base:0,type:'skill',advanced:true}
  ],
  shoulders:[
    {name:'Kézállás fal mellett',base:0,type:'skill',advanced:true},
    {name:'Csúcstartásos fekvőtámasz',base:0,type:'bodyweight'},
    {name:'Kézállásos fekvőtámasz',base:0,type:'skill',advanced:true}
  ],
  triceps:[
    {name:'Szűk fekvőtámasz',base:0,type:'bodyweight'},
    {name:'Padon tolódzkodás',base:0,type:'bodyweight'}
  ],
  biceps:[
    {name:'Alsó fogású húzódzkodás',base:0,type:'bodyweight'},
    {name:'Vízszintes húzás (gyűrű)',base:0,type:'bodyweight'}
  ],
  core:[
    {name:'Deszka (plank)',base:0,type:'bodyweight',isTime:true},
    {name:'Függeszkedő lábemelés',base:0,type:'bodyweight'},
    {name:'L-sit',base:0,type:'skill',advanced:true},
    {name:'Dragon flag',base:0,type:'skill',advanced:true}
  ]
};

const goals = {
  build:{name:'Izomépítés',desc:'Edzőtermi · súlyokkal',icon:'dumbbell',sets:4,reps:10,rest:75,
    split:{name:'Toló / Húzó / Láb',workouts:[
      {day:'Hét',name:'Toló nap',muscles:['chest','shoulders','triceps']},
      {day:'Ked',name:'Húzó nap',muscles:['back','biceps']},
      {day:'Sze',name:'Láb nap',muscles:['legs','core']},
      {day:'Csü',name:'Toló nap',muscles:['chest','shoulders','triceps']},
      {day:'Pén',name:'Húzó nap',muscles:['back','biceps']},
      {day:'Szo',name:'Láb nap',muscles:['legs','core']},
      {day:'Vas',name:'Pihenő',muscles:[]}
    ]}},
  calisthenics:{name:'Calisthenics',desc:'Saját súly · funkcionális',icon:'weight',sets:4,reps:12,rest:90,
    split:{name:'Felső / Alsó / Core',workouts:[
      {day:'Hét',name:'Toló (saját)',muscles:['chest','shoulders','triceps']},
      {day:'Ked',name:'Húzó (saját)',muscles:['back','biceps']},
      {day:'Sze',name:'Láb (saját)',muscles:['legs']},
      {day:'Csü',name:'Törzs & készség',muscles:['core','shoulders']},
      {day:'Pén',name:'Teljes test',muscles:['chest','back','legs']},
      {day:'Szo',name:'Mobilitás',muscles:['core']},
      {day:'Vas',name:'Pihenő',muscles:[]}
    ]}},
  // A kardió-split korábban 'arms' izomkulcsot használt, amihez NINCS gyakorlat-
  // készlet — az a nap üresen generálódott. Valódi kulcsokra cserélve.
  cardio:{name:'Kardió',desc:'Állóképesség · 15-20 ism.',icon:'running',sets:3,reps:20,rest:45,
    split:{name:'Körkörös edzés',workouts:[
      {day:'Hét',name:'Felső kör',muscles:['chest','back','shoulders']},
      {day:'Ked',name:'Alsó kör',muscles:['legs']},
      {day:'Sze',name:'Törzs & kondi',muscles:['core']},
      {day:'Csü',name:'Pihenő',muscles:[]},
      {day:'Pén',name:'Teljes test kör',muscles:['chest','back','legs']},
      {day:'Szo',name:'Hosszú kör',muscles:['legs','core','shoulders']},
      {day:'Vas',name:'Pihenő',muscles:[]}
    ]}},
  rest:{name:'Pihenőhét',desc:'Aktív regeneráció',icon:'bed',sets:0,reps:0,rest:0,
    split:{name:'Pihenőhét',workouts:[
      {day:'Hét',name:'Pihenő',muscles:[]},{day:'Ked',name:'Pihenő',muscles:[]},
      {day:'Sze',name:'Pihenő',muscles:[]},{day:'Csü',name:'Pihenő',muscles:[]},
      {day:'Pén',name:'Pihenő',muscles:[]},{day:'Szo',name:'Pihenő',muscles:[]},
      {day:'Vas',name:'Pihenő',muscles:[]}
    ]}}
};

// A tricepsz/bicepsz a testtérképen a "kar" régióhoz tartozik. Az 'arms'
// önmagára képződik, különben az egyedi gyakorlatoknál undefined lett volna.
const muscleCategoryMap = {
  chest:'chest', back:'back', legs:'legs',
  shoulders:'shoulders', triceps:'arms', biceps:'arms', arms:'arms', core:'core'
};
const muscleNamesHu = {chest:'Mell',back:'Hát',legs:'Lábak',shoulders:'Vállak',arms:'Karok',core:'Törzs',triceps:'Tricepsz',biceps:'Bicepsz'};

const achievements = [
  {id:'first',name:'Első vér',desc:'Fejezd be az első edzésed',icon:'dumbbell',check:s=>realWorkouts(s).length>=1},
  {id:'streak7',name:'Heti hős',desc:'7 napos sorozat',icon:'fire',check:s=>s.user.streak>=7},
  {id:'streak30',name:'Megállíthatatlan',desc:'30 napos sorozat',icon:'bolt',check:s=>s.user.streak>=30},
  {id:'w10',name:'Kétjegyű',desc:'10 edzés',icon:'trophy',check:s=>realWorkouts(s).length>=10},
  {id:'w50',name:'Acél akarat',desc:'50 edzés',icon:'medal',check:s=>realWorkouts(s).length>=50},
  {id:'lv5',name:'Feltörekvő',desc:'Érd el az 5. szintet',icon:'rocket',check:s=>s.user.level>=5},
  {id:'lv10',name:'Centúrió',desc:'Érd el a 10. szintet',icon:'star',check:s=>s.user.level>=10},
  {id:'lv25',name:'Elit',desc:'Érd el a 25. szintet',icon:'crown',check:s=>s.user.level>=25},
  {id:'vol5k',name:'Volumen-szörny',desc:'5 000 kg egy edzésen',icon:'mountain',check:s=>s.workouts.some(w=>w.volume>=5000)},
  {id:'earlybird',name:'Korai madár',desc:'Edzés hajnali 7 előtt',icon:'sun',check:s=>realWorkouts(s).some(w=>new Date(w.date).getHours()<7)},
  {id:'nightowl',name:'Éjjeli bagoly',desc:'Edzés este 9 után',icon:'moon',check:s=>realWorkouts(s).some(w=>new Date(w.date).getHours()>=21)},
  {id:'strong',name:'Nehézemelő',desc:'Emelj 100 kg felett',icon:'weight',check:s=>Object.values(s.lastWeights).some(w=>w>=100)}
];
// A pihenőnap is bekerül az előzményekbe, de nem számít "edzésnek".
function realWorkouts(s){ return s.workouts.filter(w=>!w.isRest); }

const titles = [
  {level:1,name:'ÚJONC'},{level:3,name:'KEZDŐ'},{level:5,name:'SPORTOLÓ'},
  {level:8,name:'VERSENYZŐ'},{level:12,name:'HARCOS'},{level:16,name:'SZÖRNYETEG'},
  {level:20,name:'ELIT'},{level:25,name:'LEGENDA'},{level:30,name:'HALHATATLAN'}
];

/* ---------------------------------------------------------------- SEGÉDEK */
function xpForLevel(lvl){ return 500 + (lvl-1)*250; }
function getTitle(level){ let t=titles[0]; for(const x of titles) if(level>=x.level) t=x; return t.name; }
function getDayOfWeek(){ return ['Vas','Hét','Ked','Sze','Csü','Pén','Szo'][new Date().getDay()]; }
function getExercisePool(){ return state.goal==='calisthenics' ? calisthenicsExercises : gymExercises; }
function getTodayWorkout(){
  const goal = goals[state.goal];
  if(!goal) return null;
  const today = getDayOfWeek();
  return goal.split.workouts.find(w=>w.day===today) || goal.split.workouts[0];
}
function formatDate(){
  const months=['Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Szep','Okt','Nov','Dec'];
  const days=['Vasárnap','Hétfő','Kedd','Szerda','Csütörtök','Péntek','Szombat'];
  const d=new Date();
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}.`;
}
function midnight(d){ const x=new Date(d); x.setHours(0,0,0,0); return x.getTime(); }
function fmtClock(sec){
  sec=Math.max(0,Math.round(sec));
  return sec<60 ? String(sec) : Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');
}
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function getRecoveryLevel(muscle){
  const last = state.muscleRecovery[muscle] || 0;
  if(!last) return {pct:100,label:'KÉSZ',color:'var(--success)'};
  const hours = (Date.now()-last)/3600000;
  if(hours<24) return {pct:hours/24*100,label:'PIHEN',color:'var(--accent-2)'};
  if(hours<48) return {pct:50+(hours-24)/24*50,label:'MAJDNEM',color:'var(--warning)'};
  return {pct:100,label:'KÉSZ',color:'var(--success)'};
}

function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t=setTimeout(()=>t.classList.remove('show'),2500);
}
function confetti(){
  const colors=['#c8ff00','#ff5c1f','#fff','#00d96f'];
  const wrap=document.querySelector('.phone-frame');
  for(let i=0;i<40;i++){
    const c=document.createElement('div');
    c.className='confetti';
    c.style.background=colors[Math.floor(Math.random()*colors.length)];
    c.style.left=Math.random()*100+'%';
    c.style.top='60px';
    c.style.animationDelay=Math.random()*0.5+'s';
    c.style.animationDuration=(1.5+Math.random())+'s';
    wrap.appendChild(c);
    setTimeout(()=>c.remove(),3000);
  }
}

/* --- hang + rezgés a pihenő végén (edzés közben a telefon a zsebben van) --- */
let audioCtx=null;
function beep(){
  try{
    audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended') audioCtx.resume();
    const t=audioCtx.currentTime;
    [880,1320].forEach((f,i)=>{
      const o=audioCtx.createOscillator(), g=audioCtx.createGain();
      o.type='sine'; o.frequency.value=f; o.connect(g); g.connect(audioCtx.destination);
      const s=t+i*0.18;
      g.gain.setValueAtTime(0,s);
      g.gain.linearRampToValueAtTime(0.3,s+0.02);
      g.gain.exponentialRampToValueAtTime(0.001,s+0.16);
      o.start(s); o.stop(s+0.18);
    });
  }catch(e){}
}
function vibrate(pattern){ if(navigator.vibrate) navigator.vibrate(pattern); }
// iOS: a WebAudio csak felhasználói interakció után indul — az első koppintásra feloldjuk
document.addEventListener('touchstart', ()=>{
  if(!audioCtx){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
  if(audioCtx && audioCtx.state==='suspended') audioCtx.resume();
}, {once:true});

/* --- képernyő ébren tartása edzés közben --- */
let wakeLock=null;
async function requestWakeLock(){
  try{ if('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }catch(e){}
}
function releaseWakeLock(){ try{ if(wakeLock){ wakeLock.release(); wakeLock=null; } }catch(e){} }
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='visible' && state.activeSession && state.activeSession.started && !state.activeSession.finished) requestWakeLock();
});

/* ---------------------------------------------------------------- TERV */
function generateTodayWorkout(){
  const today=getTodayWorkout();
  if(!today || today.muscles.length===0) return null;
  const goal=goals[state.goal];
  const pool=getExercisePool();
  const exerciseList=[];
  today.muscles.forEach((muscle,mi)=>{
    const exs=pool[muscle]||[];
    // az első (elsődleges) izomcsoport 2 gyakorlatot kap, a többi 1-1-et
    const numEx = mi===0 ? 2 : 1;
    for(let i=0;i<numEx && i<exs.length;i++){
      const ex=exs[i];
      const lastW = state.lastWeights[ex.name]!==undefined ? state.lastWeights[ex.name] : ex.base;
      exerciseList.push({...ex,muscle,sets:goal.sets,reps:goal.reps,rest:goal.rest,weight:lastW,isCustom:false});
    }
  });
  state.customTodayExercises.forEach(c=>exerciseList.push({...c,isCustom:true}));
  return {...today,exercises:exerciseList};
}

/* ---------------------------------------------------------------- ANATÓMIA */
function setAnatomyView(view){
  state.anatomyView=view;
  document.getElementById('view-front-btn').classList.toggle('active',view==='front');
  document.getElementById('view-back-btn').classList.toggle('active',view==='back');
  document.getElementById('anatomy-front').style.display = view==='front'?'block':'none';
  document.getElementById('anatomy-back').style.display = view==='back'?'block':'none';
  updateAnatomyHighlights();
}
function tapMuscle(muscleCat){
  if(!state.activeSession) return;
  if(state.selectedMuscleFilter===muscleCat){
    state.selectedMuscleFilter=null;
    document.getElementById('anatomy-hint').textContent='KOPPINTS EGY GYAKORLATRA VAGY IZOMRA';
  }else{
    state.selectedMuscleFilter=muscleCat;
    document.getElementById('anatomy-hint').textContent=`SZŰRÉS: ${(muscleNamesHu[muscleCat]||muscleCat).toUpperCase()}`;
  }
  state.highlightedExercise=null;
  updateAnatomyHighlights();
  renderAnatomyExerciseList();
}
function selectExerciseInOverview(idx){
  if(!state.activeSession) return;
  if(state.highlightedExercise===idx){
    state.highlightedExercise=null;
    document.getElementById('anatomy-hint').textContent='KOPPINTS EGY GYAKORLATRA VAGY IZOMRA';
  }else{
    state.highlightedExercise=idx;
    const ex=state.activeSession.exercises[idx];
    state.selectedMuscleFilter=null;
    const cat=muscleCategoryMap[ex.muscle]||'core';
    document.getElementById('anatomy-hint').textContent=`CÉL: ${(muscleNamesHu[cat]||cat).toUpperCase()}`;
    setAnatomyView(ex.muscle==='back' ? 'back' : 'front');
  }
  updateAnatomyHighlights();
  renderAnatomyExerciseList();
}
function updateAnatomyHighlights(){
  if(!state.activeSession) return;
  document.querySelectorAll('.muscle-label').forEach(l=>l.classList.remove('show'));
  document.querySelectorAll('.anatomy-muscle').forEach(m=>{
    m.classList.remove('active','filter','dim');
    const cat=m.dataset.muscle;
    const showLabel=()=>{
      const l=document.getElementById('label-'+cat)||document.getElementById('label-'+cat+'-back');
      if(l) l.classList.add('show');
    };
    if(state.highlightedExercise!==null){
      const ex=state.activeSession.exercises[state.highlightedExercise];
      if(cat===(muscleCategoryMap[ex.muscle]||'core')){ m.classList.add('active'); showLabel(); }
      else m.classList.add('dim');
    }else if(state.selectedMuscleFilter){
      if(cat===state.selectedMuscleFilter){ m.classList.add('filter'); showLabel(); }
      else m.classList.add('dim');
    }
  });
}
function renderAnatomyExerciseList(){
  const list=document.getElementById('anatomy-exercise-list');
  if(!state.activeSession) return;
  let show=state.activeSession.exercises;
  if(state.selectedMuscleFilter)
    show=state.activeSession.exercises.filter(ex=>(muscleCategoryMap[ex.muscle]||'core')===state.selectedMuscleFilter);
  if(show.length===0){
    list.innerHTML=`<div class="card" style="text-align:center;color:var(--muted);font-size:13px">Erre az izomra ma nincs gyakorlat.</div>`;
    return;
  }
  list.innerHTML=show.map(ex=>{
    const i=state.activeSession.exercises.indexOf(ex);
    const sel=state.highlightedExercise===i;
    return `<div class="ex-list-item ${sel?'selected':''}" onclick="selectExerciseInOverview(${i})">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:8px;height:30px;background:${sel?'var(--accent)':'var(--surface-2)'};border-radius:4px"></div>
        <div>
          <div style="font-size:10px;color:var(--accent);letter-spacing:.15em;text-transform:uppercase;margin-bottom:2px">${esc(muscleNamesHu[ex.muscle]||ex.muscle)}</div>
          <div style="font-weight:700;font-size:15px">${esc(ex.name)}</div>
        </div>
      </div>
      <div style="text-align:right" class="font-mono">
        <div style="font-size:11px;color:var(--muted)">${ex.sets} × ${ex.reps}</div>
        <div style="font-size:14px;font-weight:700">${ex.weight ? ex.weight+' kg' : 'saját'}</div>
      </div>
    </div>`;
  }).join('');
}

/* ---------------------------------------------------------------- MODAL */
function openModal(html){
  document.getElementById('modal-content').innerHTML=html;
  document.getElementById('modal-overlay').classList.add('active');
}
function hideModal(){ document.getElementById('modal-overlay').classList.remove('active'); }
function closeModal(e){ if(e.target.id==='modal-overlay') hideModal(); }
// A confirm() natív dialógusa kilóg a design-ból és telepített appban zavaró,
// ezért saját megerősítő ablak.
let _confirmCb=null;
function askConfirm(title,text,okLabel,cb){
  _confirmCb=cb;
  openModal(`<h3 class="font-display" style="font-size:24px;margin:0 0 10px">${esc(title)}</h3>
    <p style="font-size:13px;color:var(--muted);margin:0 0 18px;line-height:1.5">${esc(text)}</p>
    <button class="btn-primary" style="background:var(--danger);color:#fff;margin-bottom:8px" onclick="confirmYes()">${esc(okLabel)}</button>
    <button class="btn-secondary" onclick="hideModal()">MÉGSE</button>`);
}
function confirmYes(){ hideModal(); const cb=_confirmCb; _confirmCb=null; if(cb) cb(); }
function showCalisthenicsInfo(){
  openModal(`
    <h3 class="font-display" style="font-size:24px;margin:0 0 12px">CALISTHENICS</h3>
    <p style="font-size:13px;color:var(--muted);margin-bottom:12px">A calisthenics nem csak izomtömeget épít, egyszerre fejleszti:</p>
    <ul style="font-size:13px;margin-bottom:12px;padding-left:20px;list-style:disc">
      <li>az erőt és a relatív erőt</li><li>az állóképességet</li>
      <li>az egyensúlyt és a koordinációt</li><li>a mobilitást és a testkontrollt</li>
    </ul>
    <div style="font-size:12px;font-weight:700;color:var(--success);margin-bottom:6px">ELŐNYÖK</div>
    <p style="font-size:13px;margin-bottom:12px">Szinte bárhol végezhető, alig kell hozzá felszerelés. Funkcionálisan fejleszti az egész testet, és kíméletesebb az ízületekhez.</p>
    <div style="font-size:12px;font-weight:700;color:var(--danger);margin-bottom:6px">HÁTRÁNYOK</div>
    <p style="font-size:13px;margin-bottom:16px">A láb maximális erőfejlesztése nehezebb, és egy ponton túl a tömegnövelés is. A haladó elemek (pl. planche) hónapokig tartó tanulást igényelnek.</p>
    <button class="btn-primary" onclick="hideModal()">BEZÁRÁS</button>`);
}

/* ---------------------------------------------------------------- SAJÁT GYAKORLAT */
function toggleAddCustomEx(){ document.getElementById('add-custom-ex-form').classList.toggle('active'); }
function addCustomExercise(){
  const name=document.getElementById('custom-ex-name').value.trim();
  const muscle=document.getElementById('custom-ex-muscle').value;
  const sets=+document.getElementById('custom-ex-sets').value||3;
  const reps=+document.getElementById('custom-ex-reps').value||10;
  const weight=+document.getElementById('custom-ex-weight').value||0;
  if(!name){ showToast('Adj meg egy nevet!'); return; }
  state.customTodayExercises.push({id:'c'+Date.now(),name,muscle,sets,reps,rest:goals[state.goal].rest||60,weight,type:'custom'});
  state.customExercisesDate=new Date().toDateString();
  saveState(); renderPlan(); showToast('Gyakorlat hozzáadva');
}
function deleteCustomExercise(id){
  state.customTodayExercises=state.customTodayExercises.filter(e=>String(e.id)!==String(id));
  saveState(); renderPlan(); showToast('Gyakorlat törölve');
}

/* ---------------------------------------------------------------- ÉTREND */
function getDietDate(offset=0){ const d=new Date(state.diet.selectedDate); d.setDate(d.getDate()+offset); return d; }
function changeDietDate(offset){ state.diet.selectedDate=getDietDate(offset).toDateString(); saveState(); renderDiet(); }
function toggleAddMeal(){ document.getElementById('add-meal-form').classList.toggle('active'); }
function addMeal(){
  const name=document.getElementById('meal-name').value.trim();
  if(!name){ showToast('Adj meg egy étel nevet'); return; }
  const meal={id:'m'+Date.now(),name,
    cals:+document.getElementById('meal-cals').value||0,
    p:+document.getElementById('meal-p').value||0,
    c:+document.getElementById('meal-c').value||0,
    f:+document.getElementById('meal-f').value||0};
  const k=state.diet.selectedDate;
  (state.diet.meals[k]=state.diet.meals[k]||[]).push(meal);
  saveState(); toggleAddMeal();
  ['meal-name','meal-cals','meal-p','meal-c','meal-f'].forEach(id=>document.getElementById(id).value='');
  renderDiet();
}
function deleteMeal(id){
  const k=state.diet.selectedDate;
  if(!state.diet.meals[k]) return;
  state.diet.meals[k]=state.diet.meals[k].filter(m=>String(m.id)!==String(id));
  saveState(); renderDiet();
}
function toggleAddSupp(){ document.getElementById('add-supp-form').classList.toggle('active'); }
function addSupplement(){
  const name=document.getElementById('supp-name').value.trim();
  if(!name){ showToast('Adj meg egy nevet!'); return; }
  state.diet.supplements.push({id:'s'+Date.now(),name,
    dose:document.getElementById('supp-dose').value.trim(),
    time:document.getElementById('supp-time').value.trim()});
  saveState(); toggleAddSupp();
  ['supp-name','supp-dose','supp-time'].forEach(id=>document.getElementById(id).value='');
  renderDiet();
}
function deleteSupplement(id){
  state.diet.supplements=state.diet.supplements.filter(s=>String(s.id)!==String(id));
  saveState(); renderDiet();
}
function toggleSupplement(id){
  const k=state.diet.selectedDate;
  const taken=state.diet.takenSupplements[k]=state.diet.takenSupplements[k]||[];
  const i=taken.findIndex(x=>String(x)===String(id));
  if(i===-1) taken.push(String(id)); else taken.splice(i,1);
  saveState(); renderDiet();
}
function toggleEditGoals(){
  const f=document.getElementById('edit-goals-form');
  f.classList.toggle('active');
  if(f.classList.contains('active')){
    document.getElementById('goal-cals').value=state.diet.calorieGoal;
    document.getElementById('goal-p').value=state.diet.macrosGoal.p;
    document.getElementById('goal-c').value=state.diet.macrosGoal.c;
    document.getElementById('goal-f').value=state.diet.macrosGoal.f;
  }
}
function saveGoals(){
  state.diet.calorieGoal=+document.getElementById('goal-cals').value||2500;
  state.diet.macrosGoal.p=+document.getElementById('goal-p').value||150;
  state.diet.macrosGoal.c=+document.getElementById('goal-c').value||250;
  state.diet.macrosGoal.f=+document.getElementById('goal-f').value||70;
  saveState(); toggleEditGoals(); renderDiet(); showToast('Célok frissítve');
}

/* --- böjt --- */
let fastingInterval=null;
function toggleFast(){
  const f=state.diet.fasting;
  if(f.active){ f.active=false; f.startTime=null; }
  else{ f.active=true; f.startTime=Date.now(); }
  saveState(); renderDiet();
}
function startFastingTimer(){
  if(fastingInterval) clearInterval(fastingInterval);
  fastingInterval=setInterval(()=>{
    if(!state.diet.fasting.active){ clearInterval(fastingInterval); return; }
    updateFastingTimer();
  },1000);
  updateFastingTimer();
}
function updateFastingTimer(){
  const el=document.getElementById('fast-timer');
  if(!el) return;
  const elapsed=Date.now()-state.diet.fasting.startTime;
  const target=state.diet.fasting.protocol*3600000;
  const remaining=Math.max(0,target-elapsed);
  el.textContent=`${String(Math.floor(remaining/3600000)).padStart(2,'0')}:${String(Math.floor((remaining%3600000)/60000)).padStart(2,'0')}`;
  const ring=document.getElementById('fast-ring');
  ring.style.strokeDashoffset=251.2*(1-Math.min(1,elapsed/target));
  if(remaining===0){
    document.getElementById('fast-info').textContent='Cél elérve! Megszakíthatod a böjtöt.';
    ring.style.stroke='var(--success)';
  }else ring.style.stroke='var(--accent-2)';
}

/* ---------------------------------------------------------------- RENDER: TERV */
function renderPlan(){
  document.getElementById('today-date').textContent=formatDate();
  document.getElementById('streak-count').textContent=state.user.streak;
  document.getElementById('user-level').textContent=state.user.level;
  document.getElementById('user-title').textContent=getTitle(state.user.level);
  const need=xpForLevel(state.user.level);
  document.getElementById('user-xp').textContent=`${state.user.xp} / ${need}`;
  document.getElementById('xp-fill').style.width=(state.user.xp/need*100)+'%';
  document.getElementById('xp-to-next').textContent=`${need-state.user.xp} XP a ${state.user.level+1}. szintig`;

  const card=document.getElementById('today-workout-card');
  const today=generateTodayWorkout();
  if(state.completedToday){
    card.innerHTML=`<div class="card-elevated" style="text-align:center;padding:30px 20px">
      <div style="font-size:48px;color:var(--success);margin-bottom:12px">${ic('check-circle')}</div>
      <div class="font-display" style="font-size:24px;margin-bottom:6px">MAI CÉL TELJESÍTVE</div>
      <p style="color:var(--muted);font-size:13px;margin:0">Szép munka. Pihenj jól, és gyere vissza holnap.</p>
    </div>`;
  }else if(today && today.muscles.length>0){
    const totalSets=today.exercises.reduce((s,e)=>s+e.sets,0);
    card.innerHTML=`<div class="card-elevated" style="padding:22px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
        <div>
          <div style="font-size:10px;color:var(--accent);letter-spacing:.2em;font-weight:700">${esc(today.day.toUpperCase())}</div>
          <div class="font-display" style="font-size:30px;line-height:1">${esc(today.name.toUpperCase())}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:10px;color:var(--muted);letter-spacing:.1em">${today.exercises.length} GYAKORLAT</div>
          <div style="font-size:10px;color:var(--muted);letter-spacing:.1em">${totalSets} SZETT</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
        ${today.exercises.map(ex=>`<div style="font-size:11px;background:var(--surface);border:1px solid var(--border);padding:4px 8px;border-radius:6px;display:flex;align-items:center;gap:4px">${ex.isCustom?`<span style="color:var(--accent-2);font-size:9px">${ic('user-plus',9)}</span>`:''}${esc(ex.name)} <span style="color:var(--muted);font-size:10px">(${ex.sets}×${ex.reps})</span></div>`).join('')}
      </div>
      <button class="btn-primary" onclick="startSession()" style="margin-bottom:10px">EDZÉS INDÍTÁSA</button>
      <button class="btn-secondary" onclick="toggleAddCustomEx()">SAJÁT GYAKORLAT HOZZÁADÁSA</button>
      <div class="add-form" id="add-custom-ex-form">
        <input type="text" id="custom-ex-name" placeholder="Gyakorlat neve" class="input-text mb-2">
        <select id="custom-ex-muscle" class="input-text mb-2" style="background:var(--surface-2);color:#fff">
          <option value="chest">Mell</option><option value="back">Hát</option>
          <option value="legs">Lábak</option><option value="shoulders">Vállak</option>
          <option value="triceps">Tricepsz</option><option value="biceps">Bicepsz</option>
          <option value="core">Törzs</option>
        </select>
        <div class="grid grid-cols-3 gap-2 mb-3">
          <input type="number" inputmode="numeric" id="custom-ex-sets" placeholder="Szett" class="input-num" style="font-size:14px;padding:8px">
          <input type="number" inputmode="numeric" id="custom-ex-reps" placeholder="Ism." class="input-num" style="font-size:14px;padding:8px">
          <input type="number" inputmode="decimal" id="custom-ex-weight" placeholder="Kg" class="input-num" style="font-size:14px;padding:8px">
        </div>
        <button class="btn-primary" onclick="addCustomExercise()" style="padding:10px;font-size:13px">HOZZÁADÁS A TERVHEZ</button>
      </div>
      ${state.customTodayExercises.length>0?`
        <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
          <div style="font-size:10px;color:var(--muted);letter-spacing:.1em;margin-bottom:6px">SAJÁT GYAKORLATOK</div>
          ${state.customTodayExercises.map(ex=>`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
              <span style="font-size:13px">${esc(ex.name)} <span style="color:var(--muted);font-size:11px">(${esc(muscleNamesHu[ex.muscle]||ex.muscle)})</span></span>
              <div style="display:flex;align-items:center;gap:8px">
                <span class="font-mono" style="font-size:12px">${ex.sets}×${ex.reps} · ${ex.weight}kg</span>
                <button onclick="deleteCustomExercise('${ex.id}')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:12px">${ic('trash',12)}</button>
              </div>
            </div>`).join('')}
        </div>`:''}
    </div>`;
  }else{
    card.innerHTML=`<div class="card-elevated" style="text-align:center;padding:30px 20px">
      <div style="font-size:48px;color:var(--muted);margin-bottom:12px">${ic('bed')}</div>
      <div class="font-display" style="font-size:24px;margin-bottom:6px">PIHENŐNAP</div>
      <p style="color:var(--muted);font-size:13px;margin:0">Az izom pihenés közben nő. Ma vedd könnyebben.</p>
      <div style="margin-top:20px"><button class="btn-primary" onclick="takeRestDay()">PIHENŐ RÖGZÍTÉSE</button></div>
    </div>`;
  }

  document.getElementById('goal-grid').innerHTML=Object.entries(goals).map(([key,g])=>`
    <div class="goal-card ${state.goal===key?'active':''}" onclick="setGoal('${key}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <span style="font-size:20px;color:${state.goal===key?'var(--accent)':'var(--text)'}">${ic(g.icon,20)}</span>
        ${state.goal===key?`<span style="color:var(--accent);font-size:14px">${ic('check',14)}</span>`:''}
        ${key==='calisthenics'?`<span onclick="event.stopPropagation();showCalisthenicsInfo()" style="color:var(--muted);font-size:14px;cursor:pointer">${ic('info',14)}</span>`:''}
      </div>
      <div class="font-display" style="font-size:17px;line-height:1.1;margin-bottom:4px">${esc(g.name.toUpperCase())}</div>
      <div style="font-size:10px;color:var(--muted)">${esc(g.desc)}</div>
    </div>`).join('');

  const todayStr=getDayOfWeek();
  document.getElementById('weekly-schedule').innerHTML=goals[state.goal].split.workouts.map(w=>{
    let cls='day-pill';
    if(w.day===todayStr) cls+=' today';
    else if(w.muscles.length===0) cls+=' rest';
    return `<div class="${cls}"><span style="font-size:9px;opacity:.7">${esc(w.day.toUpperCase())}</span><span style="font-size:8px;font-weight:700">${w.muscles.length===0?'PIHEN':esc(w.name.split(' ')[0].toUpperCase())}</span></div>`;
  }).join('');

  renderRecovery();
}

function renderRecovery(){
  const muscles=['chest','back','legs','shoulders','arms','core'];
  let ready=0;
  document.getElementById('recovery-card').innerHTML=muscles.map(m=>{
    const r=getRecoveryLevel(m);
    if(r.label==='KÉSZ') ready++;
    return `<div class="muscle-row">
      <div class="label">${muscleNamesHu[m]}</div>
      <div class="muscle-bar"><div class="muscle-bar-fill" style="width:${r.pct}%;background:${r.color}"></div></div>
      <div class="status" style="color:${r.color};width:80px;text-align:right">${r.label}</div>
    </div>`;
  }).join('');
  document.getElementById('recovery-summary').textContent=`${ready} / ${muscles.length} kész`;

  document.querySelectorAll('.muscle-part-recov').forEach(el=>{
    const r=getRecoveryLevel(el.dataset.muscle);
    el.style.fill = r.label==='KÉSZ' ? 'rgba(0,217,111,0.4)' : (r.label==='PIHEN' ? 'rgba(255,92,31,0.5)' : 'rgba(255,184,0,0.4)');
  });
  const legend=document.getElementById('recovery-legend');
  if(legend) legend.innerHTML=muscles.map(m=>{
    const r=getRecoveryLevel(m);
    return `<div class="muscle-row" style="padding:5px 0">
      <div class="label" style="font-size:12px">${muscleNamesHu[m]}</div>
      <div class="status" style="color:${r.color};font-size:10px">${r.label}</div></div>`;
  }).join('');
}

/* ---------------------------------------------------------------- RENDER: EDZÉS */
function renderTrain(){
  const empty=document.getElementById('train-empty'),
        active=document.getElementById('train-active'),
        summary=document.getElementById('train-summary');
  if(state.activeSession && state.activeSession.finished){
    empty.style.display='none'; active.style.display='none'; summary.style.display='block'; return;
  }
  if(!state.activeSession || !state.activeSession.started){
    empty.style.display='block'; active.style.display='none'; summary.style.display='none'; return;
  }
  empty.style.display='none'; active.style.display='block'; summary.style.display='none';

  const s=state.activeSession;
  const ex=s.exercises[s.currentExerciseIndex];
  if(!ex) return;
  document.getElementById('session-day-name').textContent=s.workoutName.toUpperCase();
  document.getElementById('exercise-counter').textContent=`GYAKORLAT ${s.currentExerciseIndex+1} / ${s.exercises.length}`;
  const totalSets=s.exercises.reduce((sum,e)=>sum+e.sets,0);
  document.getElementById('session-progress').style.width=(s.completedSets.length/totalSets*100)+'%';
  const vol=s.completedSets.reduce((sum,set)=>sum+set.weight*set.reps,0);
  document.getElementById('volume-so-far').textContent=`${vol.toLocaleString('hu')} KG MEGEMELVE`;
  const cat=muscleCategoryMap[ex.muscle]||'core';
  document.getElementById('muscle-target').textContent=(muscleNamesHu[ex.muscle]||ex.muscle).toUpperCase();
  document.getElementById('exercise-name').innerHTML=esc(ex.name.toUpperCase()).replace(/ /g,'<br>');
  document.getElementById('set-display').textContent=`${s.currentSet}/${ex.sets}`;
  document.getElementById('reps-display').textContent=ex.reps;
  document.getElementById('weight-display').textContent=ex.weight;
  document.getElementById('weight-input').value=ex.weight;
  document.getElementById('reps-input').value=ex.reps;

  document.querySelectorAll('.muscle-part').forEach(el=>{
    const on=el.dataset.muscle===cat;
    el.style.fill=on?'var(--accent)':'#2a2a2e';
    el.style.filter=on?'drop-shadow(0 0 6px var(--accent))':'none';
  });

  const ind=document.getElementById('set-indicators');
  ind.innerHTML='';
  for(let i=1;i<=ex.sets;i++){
    const dot=document.createElement('div');
    dot.className='set-dot'+(i<s.currentSet?' done':'')+(i===s.currentSet?' current':'');
    ind.appendChild(dot);
  }
}

/* ---------------------------------------------------------------- RENDER: ÉTREND */
function renderDiet(){
  const d=new Date(state.diet.selectedDate);
  const todayStr=new Date().toDateString();
  const isToday=state.diet.selectedDate===todayStr;
  document.getElementById('diet-day-label').textContent=isToday?'MA':(d<new Date(todayStr)?'MÚLT':'JÖVŐ');
  const months=['Jan','Feb','Már','Ápr','Máj','Jún','Júl','Aug','Szep','Okt','Nov','Dec'];
  document.getElementById('diet-date-label').textContent=`${months[d.getMonth()]} ${d.getDate()}.`;

  const key=state.diet.selectedDate;
  const meals=state.diet.meals[key]||[];
  const t={cals:0,p:0,c:0,f:0};
  meals.forEach(m=>{t.cals+=m.cals;t.p+=m.p;t.c+=m.c;t.f+=m.f;});

  document.getElementById('cal-consumed').textContent=t.cals;
  document.getElementById('cal-goal-display').textContent=state.diet.calorieGoal;
  const rem=state.diet.calorieGoal-t.cals;
  document.getElementById('cal-remaining').textContent=Math.abs(rem);
  document.getElementById('cal-status').textContent=rem>=0?'KCAL HÁTRAVAN':'KCAL FELETT';
  document.getElementById('cal-status').style.color=rem>=0?'var(--accent)':'var(--danger)';
  const ring=document.getElementById('cal-ring');
  ring.style.strokeDashoffset=314.16*(1-Math.min(1,t.cals/state.diet.calorieGoal));
  ring.style.stroke=rem>=0?'var(--accent)':'var(--danger)';

  [['p',t.p,state.diet.macrosGoal.p],['c',t.c,state.diet.macrosGoal.c],['f',t.f,state.diet.macrosGoal.f]].forEach(([k,val,goal])=>{
    document.getElementById(k+'-consumed').textContent=val;
    document.getElementById(k+'-goal').textContent=goal;
    document.getElementById(k+'-bar').style.width=Math.min(100,val/goal*100)+'%';
  });

  const ml=document.getElementById('meals-list');
  ml.innerHTML = meals.length===0
    ? `<div style="text-align:center;color:var(--muted);font-size:13px;padding:10px 0">Még nincs rögzített étkezés.</div>`
    : meals.map(m=>`<div class="meal-item">
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${esc(m.name)}</div>
          <div class="font-mono" style="font-size:10px;color:var(--muted)">F:${m.p}g · Sz:${m.c}g · Z:${m.f}g</div>
        </div>
        <div style="text-align:right;display:flex;align-items:center;gap:10px">
          <div>
            <div class="font-mono" style="font-size:16px;font-weight:700;color:var(--accent)">${m.cals}</div>
            <div style="font-size:9px;color:var(--muted);text-transform:uppercase">kcal</div>
          </div>
          <button class="icon-btn" onclick="deleteMeal('${m.id}')" style="width:30px;height:30px;background:transparent;border:none;color:var(--muted);font-size:12px">${ic('trash',12)}</button>
        </div></div>`).join('');

  const taken=state.diet.takenSupplements[key]||[];
  document.getElementById('supplements-list').innerHTML=state.diet.supplements.map(s=>{
    const on=taken.some(x=>String(x)===String(s.id));
    return `<div class="supplement-item ${on?'taken':''}" onclick="toggleSupplement('${s.id}')">
      <div class="supplement-check">${on?ic('check',12):''}</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:14px">${esc(s.name)}</div>
        <div style="font-size:11px;color:var(--muted)">${esc(s.dose||'')}${s.dose&&s.time?' · ':''}${esc(s.time||'')}</div>
      </div>
      <button onclick="event.stopPropagation();deleteSupplement('${s.id}')" style="background:none;border:none;color:var(--danger);cursor:pointer;padding:4px;font-size:12px">${ic('trash',12)}</button>
    </div>`;
  }).join('');

  const fs=document.getElementById('fast-status');
  if(state.diet.fasting.active){
    document.getElementById('fast-info').textContent='Böjt aktív. Maradj erős.';
    document.getElementById('fast-btn').textContent='BÖJT MEGSZAKÍTÁSA';
    fs.textContent='BÖJTÖL'; fs.style.background='rgba(255,92,31,0.2)'; fs.style.color='var(--accent-2)';
    startFastingTimer();
  }else{
    if(fastingInterval){ clearInterval(fastingInterval); fastingInterval=null; }
    document.getElementById('fast-info').textContent='Indíts böjtöt a 16 órás ablakhoz.';
    document.getElementById('fast-btn').textContent='BÖJT KEZDÉSE';
    fs.textContent='INAKTÍV'; fs.style.background='transparent'; fs.style.color='var(--muted)';
    document.getElementById('fast-timer').textContent='16:00';
    document.getElementById('fast-ring').style.strokeDashoffset=251.2;
    document.getElementById('fast-ring').style.stroke='var(--accent-2)';
  }
}

/* ---------------------------------------------------------------- RENDER: STAT */
function renderProgress(){
  const chart=document.getElementById('volume-chart'), labels=document.getElementById('volume-chart-labels');
  const recent=realWorkouts(state).slice(-7);
  const maxVol=Math.max(1000,...recent.map(w=>w.volume));
  while(chart.children.length<7){
    const bar=document.createElement('div'); bar.style.flex='1'; bar.className='chart-bar'; chart.appendChild(bar);
    const l=document.createElement('div'); l.style.cssText='flex:1;text-align:center;font-size:9px;color:var(--muted)'; labels.appendChild(l);
  }
  for(let i=0;i<7;i++){
    const w=recent[i], bar=chart.children[i], l=labels.children[i];
    if(w){
      bar.style.height=(w.volume/maxVol*100)+'%'; bar.style.opacity='1';
      const d=new Date(w.date); l.textContent=`${d.getMonth()+1}/${d.getDate()}`;
    }else{ bar.style.height='4px'; bar.style.opacity='0.3'; l.textContent='—'; }
  }

  const prGrid=document.getElementById('pr-grid');
  const prs=Object.entries(state.personalRecords);
  prGrid.innerHTML = prs.length===0
    ? `<div class="card" style="grid-column:span 2;text-align:center;color:var(--muted);font-size:13px">Még nincs rekord. Kezdj el emelni!</div>`
    : prs.slice(0,6).map(([name,w])=>`<div class="stat-tile" style="text-align:left">
        <div style="font-size:10px;color:var(--muted);letter-spacing:.1em;margin-bottom:4px;text-transform:uppercase">${esc(name)}</div>
        <div class="font-mono" style="font-size:20px;font-weight:700;color:var(--accent)">${w} kg</div></div>`).join('');

  const vols={};
  state.workouts.forEach(w=>{ if(w.muscleVolume) Object.entries(w.muscleVolume).forEach(([m,v])=>vols[m]=(vols[m]||0)+v); });
  const ms=Object.keys(vols).sort((a,b)=>vols[b]-vols[a]);
  const mb=document.getElementById('muscle-breakdown');
  mb.innerHTML = ms.length===0
    ? `<div style="text-align:center;color:var(--muted);font-size:13px;padding:10px">Fejezz be egy edzést az elemzéshez</div>`
    : ms.slice(0,6).map(m=>`<div class="muscle-row">
        <div class="label" style="width:80px;flex:none">${esc(muscleNamesHu[m]||m)}</div>
        <div class="muscle-bar" style="flex:1;width:auto"><div class="muscle-bar-fill" style="width:${vols[m]/vols[ms[0]]*100}%;background:var(--accent)"></div></div>
        <div class="font-mono" style="font-size:12px;width:70px;text-align:right;color:var(--accent);font-weight:700">${vols[m].toLocaleString('hu')}kg</div>
      </div>`).join('');

  renderRecovery();
}

/* ---------------------------------------------------------------- RENDER: PROFIL */
function renderProfile(){
  document.getElementById('profile-level').textContent=state.user.level;
  document.getElementById('profile-title').textContent=getTitle(state.user.level);
  document.getElementById('profile-total-xp').textContent=`${state.user.totalXp.toLocaleString('hu')} ÖSSZES XP`;
  document.getElementById('profile-workouts').textContent=realWorkouts(state).length;
  document.getElementById('profile-streak').textContent=state.user.streak;
  const totalVol=state.workouts.reduce((s,w)=>s+w.volume,0);
  document.getElementById('profile-volume').textContent=totalVol>1000?(totalVol/1000).toFixed(1)+'t':totalVol;
  const totalSec=state.workouts.reduce((s,w)=>s+(w.duration||0),0);
  document.getElementById('profile-time').textContent=Math.floor(totalSec/3600)+'ó '+Math.floor((totalSec%3600)/60)+'p';

  let unlocked=0;
  document.getElementById('achievements-grid').innerHTML=achievements.map(a=>{
    const on=state.achievements.includes(a.id);
    if(on) unlocked++;
    return `<div class="achievement ${on?'unlocked':'locked'}">
      <div class="achievement-icon">${ic(a.icon,18)}</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:.03em;line-height:1.1">${esc(a.name.toUpperCase())}</div>
    </div>`;
  }).join('');
  document.getElementById('achievement-count').textContent=`${unlocked} / ${achievements.length}`;
  document.getElementById('app-version').textContent=APP_VERSION;
}

function renderAll(){ renderPlan(); renderTrain(); renderDiet(); renderProgress(); renderProfile(); }

/* ---------------------------------------------------------------- NAVIGÁCIÓ */
function switchScreen(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+name).classList.add('active');
  document.querySelectorAll('.tab-item').forEach(t=>t.classList.remove('active'));
  const tab=document.querySelector(`.tab-item[data-screen="${name}"]`);
  if(tab) tab.classList.add('active');
  if(name==='plan') renderPlan();
  if(name==='train') renderTrain();
  if(name==='diet') renderDiet();
  if(name==='progress') renderProgress();
  if(name==='profile') renderProfile();
  document.getElementById('app').scrollTop=0;
}
document.querySelectorAll('.tab-item').forEach(t=>t.addEventListener('click',()=>switchScreen(t.dataset.screen)));
document.querySelectorAll('.anatomy-muscle').forEach(m=>m.addEventListener('click',()=>tapMuscle(m.dataset.muscle)));

function setGoal(g){ state.goal=g; saveState(); renderPlan(); showToast(`Cél: ${goals[g].name}`); }

/* ---------------------------------------------------------------- EDZÉS-FOLYAMAT */
function startSession(){
  if(state.completedToday){ showToast('Ma már befejezted. Gyere vissza holnap!'); return; }
  const today=generateTodayWorkout();
  if(!today || today.muscles.length===0){ showToast('Ma pihenőnap van.'); return; }
  state.activeSession={
    workoutName:today.name,
    exercises:JSON.parse(JSON.stringify(today.exercises)),
    currentExerciseIndex:0, currentSet:1, startTime:Date.now(),
    completedSets:[], finished:false, started:false, newPRs:[], newAchievements:[]
  };
  state.selectedMuscleFilter=null; state.highlightedExercise=null;
  setAnatomyView('front');
  document.getElementById('anatomy-day-name').textContent=today.name.toUpperCase();
  document.getElementById('anatomy-hint').textContent='KOPPINTS EGY GYAKORLATRA VAGY IZOMRA';
  renderAnatomyExerciseList(); updateAnatomyHighlights();
  saveState(); switchScreen('anatomy');
}
function actuallyStartSession(){
  if(!state.activeSession) return;
  state.activeSession.started=true;
  state.activeSession.startTime=Date.now();
  saveState(); switchScreen('train'); startSessionTimer(); requestWakeLock();
}
function takeRestDay(){
  if(state.completedToday){ showToast('Ma már pihentél. Gyere vissza holnap!'); return; }
  const xpGained=25;
  grantXp(xpGained);
  bumpStreak();
  state.completedToday=true;
  state.workouts.push({date:Date.now(),name:'Pihenőnap',duration:0,volume:0,sets:0,xpGained,muscleVolume:{},isRest:true});
  saveState(); showToast('Pihenőnap rögzítve · +25 XP'); renderAll();
}
function grantXp(amount){
  state.user.xp+=amount; state.user.totalXp+=amount;
  while(state.user.xp>=xpForLevel(state.user.level)){
    state.user.xp-=xpForLevel(state.user.level); state.user.level++;
    showToast(`SZINTLÉPÉS! ${state.user.level}. szint — ${getTitle(state.user.level)}`);
  }
}
function bumpStreak(){
  const today=new Date().toDateString();
  if(state.user.lastWorkoutDate===today) return;
  const yesterday=new Date(Date.now()-86400000).toDateString();
  state.user.streak = state.user.lastWorkoutDate===yesterday ? state.user.streak+1 : 1;
  state.user.lastWorkoutDate=today;
}

let sessionTimerInt=null;
function startSessionTimer(){
  if(sessionTimerInt) clearInterval(sessionTimerInt);
  sessionTimerInt=setInterval(()=>{
    const s=state.activeSession;
    if(!s || s.finished){ clearInterval(sessionTimerInt); return; }
    const e=Math.floor((Date.now()-s.startTime)/1000);
    document.getElementById('session-time').textContent=
      String(Math.floor(e/60)).padStart(2,'0')+':'+String(e%60).padStart(2,'0');
  },1000);
}

function curEx(){ const s=state.activeSession; return s ? s.exercises[s.currentExerciseIndex] : null; }
function adjustWeight(delta){
  const ex=curEx(); if(!ex) return;
  ex.weight=Math.max(0,+(ex.weight+delta).toFixed(2));
  document.getElementById('weight-input').value=ex.weight;
  document.getElementById('weight-display').textContent=ex.weight;
}
function setWeight(w){
  const ex=curEx(); if(!ex) return;
  ex.weight=w;
  document.getElementById('weight-input').value=w;
  document.getElementById('weight-display').textContent=w;
}
function adjustReps(delta){
  const ex=curEx(); if(!ex) return;
  ex.reps=Math.max(1,ex.reps+delta);
  document.getElementById('reps-input').value=ex.reps;
  document.getElementById('reps-display').textContent=ex.reps;
}
document.addEventListener('change',e=>{
  const ex=curEx(); if(!ex) return;               // aktív edzés nélkül ne fusson
  if(e.target.id==='weight-input'){
    ex.weight=Math.max(0,+e.target.value||0);
    document.getElementById('weight-display').textContent=ex.weight;
  }
  if(e.target.id==='reps-input'){
    ex.reps=Math.max(1,+e.target.value||1);
    document.getElementById('reps-display').textContent=ex.reps;
  }
});

function advance(restSeconds){
  const s=state.activeSession, ex=s.exercises[s.currentExerciseIndex];
  if(s.currentSet<ex.sets){ s.currentSet++; startRestTimer(restSeconds); }
  else{
    s.currentExerciseIndex++; s.currentSet=1;
    if(s.currentExerciseIndex>=s.exercises.length) finishSession();
    else startRestTimer(restSeconds);
  }
  saveState();
}
function completeSet(){
  const s=state.activeSession; if(!s) return;
  const ex=s.exercises[s.currentExerciseIndex];
  s.completedSets.push({exercise:ex.name,muscle:ex.muscle,set:s.currentSet,weight:ex.weight,reps:ex.reps});
  state.lastWeights[ex.name]=ex.weight;
  const pr=state.personalRecords[ex.name]||0;
  if(ex.weight>pr && ex.weight>0){
    state.personalRecords[ex.name]=ex.weight;
    s.newPRs.push({name:ex.name,weight:ex.weight});
  }
  vibrate(40);
  advance(ex.rest);
}
function skipSet(){
  const s=state.activeSession; if(!s) return;
  showToast('Szett kihagyva');
  advance(Math.round(s.exercises[s.currentExerciseIndex].rest/2));
}
function skipExercise(){
  const s=state.activeSession; if(!s) return;
  s.currentExerciseIndex++; s.currentSet=1;
  if(s.currentExerciseIndex>=s.exercises.length) finishSession();
  else { showToast('Gyakorlat kihagyva'); renderTrain(); }
  saveState();
}
function cancelSession(){
  askConfirm('Edzés megszakítása?','Az eddig rögzített szettek elvesznek.','MEGSZAKÍTÁS',()=>{
    state.activeSession=null; endRestTimer(); releaseWakeLock();
    if(sessionTimerInt) clearInterval(sessionTimerInt);
    saveState(); switchScreen('plan');
  });
}

/* --- pihenő időzítő --- */
let restInterval=null, restState=null;
function startRestTimer(seconds){
  if(!seconds || seconds<=0){ renderTrain(); return; }
  if(restInterval) clearInterval(restInterval);
  restState={total:seconds,remaining:seconds};
  renderTrain();                                   // a háttérben már a köv. szett látszódjon
  const overlay=document.getElementById('timer-overlay');
  overlay.classList.add('active');
  document.getElementById('timer-display').textContent=fmtClock(seconds);
  const circle=document.getElementById('timer-circle');
  const C=2*Math.PI*130;
  circle.style.strokeDasharray=C; circle.style.strokeDashoffset='0';

  const s=state.activeSession;
  const nextEx=s.exercises[s.currentExerciseIndex];
  document.getElementById('next-exercise').textContent = nextEx
    ? `${nextEx.name.toUpperCase()} · ${s.currentSet}. SZETT` : 'EDZÉS BEFEJEZVE';

  setTimeout(()=>{ circle.style.strokeDashoffset=C; },50);
  restInterval=setInterval(()=>{
    restState.remaining--;
    document.getElementById('timer-display').textContent=fmtClock(restState.remaining);
    circle.style.strokeDashoffset=C*(1-restState.remaining/restState.total);
    if(restState.remaining<=3 && restState.remaining>0) vibrate(30);
    if(restState.remaining<=0){ beep(); vibrate([120,60,120]); endRestTimer(); renderTrain(); }
  },1000);
}
function endRestTimer(){
  if(restInterval) clearInterval(restInterval);
  restInterval=null; restState=null;
  document.getElementById('timer-overlay').classList.remove('active');
}
function skipRest(){ endRestTimer(); renderTrain(); }
function addRestTime(){
  if(!restState) return;
  restState.total+=15; restState.remaining+=15;
  const circle=document.getElementById('timer-circle');
  const C=2*Math.PI*130;
  circle.style.strokeDasharray=C;
  circle.style.strokeDashoffset=C*(1-restState.remaining/restState.total);
  document.getElementById('timer-display').textContent=fmtClock(restState.remaining);
}

/* --- befejezés + összegzés --- */
function finishSession(){
  const s=state.activeSession;
  s.finished=true;
  endRestTimer(); releaseWakeLock();
  if(sessionTimerInt) clearInterval(sessionTimerInt);

  const duration=Math.floor((Date.now()-s.startTime)/1000);
  const volume=s.completedSets.reduce((sum,set)=>sum+set.weight*set.reps,0);
  const sets=s.completedSets.length;
  const muscleVol={};
  s.completedSets.forEach(set=>{ muscleVol[set.muscle]=(muscleVol[set.muscle]||0)+set.weight*set.reps; });
  // A regeneráció a testtérkép régióira íródik (a tricepsz/bicepsz a "karra"),
  // különben a kar sosem frissült volna.
  Object.keys(muscleVol).forEach(m=>{ state.muscleRecovery[muscleCategoryMap[m]||m]=Date.now(); });

  const xpGained=Math.floor(volume/100)+sets*5+50;
  grantXp(xpGained);
  bumpStreak();

  state.workouts.push({date:Date.now(),name:s.workoutName,duration,volume,sets,xpGained,muscleVolume:muscleVol});
  state.completedToday=true;
  achievements.forEach(a=>{
    if(!state.achievements.includes(a.id) && a.check(state)){
      state.achievements.push(a.id); s.newAchievements.push(a);
    }
  });
  saveState(); renderTrain();

  document.getElementById('summary-title').textContent=s.workoutName.toUpperCase()+' VÉGE';
  document.getElementById('summary-duration').textContent=`${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')}`;
  document.getElementById('summary-volume').textContent=volume.toLocaleString('hu')+' kg';
  document.getElementById('summary-sets').textContent=sets;
  document.getElementById('summary-xp').textContent='+'+xpGained;

  const prBox=document.getElementById('summary-prs');
  if(s.newPRs.length){
    prBox.style.display='block';
    document.getElementById('summary-prs-list').innerHTML=s.newPRs.map(pr=>
      `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:13px">${esc(pr.name)}</span>
        <span class="font-mono" style="color:var(--warning);font-weight:700">${pr.weight}kg <span class="pr-badge">PR</span></span></div>`).join('');
  }else prBox.style.display='none';

  const achBox=document.getElementById('summary-achievements');
  if(s.newAchievements.length){
    achBox.style.display='block';
    document.getElementById('summary-achievements-list').innerHTML=s.newAchievements.map(a=>
      `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)">
        <div class="achievement-icon" style="width:36px;height:36px;font-size:16px;background:var(--accent);color:#000">${ic(a.icon,16)}</div>
        <div><div style="font-size:13px;font-weight:700">${esc(a.name)}</div>
        <div style="font-size:11px;color:var(--muted)">${esc(a.desc)}</div></div></div>`).join('');
  }else achBox.style.display='none';

  beep(); vibrate([100,50,100,50,200]); confetti(); renderAll();
}
function finishSummary(){ state.activeSession=null; saveState(); switchScreen('plan'); }

/* ---------------------------------------------------------------- ADATOK */
function exportData(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='fitmates-mentes-'+new Date().toISOString().slice(0,10)+'.json';
  a.click(); URL.revokeObjectURL(url);
  showToast('Mentés letöltve');
}
function importData(){
  const inp=document.createElement('input');
  inp.type='file'; inp.accept='application/json';
  inp.onchange=()=>{
    const f=inp.files[0]; if(!f) return;
    const r=new FileReader();
    r.onload=()=>{
      try{
        const o=JSON.parse(r.result);
        if(!o.user) throw new Error('hibás fájl');
        state=deepMerge(JSON.parse(JSON.stringify(DEFAULT_STATE)),o);
        saveState(); renderAll(); switchScreen('plan'); showToast('Mentés visszatöltve');
      }catch(e){ showToast('Hibás mentésfájl'); }
    };
    r.readAsText(f);
  };
  inp.click();
}
function resetData(){
  askConfirm('Minden adat törlése?','Ez véglegesen törli az edzéseidet, szintedet és jelvényeidet. Nem visszavonható.','TÖRLÉS',()=>{
    state=JSON.parse(JSON.stringify(DEFAULT_STATE));
    saveState(); renderAll(); switchScreen('plan'); showToast('Adatok törölve');
  });
}

/* ---------------------------------------------------------------- INDÍTÁS */
function updateClock(){
  const d=new Date();
  document.getElementById('clock').textContent=`${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
}
updateClock(); setInterval(updateClock,30000);

// napváltás: mai teljesítés, saját gyakorlatok és étrend-dátum visszaállítása
(function newDayCheck(){
  const today=new Date().toDateString();
  if(state.user.lastWorkoutDate && state.user.lastWorkoutDate!==today) state.completedToday=false;
  if(state.customExercisesDate && state.customExercisesDate!==today){
    state.customTodayExercises=[]; state.customExercisesDate=null;
  }
  if(state.diet.selectedDate!==today && new Date(state.diet.selectedDate)<new Date(today)) state.diet.selectedDate=today;
  // a sorozat akkor szakad meg, ha 1 teljes napot kihagytál
  if(state.user.lastWorkoutDate){
    const diff=Math.round((midnight(new Date())-midnight(new Date(state.user.lastWorkoutDate)))/86400000);
    if(diff>1) state.user.streak=0;
  }
  saveState();
})();

// félbehagyott edzés visszaállítása újratöltés után
if(state.activeSession && state.activeSession.started && !state.activeSession.finished){
  startSessionTimer(); requestWakeLock();
}

function scalePhone(){
  const wrap=document.querySelector('.phone-wrap');
  if(window.innerWidth<=760){ wrap.style.transform='none'; return; }
  wrap.style.transform=`scale(${Math.min(1,window.innerHeight/880,window.innerWidth/420)})`;
}
window.addEventListener('resize',scalePhone); scalePhone();

renderAll();

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
