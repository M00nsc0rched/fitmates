/* ============================================================================
   FIT MATES — edzéskövető PWA
   A verziószám EGYEZIK a sw.js CACHE nevében lévő számmal (fitmates-vN).
   ========================================================================== */
'use strict';
const APP_VERSION = 8;

/* ---------------------------------------------------------------- ÁLLAPOT */
const DEFAULT_STATE = {
  user:{level:1,xp:0,streak:0,lastWorkoutDate:null,totalXp:0,name:''},
  weeklyGoal:4,
  weekPlan:null,                                // saját heti beosztás (null = DEFAULT_WEEK)
  todayFocus:null,                              // {date, id} — a mai terv kézi átírása
  planImages:{},                                // terv-típus -> saját kép (dataURL)
  savedExercises:[],                            // elmentett saját gyakorlatok (Profil)
  goal:'build',
  muscleRecovery:{},                            // izomcsoport -> utolsó terhelés időpontja (migrateRecovery tölti)
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
/* A regeneráció korábban 6 durva csoportot tárolt (chest/back/legs/shoulders/
   arms/core). A 16 finom csoportra való átváltásnál a régi időpontokat
   szétosztjuk az utódcsoportok között, hogy az előzmények ne vesszenek el. */
function migrateRecovery(rec){
  const out={};
  MUSCLE_KEYS.forEach(k=>out[k]=0);
  Object.entries(rec||{}).forEach(([k,v])=>{
    if(!v) return;
    if(MUSCLES[k]){ out[k]=Math.max(out[k],v); return; }
    groupsOf(k).forEach(g=>{ if(out[g]!==undefined) out[g]=Math.max(out[g],v); });
  });
  return out;
}
/* ============================================================================
   TÁROLÁS — KÉT PÁRHUZAMOS MÁSOLAT
   A localStorage-t a böngésző/iOS bizonyos helyzetekben kiüríti (privát
   böngészés, tárhely-szűke, adattörlés), és akkor MINDEN elveszne. Ezért
   minden mentés EGYSZERRE megy localStorage-ba és IndexedDB-be; induláskor a
   FRISSEBB példány nyer. Ha az egyik tár kiürül, a másikból visszatér az adat.
   ========================================================================== */
const IDB_NAME='fitmates', IDB_STORE='kv', IDB_KEY='state';
const SAVE_INFO={ls:null, idb:null, lastOk:0, lastErr:'', size:0, persisted:null, usage:null, quota:null};

function idbOpen(){
  return new Promise((ok,no)=>{
    if(!window.indexedDB) return no(new Error('nincs IndexedDB'));
    const r=indexedDB.open(IDB_NAME,1);
    r.onupgradeneeded=()=>{ if(!r.result.objectStoreNames.contains(IDB_STORE)) r.result.createObjectStore(IDB_STORE); };
    r.onsuccess=()=>ok(r.result);
    r.onerror=()=>no(r.error||new Error('IndexedDB hiba'));
  });
}
function idbSet(k,v){
  return idbOpen().then(db=>new Promise((ok,no)=>{
    const t=db.transaction(IDB_STORE,'readwrite');
    t.objectStore(IDB_STORE).put(v,k);
    t.oncomplete=()=>{db.close();ok(true);};
    t.onerror=()=>{db.close();no(t.error);};
  }));
}
function idbGet(k){
  return idbOpen().then(db=>new Promise((ok,no)=>{
    const t=db.transaction(IDB_STORE,'readonly');
    const rq=t.objectStore(IDB_STORE).get(k);
    rq.onsuccess=()=>{db.close();ok(rq.result);};
    rq.onerror=()=>{db.close();no(rq.error);};
  }));
}
function idbDel(k){ return idbOpen().then(db=>new Promise(ok=>{
  const t=db.transaction(IDB_STORE,'readwrite'); t.objectStore(IDB_STORE).delete(k);
  t.oncomplete=()=>{db.close();ok(true);}; t.onerror=()=>{db.close();ok(false);};
})); }

function parseSave(raw){
  const s = deepMerge(JSON.parse(JSON.stringify(DEFAULT_STATE)), JSON.parse(raw));
  s.muscleRecovery = migrateRecovery(s.muscleRecovery);
  return s;
}
/* Ha volt mentés, de nem sikerült értelmezni (sérült vagy ismeretlen szerkezet),
   NEM írjuk felül: félretesszük, és a mentés le van tiltva, amíg a felhasználó
   nem dönt. Enélkül egyetlen hibás betöltés véglegesen kinullázna mindent. */
let LOAD_ERROR=null, ALLOW_WIPE=false;
function loadState(){
  let raw=null;
  try{ raw = localStorage.getItem(LS_KEY) || localStorage.getItem(LS_LEGACY); }catch(e){}
  if(raw){
    try{ return parseSave(raw); }
    catch(e){
      LOAD_ERROR=(e&&e.message)||String(e);
      console.warn('A mentést nem sikerült értelmezni — félretéve.', e);
      try{ localStorage.setItem(LS_KEY+'_serult', raw); }catch(e2){}
    }
  }
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}
// „üresnek” az számít, amiben sem edzés, sem összegyűjtött XP nincs
function ureseNekTunik(s){
  return (!s || !s.workouts || s.workouts.length===0) && (!s || !s.user || !s.user.totalXp);
}
function saveState(){
  /* VÉDELEM: üres állapot soha ne írjon felül tartalmas mentést. Ez fogja meg
     a „minden eltűnt” esetet akkor is, ha egy jövőbeli hiba nullázná az appot. */
  if(!ALLOW_WIPE && ureseNekTunik(state)){
    if(LOAD_ERROR){ mentesFigyelmeztetes(); return; }
    try{
      const prev=localStorage.getItem(LS_KEY);
      if(prev && !ureseNekTunik(JSON.parse(prev))){
        console.warn('Üres állapot mentése megtagadva — a meglévő mentés érintetlen.');
        return;
      }
    }catch(e){}
  }
  state.savedAt = Date.now();
  let json;
  try{ json = JSON.stringify(state); }catch(e){ return; }
  SAVE_INFO.size = json.length;
  try{
    localStorage.setItem(LS_KEY, json);
    SAVE_INFO.ls=true; SAVE_INFO.lastOk=Date.now();
  }catch(e){
    SAVE_INFO.ls=false; SAVE_INFO.lastErr=(e && e.name) || String(e);
    mentesFigyelmeztetes();
  }
  idbSet(IDB_KEY,json)
    .then(()=>{ SAVE_INFO.idb=true; SAVE_INFO.lastOk=Date.now(); })
    .catch(e=>{ SAVE_INFO.idb=false; SAVE_INFO.lastErr=(e&&e.name)||String(e); mentesFigyelmeztetes(); });
}
let mentesFigyelmeztetveAt=0;
function mentesFigyelmeztetes(){
  if(SAVE_INFO.ls || SAVE_INFO.idb) return;            // legalább az egyik tár él
  if(Date.now()-mentesFigyelmeztetveAt < 30000) return;
  mentesFigyelmeztetveAt=Date.now();
  showToast('⚠ A mentés nem sikerül — nézd meg a Profil / Mentés állapota részt');
}

let state = loadState();

/* Az IndexedDB aszinkron, ezért a localStorage-ból indulunk, és utólag
   ellenőrizzük, van-e FRISSEBB példány a tartalék tárban. */
async function hydrateFromIDB(){
  try{
    const raw = await idbGet(IDB_KEY);
    SAVE_INFO.idb = true;
    if(!raw){ saveState(); return; }                   // első futás: másolat készítése
    const other = JSON.parse(raw);
    if((other.savedAt||0) > (state.savedAt||0)){
      state = parseSave(raw);
      renderAll();
      showToast('Mentés visszaállítva a tartalék tárból');
    }
  }catch(e){ SAVE_INFO.idb=false; SAVE_INFO.lastErr=(e&&e.name)||String(e); }
}
/* Tartós tárolás kérése: így a böngésző nem üríti helyszűkében. */
async function kerTartosTarolast(){
  try{
    if(navigator.storage && navigator.storage.persisted){
      SAVE_INFO.persisted = await navigator.storage.persisted();
      if(!SAVE_INFO.persisted && navigator.storage.persist)
        SAVE_INFO.persisted = await navigator.storage.persist();
    }
    if(navigator.storage && navigator.storage.estimate){
      const e=await navigator.storage.estimate();
      SAVE_INFO.usage=e.usage; SAVE_INFO.quota=e.quota;
    }
  }catch(e){}
}
// az app elrejtésekor/bezárásakor még egy biztonsági mentés
['pagehide','freeze'].forEach(ev=>window.addEventListener(ev,()=>saveState()));
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') saveState(); });

/* ---------------------------------------------------------------- IKONOK */
function ic(name, size){
  return `<svg class="ic"${size?` style="font-size:${size}px"`:''}><use href="#i-${name}"/></svg>`;
}

/* ============================================================================
   ANATÓMIAI TESTÁBRA (elöl- és hátulnézet)
   A körvonal és az izomcsoportok pontlistákból, Catmull-Rom simítással
   készülnek — a jobb oldali alakzatokat tükrözzük, így az ábra garantáltan
   szimmetrikus. Minden izomcsoport ÖNÁLLÓ <path> data-muscle attribútummal,
   ezért marad kattintható és külön színezhető (kiemelés, regenerációs
   hőtérkép). Ezért nem raszterkép: azt nem lehetne csoportonként színezni.
   ========================================================================== */
const BODY_VB = '0 0 200 430';

// pontlistából lekerekített útvonal (Catmull-Rom → köbös Bézier)
function smoothPath(pts, closed){
  if(pts.length<3) return '';
  const n=pts.length;
  const at=i=>closed ? pts[(i+n)%n] : pts[Math.max(0,Math.min(n-1,i))];
  let d=`M${pts[0][0]} ${pts[0][1]}`;
  const segs=closed?n:n-1;
  for(let i=0;i<segs;i++){
    const p0=at(i-1),p1=at(i),p2=at(i+1),p3=at(i+2);
    const c1x=p1[0]+(p2[0]-p0[0])/6, c1y=p1[1]+(p2[1]-p0[1])/6;
    const c2x=p2[0]-(p3[0]-p1[0])/6, c2y=p2[1]-(p3[1]-p1[1])/6;
    d+=` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d+(closed?'Z':'');
}
const mirrorPts = pts => pts.map(([x,y])=>[200-x,y]);
// félkörvonalból zárt, szimmetrikus alak (a két végpont a középvonalon van)
const outline = half => smoothPath(half.concat(mirrorPts(half).reverse().slice(1,-1)), true);

// jobb oldali félkörvonal: nyaktól a lábfejig, majd a láb belső oldalán vissza
const SILHOUETTE = [
  [100,58],[108,60],[110,70],
  [122,74],[138,79],[148,86],
  [155,96],[157,108],
  [158,124],[157,142],[155,158],[154,168],
  [153,182],[150,198],[148,212],[147,222],
  [147,232],[145,243],[141,247],[136,246],[134,238],
  [134,226],[136,210],[137,194],[137,178],[136,168],
  [134,152],[132,134],[130,118],[128,112],
  [127,124],[128,140],[126,154],[124,168],
  [126,180],[132,192],[134,204],
  [134,220],[133,240],[130,262],[127,282],[124,298],[123,306],
  [125,318],[126,332],[124,348],[120,366],[118,378],
  [121,388],[130,396],[133,401],[126,404],[112,403],
  [107,396],[106,384],[107,368],[109,350],[110,332],[109,314],[108,306],
  [106,288],[104,264],[102,238],[100,216]
];

/* Izomcsoportok a referencia-anyag felbontásában: a váll három részre bomlik
   (elülső/középső/hátsó — lásd a delta-ábrát), a kar bicepszre/tricepszre/
   alkarra, a láb combra/combhajlítóra/farizomra/vádlira. */
const MUSCLES = {
  trap:      {nev:'Trapéz',        ora:48},
  front_delt:{nev:'Elülső váll',   ora:48},
  side_delt: {nev:'Középső váll',  ora:48},
  rear_delt: {nev:'Hátsó váll',    ora:48},
  chest:     {nev:'Mell',          ora:72},
  lat:       {nev:'Hát (lat)',     ora:72},
  lower_back:{nev:'Deréktájék',    ora:72},
  biceps:    {nev:'Bicepsz',       ora:48},
  triceps:   {nev:'Tricepsz',      ora:48},
  forearm:   {nev:'Alkar',         ora:24},
  abs:       {nev:'Hasfal',        ora:24},
  oblique:   {nev:'Ferde hasizom', ora:24},
  glute:     {nev:'Farizom',       ora:72},
  quad:      {nev:'Comb (elülső)', ora:72},
  hamstring: {nev:'Comb (hátsó)',  ora:72},
  calf:      {nev:'Vádli',         ora:24}
};
const MUSCLE_KEYS = Object.keys(MUSCLES);

// hasfal: sorokba rendezett kis alakzatok (a referenciakép rácsa)
function absRows(){
  const out=[];
  [[121,135],[138,152],[155,169]].forEach(([y1,y2])=>{
    out.push({m:'abs',pts:[[101,y1],[112,y1+1],[114,(y1+y2)/2],[112,y2],[101,y2-1]]});
  });
  return out;
}

const BODY = {
  front:[
    {m:'trap',      pts:[[104,68],[117,75],[130,83],[124,90],[110,83],[102,74]]},
    {m:'front_delt',pts:[[131,84],[140,87],[144,99],[139,107],[132,98],[129,88]]},
    {m:'side_delt', pts:[[142,88],[149,92],[152,100],[152,108],[146,112],[142,103],[140,93]]},
    {m:'chest',     pts:[[101,82],[117,84],[127,93],[127,107],[117,113],[103,111],[100,97]]},
    {m:'biceps',    pts:[[139,112],[149,118],[153,132],[152,150],[146,157],[140,144],[137,126]]},
    {m:'forearm',   pts:[[139,178],[147,184],[148,198],[145,212],[141,214],[138,200],[137,186]]},
    {m:'oblique',   pts:[[121,118],[127,124],[127,138],[123,148],[118,142],[118,126]]},
    ...absRows(),
    {m:'abs',       pts:[[102,174],[114,178],[117,192],[111,201],[103,197],[100,184]]},
    {m:'quad',      pts:[[103,206],[112,212],[114,228],[109,241],[104,232],[101,215]]},
    {m:'quad',      pts:[[124,220],[132,232],[131,258],[127,280],[121,292],[118,272],[119,244],[121,228]]},
    {m:'quad',      pts:[[106,226],[116,232],[118,254],[115,276],[109,288],[105,264],[103,240]]},
    {m:'calf',      pts:[[112,312],[121,320],[122,342],[118,360],[113,356],[110,334]]}
  ],
  back:[
    {m:'trap',      pts:[[101,64],[107,68],[108,96],[101,100]]},
    {m:'trap',      pts:[[105,70],[118,77],[130,85],[123,92],[109,85],[103,77]]},
    {m:'trap',      pts:[[101,92],[114,96],[121,107],[113,115],[101,110]]},
    {m:'rear_delt', pts:[[132,84],[141,88],[145,100],[140,108],[133,99],[130,89]]},
    {m:'side_delt', pts:[[143,89],[149,93],[152,101],[151,109],[145,112],[142,103],[141,94]]},
    {m:'lat',       pts:[[102,114],[118,120],[128,134],[126,152],[115,161],[103,154]]},
    {m:'triceps',   pts:[[139,112],[149,118],[153,134],[151,152],[145,158],[139,142]]},
    {m:'forearm',   pts:[[139,178],[147,184],[148,198],[145,212],[141,214],[138,200],[137,186]]},
    {m:'lower_back',pts:[[82,170],[100,164],[118,170],[100,177]],solo:true},
    {m:'glute',     pts:[[102,186],[119,190],[131,202],[129,218],[115,224],[103,215]]},
    {m:'hamstring', pts:[[105,230],[122,236],[128,254],[124,280],[114,291],[107,272],[103,248]]},
    {m:'calf',      pts:[[112,306],[121,313],[123,332],[119,352],[113,348],[111,326]]}
  ]
};

/* SVG-ábra előállítása. `cls` a kiemelés-logikának kell (anatomy-muscle /
   muscle-part / muscle-part-recov), így a meglévő színező kód változatlan. */
function bodySvg(view, cls, style){
  const parts=BODY[view]||BODY.front;
  let mus='';
  parts.forEach((p,i)=>{
    const add=`class="mus ${cls}" data-muscle="${p.m}" data-i="${i}"`;
    mus+=`<path ${add} d="${smoothPath(p.pts,true)}"/>`;
    if(!p.solo) mus+=`<path ${add} d="${smoothPath(mirrorPts(p.pts),true)}"/>`;
  });
  return `<svg class="bodyfig" viewBox="${BODY_VB}"${style?` style="${style}"`:''}>
    <ellipse class="silh" cx="100" cy="38" rx="19" ry="23"/>
    <path class="silh" d="${outline(SILHOUETTE)}"/>
    ${mus}</svg>`;
}

/* ---------------------------------------------------------------- ADATOK */
/* ============================================================================
   GYAKORLAT-ADATBÁZIS
   A tier-rangok (S > A > B > C > D) a felhasználó referencia-anyagából jönnek;
   a sorozat/ismétlés/pihenő a szöveges diákból: összetett mozgás 3×5-8 vagy
   8-12, váll-izoláció 3×15-20, has/vádli/alkar 3×15-20, egyéb izoláció 3×10-15.
   eq = eszköz: rud | sulyzo | gep | kabel | sajat | gumi
   TIER_X = a referencián a "🤓" sávba került, a generátor nem választja.
   ========================================================================== */
const TIER_RANK = {S:0, A:1, B:2, C:3, D:4, X:9};

// r: [ismétlés min,max] · p: pihenő mp · pri/sec: izomcsoportok
function E(id,nev,eq,tier,pri,sec,r,p,tipp){
  return {id,nev,eq,tier,pri,sec:sec||[],r,p,tipp:tipp||''};
}
const NAGY=[6,10],   RN=150;   // nagy összetett
const KOZ=[8,12],    RK=120;   // közepes összetett
const IZO=[10,15],   RI=75;    // izoláció
const MAGAS=[15,20], RM=60;    // váll-izoláció, has, vádli, alkar

const EXERCISES = [
  /* ---------------- MELL ---------------- */
  E('mell-fekvenyomas-rud','Fekvenyomás rúddal','rud','S',['chest'],['front_delt','triceps'],NAGY,RN,'Lapockát húzd össze és rögzítsd, a rúd a mellbimbó vonalára ér.'),
  E('mell-ferde-sulyzo','Ferde súlyzós nyomás','sulyzo','S',['chest'],['front_delt','triceps'],KOZ,RK,'30-45 fokos dőlés; mélyre engedd a súlyzókat.'),
  E('mell-ferde-rud','Ferde fekvenyomás rúddal','rud','S',['chest'],['front_delt','triceps'],NAGY,RN,'Ne állítsd meredekebbre 45 foknál, mert a váll veszi át.'),
  E('mell-tolodzkodas','Tolódzkodás (mellre)','sajat','S',['chest'],['triceps','front_delt'],KOZ,RK,'Enyhén dőlj előre, a könyök szélesebbre nyílhat.'),
  E('mell-labemelt-fekvotamasz','Lábemelt fekvőtámasz','sajat','A',['chest'],['triceps','abs'],KOZ,RK,'Feszes törzs; a láb magasabbra tétele a felső mellet célozza.'),
  E('mell-gyurus-fekvotamasz','Gyűrűs fekvőtámasz','sajat','A',['chest'],['triceps','front_delt'],KOZ,RK,'A gyűrű instabil — lassan, kontrollal.'),
  E('mell-kabel-keresztezes','Kábeles keresztezés','kabel','A',['chest'],[],IZO,RI,'A csúcsponton szorítsd össze a mellizmot.'),
  E('mell-fekvo-sulyzo','Fekvenyomás kézisúlyzóval','sulyzo','A',['chest'],['front_delt','triceps'],KOZ,RK,'Nagyobb mozgástartomány, de ne told túl a vállízületet.'),
  E('mell-gepes-nyomas','Gépes mellnyomás','gep','C',['chest'],['triceps'],IZO,RI,'A fogantyú mellmagasságban legyen.'),
  E('mell-tarogatas','Tárogatás kézisúlyzóval','sulyzo','C',['chest'],[],IZO,RI,'Enyhén hajlított könyök, a mozgás a vállízületből induljon.'),
  E('mell-pec-deck','Pec deck (gépes tárogatás)','gep','C',['chest'],[],IZO,RI,'Lassan hozd össze a karokat, érezd az összehúzódást.'),
  E('mell-gumi-nyomas','Gumiszalagos mellnyomás','gumi','C',['chest'],['triceps','front_delt'],IZO,RI,'A szalagot a hátad mögött rögzítsd stabil ponthoz.'),

  /* ---------------- HÁT (lat + trapéz) ---------------- */
  E('hat-huzodzkodas','Húzódzkodás','sajat','S',['lat'],['biceps','forearm'],KOZ,RK,'A lapockák lehúzásával indítsd, ne csak a karból húzz.'),
  E('hat-evezes-also-fogas','Evezés rúddal (alsó fogás)','rud','S',['lat'],['biceps','trap','lower_back'],NAGY,RN,'Alsó fogás; a rudat a hasadhoz húzd, könyököt hátra.'),
  E('hat-evezes-rud','Evezés rúddal','rud','S',['lat','trap'],['biceps','lower_back'],NAGY,RN,'Tartsd közel vízszinteshez a törzset.'),
  E('hat-mellel-tamasztott-evezes','Mellel támasztott evezés','sulyzo','S',['lat','trap'],['biceps'],KOZ,RK,'A ferde pad kiveszi a derekat — csak a hát dolgozik.'),
  E('hat-egykezes-evezes-padon','Egykezes evezés padon','sulyzo','S',['lat'],['biceps','trap'],KOZ,RK,'Padra támaszkodva, a súlyzót a csípőd felé húzd.'),
  E('hat-lat-lehuzas','Felső csigás lehúzás','gep','A',['lat'],['biceps','forearm'],KOZ,RK,'A felső mell elé húzd, ne a tarkó mögé.'),
  E('hat-ulo-kabel-evezes','Ülő kábeles evezés','kabel','A',['lat','trap'],['biceps'],KOZ,RK,'Egyenes háttal húzz, a lapockát vidd hátra és le.'),
  E('hat-trapbar-felhuzas','Fogantyús (trap bar) felhúzás','rud','A',['lat','trap'],['glute','hamstring','forearm'],NAGY,RN,'Semleges fogás, egyenes hát; a lábbal indíts.'),
  E('hat-egykezes-kabel-evezes','Egykezes kábeles evezés','kabel','B',['lat'],['biceps'],IZO,RI,'A törzs maradjon stabil, ne csavarodj bele.'),
  E('hat-gepes-lehuzas','Gépes lehúzás','gep','B',['lat'],['biceps'],KOZ,RK,'Rögzített pálya — jó a technika tanulásához.'),
  E('hat-forditott-evezes','Fordított evezés','sajat','C',['lat','trap'],['biceps'],KOZ,RK,'Feszes farizom és has, a test deszkaszerűen egyenes.'),
  E('hat-kabel-pullover','Kábeles pullover','kabel','D',['lat'],[],IZO,RI,'Enyhén hajlított kar, a hátból húzz, ne a karból.'),
  E('trap-rudvonas','Vállvonás (shrug) rúddal','rud','B',['trap'],['forearm'],IZO,RI,'Csak fel-le; ne körözz a vállal.'),
  E('trap-sulyzo-vonas','Vállvonás kézisúlyzóval','sulyzo','B',['trap'],['forearm'],IZO,RI,'Fent tarts egy pillanatot.'),

  /* ---------------- VÁLL ---------------- */
  E('vall-rudas-nyomas','Fej fölötti nyomás rúddal','rud','S',['front_delt'],['side_delt','triceps','abs'],NAGY,RN,'Feszes farizom és has, hogy a derék ne hajoljon hátra.'),
  E('vall-kabel-oldalemeles','Kábeles oldalemelés','kabel','S',['side_delt'],[],MAGAS,RM,'A kábel a teljes tartományban terhel — könnyű súly, magas ismétlés.'),
  E('vall-egykezes-kabel-oldalemeles','Egykezes kábeles oldalemelés','kabel','S',['side_delt'],[],MAGAS,RM,'A test mögül indítsd, így nagyobb a mozgástartomány.'),
  E('vall-kezallasos-fekvotamasz','Kézállásos fekvőtámasz','sajat','S',['front_delt'],['side_delt','triceps'],KOZ,RK,'Fal mellett kezdd; feszes törzzsel dolgozz.'),
  E('vall-face-pull','Face pull kábellel','kabel','S',['rear_delt'],['trap'],MAGAS,RM,'Az arcod felé húzz magasan tartott könyökkel.'),
  E('vall-sulyzos-nyomas','Vállnyomás kézisúlyzóval','sulyzo','A',['front_delt'],['side_delt','triceps'],KOZ,RK,'Ne üsd össze fent a súlyzókat.'),
  E('vall-sulyzos-oldalemeles','Oldalemelés kézisúlyzóval','sulyzo','A',['side_delt'],[],MAGAS,RM,'Vállmagasságig, enyhén hajlított könyökkel, lendítés nélkül.'),
  E('vall-hatso-tarogatas-padon','Hátsó váll tárogatás padon','sulyzo','A',['rear_delt'],['trap'],MAGAS,RM,'Ferde padra fekve, enyhén hajlított karral emelj oldalra.'),
  E('vall-kabel-hatso-vall','Kábeles hátsó váll tárogatás','kabel','A',['rear_delt'],['trap'],MAGAS,RM,'Kereszt-fogással, a végponton szorítsd össze a lapockát.'),
  E('vall-landmine-nyomas','Rudas (landmine) nyomás','rud','A',['front_delt'],['triceps','chest'],KOZ,RK,'Ferde pálya — kíméletesebb a vállnak.'),
  E('vall-gepes-nyomas','Gépes vállnyomás','gep','A',['front_delt'],['triceps'],KOZ,RK,'Az ülést állítsd úgy, hogy a fogantyú vállmagasságban legyen.'),
  E('vall-elorediolt-hatso-vall','Előredőlt hátsó váll tárogatás','sulyzo','B',['rear_delt'],['trap'],MAGAS,RM,'Előredőlve, a lapockákat szorítsd össze.'),
  E('vall-rudas-elulso-emeles','Elülső emelés rúddal','rud','B',['front_delt'],[],IZO,RI,'Az elülső vállat a nyomások már lefedik — ez csak ráadás.'),
  E('vall-egykezes-oldalemeles','Egykezes oldalemelés','sulyzo','C',['side_delt'],[],MAGAS,RM,'Kapaszkodj meg, hogy ne lendíts a törzzsel.'),
  E('vall-pike-fekvotamasz','Pike fekvőtámasz','sajat','D',['front_delt'],['triceps'],KOZ,RK,'Csípőt magasra, a fejtetőt a talaj felé engedd.'),
  E('vall-gumi-oldalemeles','Gumiszalagos oldalemelés','gumi','C',['side_delt'],[],MAGAS,RM,'Lassan, rángatás nélkül vállmagasságig.'),

  /* ---------------- BICEPSZ ---------------- */
  E('bi-rudas-hajlitas','Bicepsz hajlítás rúddal','rud','S',['biceps'],['forearm'],IZO,RI,'Rögzítsd a könyököd a törzs mellett, ne lendíts a derékkal.'),
  E('bi-ez-rud-hajlitas','EZ-rudas hajlítás','rud','S',['biceps'],['forearm'],IZO,RI,'Csuklóbarát fogás — ugyanaz a munka, kevesebb csuklófájás.'),
  E('bi-kabeles-hajlitas','Kábeles bicepsz hajlítás','kabel','S',['biceps'],[],IZO,RI,'A kábel alul is terhel, ahol a súlyzó már nem.'),
  E('bi-predikaloszek','Prédikálószék hajlítás','rud','S',['biceps'],[],IZO,RI,'A felkar teljesen feküdjön a párnán, ne emeld el.'),
  E('bi-gepes-predikalo','Gépes prédikálószék','gep','S',['biceps'],[],IZO,RI,'Rögzített pálya, könnyű a technikát eltalálni.'),
  E('bi-dontott-rudas-hajlitas','Döntött rudas hajlítás','rud','S',['biceps'],[],IZO,RI,'Hátradöntött padon a bicepsz megnyújtott helyzetből dolgozik.'),
  E('bi-allo-sulyzos','Bicepsz hajlítás kézisúlyzóval','sulyzo','A',['biceps'],['forearm'],IZO,RI,'A végén fordítsd kifelé a tenyered.'),
  E('bi-ferde-ulo-sulyzos','Ferde padon ülő súlyzós hajlítás','sulyzo','A',['biceps'],[],IZO,RI,'A kar a törzs mögé kerül — megnyújtott bicepsz.'),
  E('bi-szeles-fogasu','Széles fogású rudas hajlítás','rud','A',['biceps'],['forearm'],IZO,RI,'Szélesebb fogás a rövid fejet célozza.'),
  E('bi-koncentracios','Koncentrációs hajlítás','sulyzo','A',['biceps'],[],IZO,RI,'Támaszd a könyököd a comb belső oldalára.'),
  E('bi-egykezes-kabeles','Egykezes kábeles hajlítás','kabel','A',['biceps'],[],IZO,RI,'Egyenletes terhelés, jól izolál.'),
  E('bi-kalapacshajlitas','Kalapácshajlítás','sulyzo','B',['biceps'],['forearm'],IZO,RI,'Semleges fogás — a karizmot és az alkart is terheli.'),
  E('bi-huzodzkodas-also','Alsó fogású húzódzkodás','sajat','A',['biceps'],['lat','forearm'],KOZ,RK,'Alsó fogás, az állad a rúd fölé.'),
  E('bi-lenditeses','Lendítéses rudas hajlítás','rud','D',['biceps'],['lower_back'],IZO,RI,'Csak a legvégén, ha már nem megy tisztán.'),

  /* ---------------- TRICEPSZ ---------------- */
  E('tri-kabel-lenyomas-doles','Kábeles lenyomás előredőlve','kabel','S',['triceps'],[],IZO,RI,'Az előredőlés megnyújtja a hosszú fejet — ez a lényeg.'),
  E('tri-kabel-kickback','Kábeles kickback','kabel','S',['triceps'],[],IZO,RI,'Rögzített felkar, csak a könyök nyílik.'),
  E('tri-kabel-fej-mogotti','Fej mögötti kábelnyújtás','kabel','S',['triceps'],[],IZO,RI,'A kar a fej mögé kerül: a hosszú fej megnyújtva dolgozik.'),
  E('tri-kabel-egykezes-fej-mogotti','Egykezes fej mögötti kábelnyújtás','kabel','S',['triceps'],[],IZO,RI,'Egy oldalt terhelve könnyebb a teljes tartományt bejárni.'),
  E('tri-sulyzo-fej-mogotti','Fej mögötti súlyzónyújtás ferde padon','sulyzo','A',['triceps'],[],IZO,RI,'A felkar függőlegesen a fül mellett marad.'),
  E('tri-francia-nyomas','Francia nyomás (skull crusher)','rud','A',['triceps'],[],IZO,RI,'A rudat a homlok fölé engedd, a felkar ne mozduljon.'),
  E('tri-fekvo-sulyzo-nyujtas','Fekvő súlyzós tricepsznyújtás','sulyzo','A',['triceps'],[],IZO,RI,'Enyhén hátra döntött felkar a nagyobb nyújtásért.'),
  E('tri-szuk-fekvenyomas','Szűk fogású fekvenyomás','rud','B',['triceps'],['chest','front_delt'],KOZ,RK,'Vállszélességű fogás, könyök közel a testhez.'),
  E('tri-gyemant-fekvotamasz','Gyémánt fekvőtámasz','sajat','B',['triceps'],['chest'],KOZ,RK,'A tenyerek gyémánt alakban a mellkas alatt.'),
  E('tri-egykezes-sulyzo','Egykezes fej mögötti súlyzónyújtás','sulyzo','B',['triceps'],[],IZO,RI,'A felkar a fül mellett, csak a könyök nyílik.'),
  E('tri-pad-tolodzkodas','Padon tolódzkodás','sajat','B',['triceps'],['front_delt','chest'],KOZ,RK,'A test közel a padhoz, a könyök hátra hajlik.'),
  E('tri-kabel-lenyomas','Kábeles lenyomás','kabel','C',['triceps'],[],IZO,RI,'Könyök a törzs mellett, csak lefelé nyújts.'),
  E('tri-sulyzo-kickback','Súlyzós kickback','sulyzo','D',['triceps'],[],IZO,RI,'A csúcson a legkisebb a terhelés — ezért gyengébb választás.'),
  E('tri-gumi-lenyomas','Gumiszalagos lenyomás','gumi','C',['triceps'],[],IZO,RI,'Nyújtsd teljesen a kart a szalag ellenében.'),

  /* ---------------- ALKAR / SZORÍTÓERŐ ---------------- */
  E('fore-csuklohajlitas','Csuklóhajlítás rúddal','rud','S',['forearm'],[],MAGAS,RM,'Az alkart támaszd a combra vagy padra, csak a csukló mozog.'),
  E('fore-csukloroller','Csuklóroller','gep','S',['forearm'],[],MAGAS,RM,'Fel és le is tekerd — mindkét irány számít.'),
  E('fore-forditott-hajlitas','Fordított fogású hajlítás','rud','S',['forearm'],['biceps'],IZO,RI,'Felülről fogd a rudat; ez az alkar felső részét építi.'),
  E('fore-szoritoeszkoz','Kézi szorítóeszköz','gep','A',['forearm'],[],MAGAS,RM,'Teljes zárás, lassú nyitás.'),
  E('fore-fuggeszkedes','Függeszkedés (dead hang)','sajat','A',['forearm'],['lat'],[30,60],RM,'Időre mérd: 30-60 másodperc.'),
  E('fore-forditott-csuklohajlitas','Fordított csuklóhajlítás','sulyzo','B',['forearm'],[],MAGAS,RM,'Felfelé néző kézháttal emelj.'),
  E('fore-farmerjaras','Farmerjárás','sulyzo','B',['forearm'],['trap','abs'],[30,60],RM,'Vállat le és hátra, feszes has, kis lépések.'),
  E('fore-statikus-rudtartas','Statikus rúdtartás','rud','C',['forearm'],[],[20,40],RM,'Nehéz rúd, csak tartás — időre.'),

  /* ---------------- HASFAL / FERDE HASIZOM ---------------- */
  E('abs-dontott-felules','Döntött padon felülés súllyal','gep','S',['abs'],['oblique'],MAGAS,RM,'A súlyt a mellkason tartsd, göngyölítve emelkedj.'),
  E('abs-gepes-crunch','Gépes crunch','gep','S',['abs'],[],MAGAS,RM,'A hasból göngyölíts, ne a karral húzz.'),
  E('abs-kabel-crunch','Kábeles crunch (térdelve)','kabel','S',['abs'],[],MAGAS,RM,'Fix csípő, a felsőtestet göngyölítsd le.'),
  E('abs-fuggo-labemeles','Függeszkedő lábemelés','sajat','S',['abs'],['oblique','forearm'],MAGAS,RM,'Lendület nélkül, a medencét döntsd hátra.'),
  E('obl-kabel-rotacio','Kábeles rotáció','kabel','S',['oblique'],['abs'],MAGAS,RM,'A csípőből fordulj, a kar csak követ.'),
  E('abs-sulyozott-felules','Súlyozott felülés','sajat','A',['abs'],['oblique'],MAGAS,RM,'A nyakad ne rántsd, a hasizom emeljen.'),
  E('abs-hasgorgo','Hasgörgő (ab wheel)','sajat','A',['abs'],['lower_back'],IZO,RI,'Feszes has és farizom, ne horpadjon be a derék.'),
  E('abs-dontott-labemeles','Döntött lábemelés','sajat','A',['abs'],[],MAGAS,RM,'Kontrolláltan engedd vissza, ne csapd le a lábat.'),
  E('abs-gepes-labemeles','Gépes lábemelés','gep','A',['abs'],[],MAGAS,RM,'A háttámlához szorítva a derék védve van.'),
  E('obl-orosz-csavaras','Orosz csavarás labdával','sajat','A',['oblique'],['abs'],MAGAS,RM,'Egyenes háttal, kontrolláltan forgasd a törzset.'),
  E('abs-plank','Deszka (plank)','sajat','C',['abs'],['lower_back'],[30,60],RM,'Egyenes vonal fej-csípő-sarok, feszítsd a fart és hasat.'),
  E('obl-oldalplank','Oldalplank','sajat','D',['oblique'],['abs'],[30,60],RM,'Csípőt magasan, a test egy vonalban.'),
  E('obl-oldalra-doles','Oldalra dőlés súlyzóval','sulyzo','D',['oblique'],[],MAGAS,RM,'Csak oldalra, ne csavarodj.'),

  /* ---------------- COMB (elülső) ---------------- */
  E('quad-labtolas','Lábtolás gépen (45°)','gep','S',['quad'],['glute','hamstring'],KOZ,RK,'Ne nyújtsd ütközésig a térdet, a térd a lábfej vonalában.'),
  E('quad-labnyujtas','Lábnyújtás gépen','gep','S',['quad'],[],IZO,RI,'A csúcson feszítsd meg egy pillanatra.'),
  E('quad-goblet-guggolas','Goblet guggolás','sulyzo','S',['quad'],['glute'],KOZ,RK,'A súlyt a mellkas előtt tartsd, üljön mélyre a csípő.'),
  E('quad-hatso-guggolas','Guggolás rúddal (hátsó)','rud','A',['quad'],['glute','lower_back','hamstring'],NAGY,RN,'Törd meg egyszerre a csípőt és a térdet, ülj mélyre.'),
  E('quad-elso-guggolas','Első guggolás rúddal','rud','A',['quad'],['glute','abs'],NAGY,RN,'Magas könyök, kitolt mellkas, egyenes törzs.'),
  E('quad-hack-squat','Hack squat','gep','A',['quad'],['glute'],KOZ,RK,'Rögzített pálya, mélyre lehet menni biztonságosan.'),
  E('quad-bolgar-kitores','Bolgár kitörés','sulyzo','A',['quad'],['glute','hamstring'],KOZ,RK,'Hátsó láb a padon, függőlegesen ereszkedj.'),
  E('quad-smith-guggolas','Smith-gépes guggolás','gep','A',['quad'],['glute'],KOZ,RK,'A láb előrébb tehető, így a comb jobban dolgozik.'),
  E('quad-sulyzos-guggolas','Súlyzós guggolás','sulyzo','B',['quad'],['glute'],KOZ,RK,'Két súlyzó a test mellett, egyenes hát.'),
  E('quad-kitores','Kitörés','sulyzo','B',['quad'],['glute','hamstring'],KOZ,RK,'Nagy lépés, a hátsó térd a talaj felé.'),
  E('quad-testsuly-guggolas','Testsúlyos guggolás','sajat','C',['quad'],['glute'],MAGAS,RM,'Térd a lábujj irányába, sarok a talajon.'),
  E('quad-pisztolyguggolas','Pisztolyguggolás','sajat','D',['quad'],['glute'],IZO,RI,'Egy lábon — előbb kapaszkodva gyakorold.'),

  /* ---------------- COMB (hátsó) + FARIZOM ---------------- */
  E('ham-roman-felhuzas','Román felhúzás rúddal (RDL)','rud','S',['hamstring'],['glute','lower_back'],NAGY,RN,'Told hátra a csípőt egyenes háttal, a rúd a lábhoz közel.'),
  E('ham-ulo-labhajlitas','Ülő lábhajlítás gépen','gep','S',['hamstring'],[],IZO,RI,'Ülve a combhajlító megnyújtva dolgozik — ezért erős választás.'),
  E('ham-fekvo-labhajlitas','Fekvő lábhajlítás gépen','gep','S',['hamstring'],[],IZO,RI,'Lendület nélkül, a végponton szorítsd össze.'),
  E('glute-csipoemeles','Csípőemelés rúddal (hip thrust)','rud','S',['glute'],['hamstring'],KOZ,RK,'Fent teljesen feszítsd a farizmot, a borda ne szaladjon fel.'),
  E('ham-nyujtott-labu-felhuzas','Nyújtott lábú felhúzás','rud','A',['hamstring'],['glute','lower_back'],NAGY,RN,'Közel egyenes láb, csípőből dőlj előre.'),
  E('ham-egylabas-rdl','Egylábas román felhúzás','sulyzo','A',['hamstring'],['glute'],IZO,RI,'Egyensúly is fejlődik; a csípő ne billenjen oldalra.'),
  E('ham-nordic','Nordic lábhajlítás','sajat','A',['hamstring'],[],IZO,RI,'Rögzített boka, a lehető leglassabban engedd le a törzset.'),
  E('ham-glute-ham-raise','Glute-ham raise','gep','A',['hamstring'],['glute','lower_back'],IZO,RI,'A combhajlító fékez — kis tartományból kezdd.'),
  E('ham-jo-reggelt','Jó reggelt gyakorlat','rud','B',['hamstring'],['lower_back','glute'],IZO,RI,'Enyhén hajlított térd, csípőből dőlj, egyenes hát.'),
  E('glute-kabel-rugas','Kábeles farizom-rúgás','kabel','B',['glute'],[],IZO,RI,'Egyenes háttal rúgd hátra, a végponton szorítsd.'),
  E('glute-hid','Farizom híd','sajat','C',['glute'],['hamstring'],MAGAS,RM,'Nyomj a sarkadon keresztül, fent szorítsd össze.'),
  E('glute-fellepes','Egylábas fellépés','sulyzo','D',['glute'],['quad','hamstring'],IZO,RI,'Lassan, ne lökd fel magad a hátsó lábbal.'),
  E('glute-gumi-oldalseta','Gumiszalagos oldalséta','gumi','C',['glute'],[],MAGAS,RM,'Szalag a térd felett, félguggolásban lépkedj.'),

  /* ---------------- DERÉKTÁJÉK ---------------- */
  E('lb-hathajlitas','Hiperextenzió (háthajlítás)','gep','C',['lower_back'],['glute','hamstring'],IZO,RI,'Csak egyenes vonalig emelkedj, ne told túl hátra.'),
  E('lb-superman','Superman','sajat','C',['lower_back'],['glute'],MAGAS,RM,'Egyszerre emeld a kart és a lábat, tartsd meg.'),
  E('lb-madar-kutya','Madár-kutya','sajat','B',['lower_back'],['abs','glute'],MAGAS,RM,'Ellentétes kar és láb; a csípő ne billenjen.'),

  /* ---------------- VÁDLI ---------------- */
  E('vadli-allo-emeles','Álló vádliemelés','gep','S',['calf'],[],MAGAS,RM,'A lehető legmagasabbra, majd lassan mélyre engedd a sarkat.'),
  E('vadli-ulo-emeles','Ülő vádliemelés gépen','gep','S',['calf'],[],MAGAS,RM,'Hajlított térd — a lapos vádliizmot célozza.'),
  E('vadli-egylabas','Egylábas vádliemelés','sulyzo','A',['calf'],[],MAGAS,RM,'Lépcső szélén, nagy mozgástartománnyal.'),
  E('vadli-testsuly','Testsúlyos vádliemelés','sajat','B',['calf'],[],MAGAS,RM,'Lépcső szélén a sarkat mélyre engedd.')
];

/* ---- gyakorlat-segédek ---- */
const EX_BY_ID = {};
EXERCISES.forEach(e=>EX_BY_ID[e.id]=e);
function exById(id){ return EX_BY_ID[id]; }
// egy izomcsoportra elérhető gyakorlatok, tier szerint rendezve
function exercisesFor(group, eqSet){
  return EXERCISES
    .filter(e=>e.pri.includes(group) && (!eqSet || eqSet.has(e.eq)) && e.tier!=='X')
    .sort((a,b)=>TIER_RANK[a.tier]-TIER_RANK[b.tier]);
}

/* ============================================================================
   MAI TERV — előre beállított fókuszok
   A felhasználó a Mai edzés kártyán átírhatja, mi legyen ma.
   ========================================================================== */
const FOCUS_PRESETS = [
  {id:'teljes',    nev:'Teljes test',    groups:['chest','lat','front_delt','side_delt','quad','hamstring','abs']},
  {id:'felsotest', nev:'Felsőtest',      groups:['chest','lat','front_delt','side_delt','rear_delt','biceps','triceps']},
  {id:'alsotest',  nev:'Alsótest',       groups:['quad','hamstring','glute','calf']},
  {id:'tolo',      nev:'Toló nap',       groups:['chest','front_delt','side_delt','triceps']},
  {id:'huzo',      nev:'Húzó nap',       groups:['lat','trap','rear_delt','biceps']},
  {id:'lab',       nev:'Láb nap',        groups:['quad','hamstring','glute','calf']},
  {id:'mell',      nev:'Mell',           groups:['chest']},
  {id:'hat',       nev:'Hát',            groups:['lat','trap']},
  {id:'vall',      nev:'Váll',           groups:['front_delt','side_delt','rear_delt']},
  {id:'bicepsz',   nev:'Bicepsz',        groups:['biceps']},
  {id:'tricepsz',  nev:'Tricepsz',       groups:['triceps']},
  {id:'kar',       nev:'Kar (bi + tri)', groups:['biceps','triceps','forearm']},
  {id:'has',       nev:'Has',            groups:['abs','oblique']},
  {id:'comb',      nev:'Comb (elülső)',  groups:['quad']},
  {id:'combhajl',  nev:'Comb (hátsó)',   groups:['hamstring']},
  {id:'far',       nev:'Farizom',        groups:['glute']},
  {id:'vadli',     nev:'Vádli',          groups:['calf']},
  {id:'alkar',     nev:'Alkar / fogás',  groups:['forearm']},
  {id:'derek',     nev:'Deréktájék',     groups:['lower_back']},
  {id:'piheno',    nev:'Pihenőnap',      groups:[]}
];
const focusById = id => FOCUS_PRESETS.find(f=>f.id===id);

/* ============================================================================
   HETI BEOSZTÁS
   Hétfőtől vasárnapig, izomcsoportonként. A felhasználó sajátja — a Kezdőlapon
   az „Ezen a héten" kártyán bármelyik nap átírható, és úgy is marad.
   ========================================================================== */
const DEFAULT_WEEK = [
  ['biceps','triceps','forearm'],                       // hétfő
  ['front_delt','side_delt','rear_delt'],               // kedd
  ['chest','lat','trap'],                               // szerda
  ['abs','oblique','forearm','biceps','triceps'],       // csütörtök
  ['quad','hamstring','glute','calf'],                  // péntek
  [],                                                   // szombat — pihenő
  []                                                    // vasárnap — pihenő
];
const DAY_NAMES=['Hétfő','Kedd','Szerda','Csütörtök','Péntek','Szombat','Vasárnap'];
const DAY_SHORT=['Hét','Ked','Sze','Csü','Pén','Szo','Vas'];

/* A nap neve a benne lévő izomcsoportokból: a finom csoportokat nagyobb
   testtájakká vonjuk össze, így „Mell + Hát", „Has + Kar" lesz belőle. */
const COARSE_OF = {
  chest:'Mell', lat:'Hát', trap:'Hát',
  front_delt:'Váll', side_delt:'Váll', rear_delt:'Váll',
  biceps:'Kar', triceps:'Kar', forearm:'Kar',
  abs:'Has', oblique:'Has',
  quad:'Láb', hamstring:'Láb', glute:'Láb', calf:'Láb',
  lower_back:'Derék'
};
function labelForGroups(groups){
  if(!groups || !groups.length) return 'Pihenőnap';
  const out=[];
  groups.forEach(g=>{ const c=COARSE_OF[g]||muscleName(g); if(!out.includes(c)) out.push(c); });
  return out.join(' + ');
}
const weekPlan = () => (state.weekPlan && state.weekPlan.length===7) ? state.weekPlan : DEFAULT_WEEK;
const dayIndexToday = () => (new Date().getDay()+6)%7;      // hétfő = 0
const GOAL_INFO = {
  build:{nev:'Izomépítés',desc:'Edzőtermi · súlyokkal',icon:'dumbbell',eq:['rud','sulyzo','gep','kabel','sajat','gumi']},
  calisthenics:{nev:'Calisthenics',desc:'Saját súly · funkcionális',icon:'weight',eq:['sajat']},
  cardio:{nev:'Kardió',desc:'Állóképesség · magas ism.',icon:'running',eq:['sulyzo','gep','kabel','sajat','gumi']},
  rest:{nev:'Pihenőhét',desc:'Aktív regeneráció',icon:'bed',eq:['sajat']}
};
/* A gyakorlatok (még) durva izomkulcsokat használnak, a testábra viszont 16
   finom csoportot. Ez a híd köti össze a kettőt: egy gyakorlat izomkulcsa
   megadja, MELY finom csoportok világítanak és melyek regenerálódnak. */
const EX_TO_GROUPS = {
  chest:    ['chest'],
  back:     ['lat','trap'],
  legs:     ['quad','hamstring','glute','calf'],
  shoulders:['front_delt','side_delt','rear_delt'],
  triceps:  ['triceps'],
  biceps:   ['biceps'],
  arms:     ['biceps','triceps','forearm'],
  core:     ['abs','oblique']
};
const groupsOf = m => EX_TO_GROUPS[m] || (MUSCLES[m] ? [m] : ['abs']);
// megjelenítendő név: a finom csoportokra és a durva gyakorlat-kulcsokra is
const COARSE_NAMES = {chest:'Mell',back:'Hát',legs:'Lábak',shoulders:'Vállak',arms:'Karok',core:'Törzs',triceps:'Tricepsz',biceps:'Bicepsz'};
const muscleName = m => (MUSCLES[m] && MUSCLES[m].nev) || COARSE_NAMES[m] || m;
// visszafelé kompatibilitás a régebbi kódrészekhez
const muscleNamesHu = new Proxy({}, {get:(_,k)=>muscleName(k)});

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
  {level:1,name:'Újonc'},{level:3,name:'Kezdő'},{level:5,name:'Sportoló'},
  {level:8,name:'Versenyző'},{level:12,name:'Harcos'},{level:16,name:'Szörnyeteg'},
  {level:20,name:'Elit'},{level:25,name:'Legenda'},{level:30,name:'Halhatatlan'}
];

/* ---------------------------------------------------------------- SEGÉDEK */
function xpForLevel(lvl){ return 500 + (lvl-1)*250; }
function getTitle(level){ let t=titles[0]; for(const x of titles) if(level>=x.level) t=x; return t.name; }
function getDayOfWeek(){ return ['Vas','Hét','Ked','Sze','Csü','Pén','Szo'][new Date().getDay()]; }
const goalInfo = () => GOAL_INFO[state.goal] || GOAL_INFO.build;
const eqSet = () => new Set(goalInfo().eq);

/* A mai fókusz: ha a felhasználó átírta a Mai edzés kártyán, az ÜT; egyébként a
   cél heti alapbeosztásából jön a nap. A kézi választás csak MÁRA érvényes. */
function focusForDay(i){
  const groups=(weekPlan()[i]||[]).slice();
  return {id:'d'+i, nev:labelForGroups(groups), groups, napId:i};
}
function todayFocus(){
  const t=new Date().toDateString();
  if(state.todayFocus && state.todayFocus.date===t){
    const f=focusById(state.todayFocus.id);
    if(f) return f;
  }
  return focusForDay(dayIndexToday());
}
function setTodayFocus(id){
  state.todayFocus={date:new Date().toDateString(), id};
  saveState(); hideModal(); renderPlan();
  showToast(`Mai terv: ${focusById(id).nev}`);
}
function clearTodayFocus(){
  state.todayFocus=null; saveState(); hideModal(); renderPlan();
  showToast('Vissza a heti beosztásra');
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

/* Készültség: az izomcsoport SAJÁT regenerációs idejéhez mérve (nagy izom 72h,
   kis izom 24h) — nem fix 48 órához, mint korábban. */
function getRecoveryLevel(muscle){
  const last = state.muscleRecovery[muscle] || 0;
  if(!last) return {pct:100,label:'KÉSZ',color:'var(--success)'};
  const need = (MUSCLES[muscle] && MUSCLES[muscle].ora) || 48;
  const pct = Math.min(100, (Date.now()-last)/3600000/need*100);
  if(pct<50)  return {pct,label:'PIHEN',color:'var(--pink)'};
  if(pct<100) return {pct,label:'MAJDNEM',color:'var(--warning)'};
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
// A böngésző az első érintésig blokkolja a rezgést, és MINDEN hívásra hibát ír a
// konzolra — ezért csak valódi interakció után hívjuk meg.
let userInteracted=false;
['pointerdown','keydown'].forEach(ev=>document.addEventListener(ev,()=>{userInteracted=true;},{once:true}));
function vibrate(pattern){ if(userInteracted && navigator.vibrate) navigator.vibrate(pattern); }
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

/* ---------------------------------------------------------------- TERV
   A generátor a legjobb rangú (S -> A -> B ...) gyakorlatot választja minden
   célcsoportra, az elérhető eszközökből. Kevés csoportnál (pl. csak bicepsz)
   több gyakorlat jut egy csoportra, sok csoportnál egy-egy. */
function kezdoSuly(e){
  if(state.lastWeights[e.id]!==undefined) return state.lastWeights[e.id];
  if(state.lastWeights[e.nev]!==undefined) return state.lastWeights[e.nev]; // régi mentés névvel
  if(e.eq==='sajat') return 0;
  const nagy=e.pri.some(g=>['quad','hamstring','glute','chest','lat'].includes(g));
  if(e.eq==='rud')  return nagy?40:20;
  if(e.eq==='gep')  return nagy?40:20;
  if(e.eq==='kabel')return 15;
  if(e.eq==='gumi') return 0;
  return nagy?16:8;                                     // kézisúlyzó
}
function generateTodayWorkout(){
  const focus=todayFocus();
  if(!focus || focus.groups.length===0) return null;
  const eq=eqSet();
  /* Körkörös válogatás: ELŐSZÖR minden célcsoport kap egy gyakorlatot (a
     legjobb rangút), és csak utána jön a második kör. Így kevés csoportnál
     mélyebb, soknál szélesebb az edzés — de legfeljebb 6 gyakorlat, mert
     3 sorozat/gyakorlat mellett ennél több már túl hosszú alkalom. */
  const MAX_EX=6, MAX_PER_GROUP=4;
  const chosen=[], usedIds=new Set();
  const lists={}; focus.groups.forEach(g=>lists[g]=exercisesFor(g,eq));
  for(let round=0; round<MAX_PER_GROUP && chosen.length<MAX_EX; round++){
    for(const g of focus.groups){
      if(chosen.length>=MAX_EX) break;
      const e=(lists[g]||[]).find(x=>!usedIds.has(x.id));
      if(!e) continue;
      usedIds.add(e.id);
      // a kardió cél magasabb ismétlést és rövidebb pihenőt kér
      const r = state.goal==='cardio' ? [Math.round(e.r[0]*1.6),Math.round(e.r[1]*1.6)] : e.r;
      const p = state.goal==='cardio' ? Math.max(30,Math.round(e.p*0.6)) : e.p;
      chosen.push({id:e.id, name:e.nev, groups:e.pri.slice(), sec:e.sec.slice(), eq:e.eq,
        tier:e.tier, tipp:e.tipp, sets:3, reps:r[1], repMin:r[0], repMax:r[1],
        rest:p, weight:kezdoSuly(e), isCustom:false});
    }
  }
  state.customTodayExercises.forEach(c=>chosen.push({...c, groups:c.groups||groupsOf(c.muscle), isCustom:true}));
  return {name:focus.nev, focusId:focus.id, groups:focus.groups, exercises:chosen};
}

/* ---------------------------------------------------------------- ANATÓMIA */
function setAnatomyView(view){
  state.anatomyView=view;
  document.getElementById('view-front-btn').classList.toggle('active',view==='front');
  document.getElementById('view-back-btn').classList.toggle('active',view==='back');
  document.getElementById('anatomy-figure').innerHTML=bodySvg(view,'anatomy-muscle');
  updateAnatomyHighlights();
}
// a regenerációs hőtérkép mindkét nézetet mutatja (mint a referenciakép)
function renderRecoveryFigure(){
  const box=document.getElementById('recovery-figure');
  if(box && !box.children.length)
    box.innerHTML=bodySvg('front','muscle-part-recov')+bodySvg('back','muscle-part-recov');
}
function tapMuscle(muscleCat){
  if(!state.activeSession) return;
  if(state.selectedMuscleFilter===muscleCat){
    state.selectedMuscleFilter=null;
    document.getElementById('anatomy-hint').textContent='Koppints egy gyakorlatra vagy izomra';
  }else{
    state.selectedMuscleFilter=muscleCat;
    document.getElementById('anatomy-hint').textContent=`Szűrés: ${muscleNamesHu[muscleCat]||muscleCat}`;
  }
  state.highlightedExercise=null;
  updateAnatomyHighlights();
  renderAnatomyExerciseList();
}
function selectExerciseInOverview(idx){
  if(!state.activeSession) return;
  if(state.highlightedExercise===idx){
    state.highlightedExercise=null;
    document.getElementById('anatomy-hint').textContent='Koppints egy gyakorlatra vagy izomra';
  }else{
    state.highlightedExercise=idx;
    const ex=state.activeSession.exercises[idx];
    state.selectedMuscleFilter=null;
    const gs=ex.groups||groupsOf(ex.muscle);
    document.getElementById('anatomy-hint').textContent=`Cél: ${gs.map(muscleName).join(', ')}`;
    // arra a nézetre váltunk, ahonnan a célizom egyáltalán látszik
    const BACK_ONLY=['lat','trap','rear_delt','triceps','glute','hamstring','lower_back'];
    const frontVisible=gs.some(g=>!BACK_ONLY.includes(g));
    setAnatomyView(frontVisible ? 'front' : 'back');
  }
  updateAnatomyHighlights();
  renderAnatomyExerciseList();
}
function updateAnatomyHighlights(){
  if(!state.activeSession) return;
  document.querySelectorAll('.anatomy-muscle').forEach(m=>{
    m.classList.remove('active','filter','dim');
    const cat=m.dataset.muscle;
    if(state.highlightedExercise!==null){
      const ex=state.activeSession.exercises[state.highlightedExercise];
      m.classList.add((ex.groups||groupsOf(ex.muscle)).includes(cat) ? 'active' : 'dim');
    }else if(state.selectedMuscleFilter){
      m.classList.add(cat===state.selectedMuscleFilter ? 'filter' : 'dim');
    }
  });
}
function renderAnatomyExerciseList(){
  const list=document.getElementById('anatomy-exercise-list');
  if(!state.activeSession) return;
  let show=state.activeSession.exercises;
  if(state.selectedMuscleFilter)
    show=state.activeSession.exercises.filter(ex=>(ex.groups||groupsOf(ex.muscle)).includes(state.selectedMuscleFilter));
  if(show.length===0){
    list.innerHTML=`<div class="card" style="text-align:center;color:var(--dim);font-size:13px">Erre az izomra ma nincs gyakorlat.</div>`;
    return;
  }
  list.innerHTML=show.map(ex=>{
    const i=state.activeSession.exercises.indexOf(ex);
    const sel=state.highlightedExercise===i;
    return `<div class="ex-list-item ${sel?'selected':''}" onclick="selectExerciseInOverview(${i})">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:8px;height:30px;background:${sel?'var(--accent)':'var(--faint)'};border-radius:4px"></div>
        <div>
          <div style="font-size:10px;color:var(--accent);letter-spacing:.15em;text-transform:uppercase;margin-bottom:2px">${esc((ex.groups||groupsOf(ex.muscle)).map(muscleName).join(', '))}</div>
          <div style="font-weight:700;font-size:15px">${esc(ex.name)}</div>
        </div>
      </div>
      <div style="text-align:right" class="num">
        <div style="font-size:11px;color:var(--dim)">${ex.sets} × ${ex.reps}</div>
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
  openModal(`<h3 class="hand" style="font-size:24px;margin:0 0 10px">${esc(title)}</h3>
    <p style="font-size:13px;color:var(--dim);margin:0 0 18px;line-height:1.5">${esc(text)}</p>
    <button class="btn-primary" style="background:var(--danger);color:#fff;margin-bottom:8px" onclick="confirmYes()">${esc(okLabel)}</button>
    <button class="btn-secondary" onclick="hideModal()">MÉGSE</button>`);
}
function confirmYes(){ hideModal(); const cb=_confirmCb; _confirmCb=null; if(cb) cb(); }
/* ============================================================================
   HETI BEOSZTÁS SZERKESZTŐJE
   Egy nap = izomcsoportok halmaza. Régiónként csoportosítva, hogy a 16 csoport
   ne legyen áttekinthetetlen; a gyors gombokkal egész testtáj bejelölhető.
   ========================================================================== */
const EDITOR_REGIONS=[
  {nev:'Mell',  keys:['chest']},
  {nev:'Hát',   keys:['lat','trap','lower_back']},
  {nev:'Váll',  keys:['front_delt','side_delt','rear_delt']},
  {nev:'Kar',   keys:['biceps','triceps','forearm']},
  {nev:'Has',   keys:['abs','oblique']},
  {nev:'Láb',   keys:['quad','hamstring','glute','calf']}
];
let dayDraft=null, dayDraftIdx=null;
function openDayEditor(i){
  dayDraftIdx=i;
  dayDraft=new Set(weekPlan()[i]||[]);
  drawDayEditor();
}
function drawDayEditor(){
  const i=dayDraftIdx;
  const sel=[...dayDraft];
  openModal(`
    <h3 class="hand" style="font-size:26px;margin:0 0 2px">${DAY_NAMES[i]}</h3>
    <p class="tiny" style="margin:0 0 2px">Mit edzel ezen a napon? A beállítás minden héten érvényes.</p>
    <p class="tiny" style="margin:0 0 6px;color:var(--accent)">${esc(labelForGroups(sel))}${sel.length?` · ${sel.length} izomcsoport`:''}</p>
    ${EDITOR_REGIONS.map(r=>{
      const mind=r.keys.every(k=>dayDraft.has(k));
      return `<div class="lbl" style="margin:12px 0 6px;display:flex;justify-content:space-between;align-items:center">
          <span>${r.nev}</span>
          <button class="tiny" style="background:none;border:none;color:var(--accent);cursor:pointer"
            onclick="toggleRegion('${r.keys.join(',')}',${mind?0:1})">${mind?'mind ki':'mind be'}</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${r.keys.map(k=>`<button class="chip ${dayDraft.has(k)?'active':''}" onclick="toggleDayGroup('${k}')">${esc(muscleName(k))}</button>`).join('')}
        </div>`;
    }).join('')}
    <div class="grid grid-cols-2 gap-2" style="margin-top:20px">
      <button class="btn-secondary" onclick="clearDayDraft()">Pihenőnap</button>
      <button class="btn-secondary" onclick="hideModal()">Mégse</button>
    </div>
    <button class="btn-primary" style="margin-top:8px" onclick="saveDayEditor()">Mentés</button>`);
}
function toggleDayGroup(k){ dayDraft.has(k)?dayDraft.delete(k):dayDraft.add(k); drawDayEditor(); }
function toggleRegion(keys,on){ keys.split(',').forEach(k=>on?dayDraft.add(k):dayDraft.delete(k)); drawDayEditor(); }
function clearDayDraft(){ dayDraft=new Set(); drawDayEditor(); }
function saveDayEditor(){
  const wp=weekPlan().map(a=>a.slice());
  wp[dayDraftIdx]=[...dayDraft];
  state.weekPlan=wp;
  // ha a MAI napot írtuk át, a korábbi kézi felülírás már félrevezetne
  if(dayDraftIdx===dayIndexToday()) state.todayFocus=null;
  saveState(); hideModal(); renderPlan();
  showToast(`${DAY_NAMES[dayDraftIdx]}: ${labelForGroups(wp[dayDraftIdx])}`);
}

/* A mai terv átírása: előre beállított fókuszok. A választás CSAK a mai napra
   érvényes, holnap visszatér a heti beosztás. */
function openFocusPicker(){
  const cur=todayFocus();
  const kezi = state.todayFocus && state.todayFocus.date===new Date().toDateString();
  const csoport=(cim,ids)=>`
    <div class="lbl" style="margin:14px 0 8px">${cim}</div>
    <div style="display:flex;flex-wrap:wrap;gap:7px">
      ${ids.map(id=>{const f=focusById(id); if(!f) return '';
        const on=cur.id===id;
        const db=f.groups.length?f.groups.reduce((n,g)=>n+exercisesFor(g,eqSet()).length,0):0;
        return `<button class="chip ${on?'active':''}" onclick="setTodayFocus('${id}')" ${db===0&&f.groups.length?'disabled style="opacity:.35"':''}>
          ${esc(f.nev)}${f.groups.length?` <span class="faint">${db}</span>`:''}</button>`;}).join('')}
    </div>`;
  openModal(`
    <h3 class="hand" style="font-size:26px;margin:0 0 4px">Mai terv</h3>
    <p class="tiny" style="margin:0 0 4px">Most: <b style="color:var(--accent)">${esc(cur.nev)}</b>${kezi?' (kézi választás)':' (heti beosztás szerint)'}</p>
    <p class="tiny" style="margin:0">A választás csak a mai napra érvényes. A szám a választható gyakorlatok darabszáma.</p>
    ${csoport('Nagy blokkok',['teljes','felsotest','alsotest','tolo','huzo','lab'])}
    ${csoport('Izomcsoport',['mell','hat','vall','kar','bicepsz','tricepsz','has','comb','combhajl','far','vadli','alkar','derek'])}
    ${csoport('Egyéb',['piheno'])}
    ${kezi?`<button class="btn-secondary" style="margin-top:18px" onclick="clearTodayFocus()">Vissza a heti beosztásra</button>`:''}
    <button class="btn-primary" style="margin-top:8px" onclick="hideModal()">Bezárás</button>`);
}

function showCalisthenicsInfo(){
  openModal(`
    <h3 class="hand" style="font-size:24px;margin:0 0 12px">CALISTHENICS</h3>
    <p style="font-size:13px;color:var(--dim);margin-bottom:12px">A calisthenics nem csak izomtömeget épít, egyszerre fejleszti:</p>
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

/* ============================================================================
   SAJÁT KÉPEK az edzésekhez
   A galériából választott kép NÉGYZETRE vágva, 360px-re kicsinyítve tárolódik
   (JPEG, ~20-40 KB) — a localStorage csak néhány MB. Terv-típusonként egy kép:
   ez jelenik meg a „Mai edzés" kisképeként a rajzolt figura helyett.
   ========================================================================== */
function pickImageFile(){
  return new Promise(res=>{
    const inp=document.createElement('input');
    inp.type='file'; inp.accept='image/*';
    inp.onchange=()=>res(inp.files && inp.files[0] ? inp.files[0] : null);
    inp.click();
  });
}
async function fileToThumb(file, size=360){
  // a createImageBitmap kezeli a telefonos képek EXIF-forgatását is
  let src=null, url=null;
  try{ src=await createImageBitmap(file,{imageOrientation:'from-image'}); }catch(e){}
  if(!src){
    url=URL.createObjectURL(file);
    src=await new Promise((ok,no)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=no;i.src=url;});
  }
  const w=src.width||src.naturalWidth, h=src.height||src.naturalHeight;
  const s=Math.min(w,h);                                   // középre igazított négyzet-vágás
  const c=document.createElement('canvas');
  c.width=c.height=size;
  c.getContext('2d').drawImage(src,(w-s)/2,(h-s)/2,s,s,0,0,size,size);
  if(src.close) src.close();
  if(url) URL.revokeObjectURL(url);
  return c.toDataURL('image/jpeg',0.82);
}
async function choosePlanImage(focusId){
  const file=await pickImageFile();
  if(!file) return;
  showToast('Kép feldolgozása…');
  let data;
  try{ data=await fileToThumb(file); }
  catch(e){ showToast('A képet nem sikerült beolvasni'); return; }
  const prev=state.planImages[focusId];
  state.planImages[focusId]=data;
  try{ localStorage.setItem(LS_KEY, JSON.stringify(state)); }
  catch(e){                                                // tele a tár: visszavonjuk
    if(prev) state.planImages[focusId]=prev; else delete state.planImages[focusId];
    showToast('Nincs elég hely a képnek'); return;
  }
  renderPlan(); showToast('Kép beállítva');
}
function planImageMenu(focusId){
  if(!state.planImages[focusId]){ choosePlanImage(focusId); return; }
  openModal(`<h3 class="hand" style="font-size:24px;margin:0 0 14px">Kép az edzéshez</h3>
    <img src="${state.planImages[focusId]}" style="width:100%;max-width:200px;display:block;margin:0 auto 16px;border-radius:16px">
    <button class="btn-primary mb-2" onclick="hideModal();choosePlanImage('${focusId}')">Másik kép</button>
    <button class="btn-secondary mb-2" onclick="removePlanImage('${focusId}')" style="color:var(--danger)">Kép törlése</button>
    <button class="btn-secondary" onclick="hideModal()">Mégse</button>`);
}
function removePlanImage(focusId){
  delete state.planImages[focusId];
  saveState(); hideModal(); renderPlan(); showToast('Kép törölve');
}

/* ============================================================================
   SAJÁT GYAKORLATOK
   A hozzáadott gyakorlat MEGMARAD a Profil képernyőn (savedExercises), azzal
   együtt, hogy melyik edzéshez adtad hozzá — így később bármikor visszatehető.
   ========================================================================== */
function toggleAddCustomEx(){ document.getElementById('add-custom-ex-form').classList.toggle('active'); }
function addCustomExercise(){
  const name=document.getElementById('custom-ex-name').value.trim();
  const muscle=document.getElementById('custom-ex-muscle').value;
  const sets=+document.getElementById('custom-ex-sets').value||3;
  const reps=+document.getElementById('custom-ex-reps').value||10;
  const weight=+document.getElementById('custom-ex-weight').value||0;
  if(!name){ showToast('Adj meg egy nevet!'); return; }
  const focus=todayFocus();
  const ex={id:'c'+Date.now(),name,groups:[muscle],sets,reps,repMin:reps,repMax:reps,rest:90,weight,type:'custom'};
  state.customTodayExercises.push(ex);
  state.customExercisesDate=new Date().toDateString();
  // mentés a könyvtárba (név+izomcsoport szerint egyszer)
  const kulcs=(name+'|'+muscle).toLowerCase();
  if(!state.savedExercises.some(s=>(s.name+'|'+s.groups[0]).toLowerCase()===kulcs)){
    state.savedExercises.push({id:'s'+Date.now(),name,groups:[muscle],sets,reps,weight,
      addedTo:focus?focus.nev:'—', addedToId:focus?focus.id:null, createdAt:new Date().toISOString()});
  }
  saveState(); renderPlan(); showToast('Hozzáadva és elmentve a Profilba');
}
function deleteCustomExercise(id){
  state.customTodayExercises=state.customTodayExercises.filter(e=>String(e.id)!==String(id));
  saveState(); renderPlan(); showToast('Gyakorlat törölve a mai tervből');
}
// könyvtárból vissza a mai tervbe
function useSavedExercise(id){
  const s=state.savedExercises.find(x=>String(x.id)===String(id));
  if(!s) return;
  if(state.customTodayExercises.some(e=>e.name===s.name)){ showToast('Már a mai tervben van'); return; }
  state.customTodayExercises.push({id:'c'+Date.now(),name:s.name,groups:s.groups.slice(),
    sets:s.sets,reps:s.reps,repMin:s.reps,repMax:s.reps,rest:90,weight:s.weight,type:'custom'});
  state.customExercisesDate=new Date().toDateString();
  saveState(); renderProfile(); renderPlan(); showToast('Hozzáadva a mai tervhez');
}
function deleteSavedExercise(id){
  state.savedExercises=state.savedExercises.filter(x=>String(x.id)!==String(id));
  saveState(); renderProfile(); showToast('Törölve a mentések közül');
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
  const bar=document.getElementById('fast-bar');
  bar.style.width=Math.min(100,elapsed/target*100)+'%';
  bar.parentElement.style.color = remaining===0 ? 'var(--success)' : 'var(--pink)';
  if(remaining===0) document.getElementById('fast-info').textContent='Cél elérve! Megszakíthatod a böjtöt.';
}

/* ---------------------------------------------------------------- RENDER: KEZDŐLAP */
const DAYS_HU=['H','K','Sze','Cs','P','Szo','V'];
function weekStart(d=new Date()){ const x=new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; }
// a hét (H..V) napi volumene a tényleges edzésekből
function weekVolumes(){
  const start=weekStart().getTime(), out=[0,0,0,0,0,0,0];
  realWorkouts(state).forEach(w=>{
    const i=Math.floor((midnight(new Date(w.date))-start)/86400000);
    if(i>=0&&i<7) out[i]+=w.volume;
  });
  return out;
}
function todayWorkouts(){ const t=new Date().toDateString(); return realWorkouts(state).filter(w=>new Date(w.date).toDateString()===t); }

/* satírozott oszlopdiagram — kézzel rajzolt tengellyel */
// nagy számok rövidítése a tengelyen: 4900 -> 4,9k
function shortNum(v){
  if(v>=1000) return (v/1000).toFixed(v%1000===0?0:1).replace('.',',')+'k';
  return String(Math.round(v));
}
function hatchChart(vals,labels,unit){
  const W=300,H=140,padL=32,padR=6,padT=12,padB=24;
  const max=Math.max(1,...vals);
  // kerek felső határ, hogy a tengelyfeliratok is kerek számok legyenek
  const step=Math.pow(10,Math.floor(Math.log10(max)))/2;
  const nice=Math.max(step*2,Math.ceil(max/step)*step);
  const slot=(W-padL-padR)/vals.length;
  const bw=Math.min(24,slot*0.5);
  let bars='',days='',ticks='';
  vals.forEach((v,i)=>{
    const h=v>0?Math.max(3,(v/nice)*(H-padT-padB)):0;
    const cx=padL+i*slot+slot/2;
    if(h>0) bars+=`<rect class="bar" x="${(cx-bw/2).toFixed(1)}" y="${(H-padB-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3"/>`;
    days+=`<text class="day" x="${cx.toFixed(1)}" y="${H-7}">${esc(labels[i])}</text>`;
  });
  for(let k=0;k<=2;k++){
    const v=nice/2*k, y=H-padB-(v/nice)*(H-padT-padB);
    ticks+=`<text class="tick" x="${padL-6}" y="${(y+3.5).toFixed(1)}" text-anchor="end">${shortNum(v)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit||'')}">
    <path class="axis" d="M${padL-3} ${padT-2} L${padL-3} ${H-padB} L${W-3} ${H-padB}"/>
    ${ticks}${bars}${days}</svg>`;
}

function renderPlan(){
  const u=state.user;
  document.getElementById('greeting').textContent = u.name ? `Szia, ${u.name}!` : 'Szia!';
  document.getElementById('streak-count').textContent=u.streak;
  document.getElementById('user-level').textContent=u.level;
  document.getElementById('user-title').textContent=getTitle(u.level);
  const need=xpForLevel(u.level);
  document.getElementById('user-xp').textContent=`${u.xp} / ${need}`;
  document.getElementById('xp-fill').style.width=(u.xp/need*100)+'%';
  document.getElementById('xp-to-next').textContent=`${need-u.xp} XP a ${u.level+1}. szintig · ${formatDate()}`;

  /* --- napi trió: kalória, szett, aktív perc (mind valós adatból) --- */
  const dayKey=new Date().toDateString();
  const meals=state.diet.meals[dayKey]||[];
  const kcal=meals.reduce((s,m)=>s+m.cals,0);
  const tw=todayWorkouts();
  const sets=tw.reduce((s,w)=>s+w.sets,0);
  const mins=Math.round(tw.reduce((s,w)=>s+w.duration,0)/60);
  const trio=[
    {ic:'fire',  c:'var(--lime)',  lbl:'Kalória',   val:kcal, goal:state.diet.calorieGoal, unit:'kcal'},
    {ic:'dumbbell',c:'var(--purple)',lbl:'Szettek', val:sets, goal:20, unit:'szett'},
    {ic:'clock', c:'var(--blue)',  lbl:'Aktív perc',val:mins, goal:60, unit:'perc'}
  ];
  document.getElementById('trio').innerHTML=trio.map((t,i)=>`
    <div>
      <div class="ring ${i===1?'s2':i===2?'s3':''}" style="color:${t.c};margin:0 auto">${ic(t.ic)}</div>
      <div class="lbl">${t.lbl}</div>
      <div class="val" style="color:${t.c}">${t.val.toLocaleString('hu')}</div>
      <div class="goal">/ ${t.goal.toLocaleString('hu')} ${t.unit}</div>
      <div class="hbar slim" style="color:${t.c}"><i style="width:${Math.min(100,t.val/t.goal*100)}%"></i></div>
    </div>`).join('');

  /* --- mai edzés --- */
  const card=document.getElementById('today-workout-card');
  const today=generateTodayWorkout();
  // saját kép, ha van hozzá — különben a rajzolt figura; mindkettő koppintható
  const fid=(today&&today.focusId)||todayFocus().id;
  const kep=state.planImages[fid];
  const ill = kep
    ? `<div class="today-photo" onclick="planImageMenu('${fid}')"><img src="${kep}" alt="">
         <span class="photo-edit">${ic('pen',13)}</span></div>`
    : `<div class="ill-btn" onclick="planImageMenu('${fid}')">
         <svg class="today-ill" viewBox="0 0 200 168"><use href="#ill-lifter"/></svg>
         <span class="photo-edit">${ic('pen',13)}</span></div>`;
  if(state.completedToday){
    card.innerHTML=`<div class="card text-center" style="padding:26px 20px">
      <div style="font-size:46px;color:var(--lime);margin-bottom:8px">${ic('check-circle')}</div>
      <div class="hand" style="font-size:28px;margin-bottom:4px">Mai cél teljesítve</div>
      <p class="dim" style="font-size:14px;margin:0">Szép munka. Pihenj jól, és gyere vissza holnap.</p>
    </div>`;
  }else if(today && today.exercises.length>0){
    const totalSets=today.exercises.reduce((s,e)=>s+e.sets,0);
    const mins=Math.round(today.exercises.reduce((a,e)=>a+e.sets*(0.8+e.rest/60),0));
    const intensity={build:'Közepes',calisthenics:'Közepes',cardio:'Könnyű',rest:'—'}[state.goal]||'Közepes';
    const kezi = state.todayFocus && state.todayFocus.date===new Date().toDateString();
    card.innerHTML=`<div class="card">
      <div class="today-wrap">
        ${ill}
        <div class="today-info">
          <div class="today-name">${esc(today.name)}${kezi?' <span class="tiny" style="color:var(--accent)">· kézi</span>':''}</div>
          <div class="today-meta">${ic('clock')} ${mins} perc · ${totalSets} szett</div>
          <div class="today-meta">${ic('dumbbell')} ${intensity} · ${today.exercises.length} gyakorlat</div>
          <button class="btn-primary" style="margin-top:11px" onclick="startSession()">Kezdés</button>
          <button class="btn-secondary" style="margin-top:8px" onclick="openFocusPicker()">${ic('pen',13)} Mai terv átírása</button>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 12px">
        ${today.exercises.map(ex=>`<span class="chip" style="padding:5px 11px;font-size:12px;font-weight:400;color:var(--dim)">${ex.isCustom?ic('user-plus',10)+' ':''}${ex.tier?`<b style="color:var(--accent)">${ex.tier}</b> `:''}${esc(ex.name)} <span class="faint">${ex.sets}×${ex.repMin===ex.repMax?ex.reps:ex.repMin+'-'+ex.repMax}</span></span>`).join('')}
      </div>
      <button class="btn-secondary" onclick="toggleAddCustomEx()">Saját gyakorlat hozzáadása</button>
      <div class="add-form" id="add-custom-ex-form">
        <input type="text" id="custom-ex-name" placeholder="Gyakorlat neve" class="input-text mb-2">
        <select id="custom-ex-muscle" class="input-text mb-2">
          ${MUSCLE_KEYS.map(k=>`<option value="${k}">${muscleName(k)}</option>`).join('')}
        </select>
        <div class="grid grid-cols-3 gap-2 mb-3">
          <input type="number" inputmode="numeric" id="custom-ex-sets" placeholder="Szett" class="input-num" style="font-size:14px;padding:9px">
          <input type="number" inputmode="numeric" id="custom-ex-reps" placeholder="Ism." class="input-num" style="font-size:14px;padding:9px">
          <input type="number" inputmode="decimal" id="custom-ex-weight" placeholder="Kg" class="input-num" style="font-size:14px;padding:9px">
        </div>
        <button class="btn-primary" onclick="addCustomExercise()" style="font-size:19px;padding:10px">Hozzáadás</button>
      </div>
      ${state.customTodayExercises.length>0?`
        <div style="margin-top:12px">
          <div class="lbl mb-2">Saját gyakorlatok</div>
          ${state.customTodayExercises.map(ex=>`
            <div class="meal-item">
              <span style="font-size:14px">${esc(ex.name)} <span class="tiny">(${esc((ex.groups||groupsOf(ex.muscle)).map(muscleName).join(', '))})</span></span>
              <div style="display:flex;align-items:center;gap:8px">
                <span class="tiny num">${ex.sets}×${ex.reps} · ${ex.weight}kg</span>
                <button onclick="deleteCustomExercise('${ex.id}')" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:13px">${ic('trash',13)}</button>
              </div>
            </div>`).join('')}
        </div>`:''}
    </div>`;
  }else{
    card.innerHTML=`<div class="card text-center" style="padding:26px 20px">
      <div style="font-size:46px;color:var(--dim);margin-bottom:8px">${ic('bed')}</div>
      <div class="hand" style="font-size:28px;margin-bottom:4px">Pihenőnap</div>
      <p class="dim" style="font-size:14px;margin:0 0 16px">Az izom pihenés közben nő. Ma vedd könnyebben.</p>
      <button class="btn-primary mb-2" onclick="takeRestDay()">Pihenő rögzítése</button>
      <button class="btn-secondary" onclick="openFocusPicker()">${ic('pen',13)} Mégis edzek — terv választása</button>
    </div>`;
  }

  /* --- heti diagram --- */
  const vols=weekVolumes();
  const total=vols.reduce((a,b)=>a+b,0);
  document.getElementById('home-chart-card').innerHTML=`
    <div class="chartbox">
      <div class="chart">${hatchChart(vols,DAYS_HU,'heti volumen')}</div>
      <div>
        <div class="totalring">
          <div class="t">Összesen</div>
          <div class="v">${total>=1000?(total/1000).toFixed(1)+'t':total}</div>
          <div class="u">${total>=1000?'':'kg'}</div>
        </div>
        <div class="tiny text-center" style="margin-top:8px">${total>0?'Szép munka! ♥':'Kezdj bele!'}</div>
      </div>
    </div>`;

  /* --- heti cél --- */
  const doneThisWeek=vols.filter(v=>v>0).length;
  const wg=state.weeklyGoal||4;
  document.getElementById('week-goal-card').innerHTML=`
    <div class="goalrow">
      <div class="ring s2" style="color:var(--pink)">${ic('target')}</div>
      <div style="flex:1;min-width:0">
        <div class="flex justify-between items-end mb-1">
          <div><div class="gname">Heti edzések</div><div class="gsub">cél: ${wg} alkalom</div></div>
          <div class="gval num">${doneThisWeek} / ${wg}</div>
        </div>
        <div class="hbar" style="color:var(--pink)"><i style="width:${Math.min(100,doneThisWeek/wg*100)}%"></i></div>
      </div>
      <div class="gpct" style="color:var(--pink)">${Math.round(Math.min(100,doneThisWeek/wg*100))}%</div>
    </div>`;

  /* --- edzéscél kártyák --- */
  document.getElementById('goal-grid').innerHTML=Object.entries(GOAL_INFO).map(([key,g])=>`
    <div class="goal-card ${state.goal===key?'active':''}" onclick="setGoal('${key}')">
      <div class="flex justify-between items-start mb-2">
        <span style="font-size:21px;color:${state.goal===key?'var(--accent)':'var(--dim)'}">${ic(g.icon,21)}</span>
        ${state.goal===key?`<span style="color:var(--accent);font-size:15px">${ic('check',15)}</span>`:''}
        ${key==='calisthenics'?`<span onclick="event.stopPropagation();showCalisthenicsInfo()" style="color:var(--faint);font-size:15px;cursor:pointer">${ic('info',15)}</span>`:''}
      </div>
      <div class="hand" style="font-size:21px;line-height:1.05;margin-bottom:2px">${esc(g.nev)}</div>
      <div class="tiny">${esc(g.desc)}</div>
    </div>`).join('');

  /* --- heti beosztás: a saját terv, minden nap koppintással átírható --- */
  const todayIdx=dayIndexToday();
  document.getElementById('weekly-schedule').innerHTML=weekPlan().map((groups,i)=>{
    const f = i===todayIdx ? todayFocus() : focusForDay(i);
    let cls='day-pill';
    if(i===todayIdx) cls+=' today';
    else if(!f.groups.length) cls+=' rest';
    const rovid = !f.groups.length ? 'pihen' : f.nev.replace(/ \+ /g,'+').toLowerCase();
    return `<div class="${cls}" onclick="openDayEditor(${i})" title="${esc(f.nev)}">
      <span style="opacity:.75">${DAY_SHORT[i]}</span>
      <span style="font-size:8.5px;line-height:1.05;text-align:center;padding:0 2px">${esc(rovid)}</span></div>`;
  }).join('');

  renderRecovery();
}

function renderRecovery(){
  const all=MUSCLE_KEYS.map(m=>({m,r:getRecoveryLevel(m)}));
  const ready=all.filter(x=>x.r.label==='KÉSZ').length;
  const row=(x,small)=>`<div class="muscle-row"${small?' style="padding:5px 0"':''}>
      <div class="label"${small?' style="font-size:12px"':''}>${muscleName(x.m)}</div>
      <div class="muscle-bar" style="color:${x.r.color}"><div class="muscle-bar-fill" style="width:${x.r.pct}%"></div></div>
      <div class="status" style="color:${x.r.color};width:74px;text-align:right">${x.r.label.toLowerCase()}</div>
    </div>`;
  // 16 csoport túl hosszú lista a kezdőlapra: ott a 6 legkevésbé regenerált látszik
  const worst=[...all].sort((a,b)=>a.r.pct-b.r.pct).slice(0,6);
  document.getElementById('recovery-card').innerHTML=worst.map(x=>row(x)).join('');
  document.getElementById('recovery-summary').textContent=`${ready} / ${all.length} kész`;

  renderRecoveryFigure();
  document.querySelectorAll('.muscle-part-recov').forEach(el=>{
    const r=getRecoveryLevel(el.dataset.muscle);
    el.style.fill = r.label==='KÉSZ' ? '#7ddc6a' : (r.label==='PIHEN' ? '#f04b74' : '#f5b642');
    el.style.stroke = 'rgba(255,255,255,.35)';
  });
  // a Statisztika képernyőn mind a 16 csoport
  const legend=document.getElementById('recovery-legend');
  if(legend) legend.innerHTML=all.map(x=>row(x,true)).join('');
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
  document.getElementById('session-day-name').textContent=s.workoutName;
  document.getElementById('exercise-counter').textContent=`${s.currentExerciseIndex+1}. gyakorlat / ${s.exercises.length}`;
  const totalSets=s.exercises.reduce((sum,e)=>sum+e.sets,0);
  document.getElementById('session-progress').style.width=(s.completedSets.length/totalSets*100)+'%';
  const vol=s.completedSets.reduce((sum,set)=>sum+set.weight*set.reps,0);
  document.getElementById('volume-so-far').textContent=`${vol.toLocaleString('hu')} kg megemelve`;
  const gs=ex.groups||groupsOf(ex.muscle);
  document.getElementById('muscle-target').textContent=gs.map(muscleName).join(' + ');
  document.getElementById('exercise-name').innerHTML=esc(ex.name);
  document.getElementById('set-display').textContent=`${s.currentSet}/${ex.sets}`;
  document.getElementById('reps-display').textContent=ex.reps;
  document.getElementById('weight-display').textContent=ex.weight;
  document.getElementById('weight-input').value=ex.weight;
  document.getElementById('reps-input').value=ex.reps;

  // a dolgoztatott izom satírozva emelődik ki, a többi elhalkul.
  // Hátulnézet akkor, ha a célcsoportok többsége csak onnan látszik.
  const BACK_ONLY=['lat','trap','rear_delt','triceps','glute','hamstring','lower_back'];
  const view = gs.some(g=>BACK_ONLY.includes(g)) && !gs.some(g=>['chest','front_delt','abs','quad','biceps'].includes(g)) ? 'back' : 'front';
  const bodyBox=document.getElementById('body-diagram');
  if(bodyBox.dataset.view!==view){
    bodyBox.innerHTML=bodySvg(view,'muscle-part');
    bodyBox.dataset.view=view;
  }
  bodyBox.querySelectorAll('.muscle-part').forEach(el=>{
    const on=gs.includes(el.dataset.muscle);
    el.classList.toggle('active',on);
    el.classList.toggle('dim',!on);
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
  document.getElementById('diet-day-label').textContent=isToday?'Ma':(d<new Date(todayStr)?'Múlt':'Jövő');
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
  document.getElementById('cal-status').textContent=rem>=0?'kcal hátravan':'kcal felett';
  document.getElementById('cal-status').style.color=rem>=0?'var(--faint)':'var(--danger)';
  const calBar=document.getElementById('cal-bar');
  calBar.style.width=Math.min(100,t.cals/state.diet.calorieGoal*100)+'%';
  calBar.parentElement.style.color=rem>=0?'var(--lime)':'var(--danger)';

  [['p',t.p,state.diet.macrosGoal.p],['c',t.c,state.diet.macrosGoal.c],['f',t.f,state.diet.macrosGoal.f]].forEach(([k,val,goal])=>{
    document.getElementById(k+'-consumed').textContent=val;
    document.getElementById(k+'-goal').textContent=goal;
    document.getElementById(k+'-bar').style.width=Math.min(100,val/goal*100)+'%';
  });

  const ml=document.getElementById('meals-list');
  ml.innerHTML = meals.length===0
    ? `<div style="text-align:center;color:var(--dim);font-size:13px;padding:10px 0">Még nincs rögzített étkezés.</div>`
    : meals.map(m=>`<div class="meal-item">
        <div style="flex:1">
          <div style="font-weight:600;font-size:14px">${esc(m.name)}</div>
          <div class="num" style="font-size:10px;color:var(--dim)">F:${m.p}g · Sz:${m.c}g · Z:${m.f}g</div>
        </div>
        <div style="text-align:right;display:flex;align-items:center;gap:10px">
          <div>
            <div class="num" style="font-size:16px;font-weight:700;color:var(--accent)">${m.cals}</div>
            <div style="font-size:9px;color:var(--dim);text-transform:uppercase">kcal</div>
          </div>
          <button class="icon-btn" onclick="deleteMeal('${m.id}')" style="width:30px;height:30px;background:transparent;border:none;color:var(--dim);font-size:12px">${ic('trash',12)}</button>
        </div></div>`).join('');

  const taken=state.diet.takenSupplements[key]||[];
  document.getElementById('supplements-list').innerHTML=state.diet.supplements.map(s=>{
    const on=taken.some(x=>String(x)===String(s.id));
    return `<div class="supplement-item ${on?'taken':''}" onclick="toggleSupplement('${s.id}')">
      <div class="supplement-check">${on?ic('check',12):''}</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:14px">${esc(s.name)}</div>
        <div style="font-size:11px;color:var(--dim)">${esc(s.dose||'')}${s.dose&&s.time?' · ':''}${esc(s.time||'')}</div>
      </div>
      <button onclick="event.stopPropagation();deleteSupplement('${s.id}')" style="background:none;border:none;color:var(--danger);cursor:pointer;padding:4px;font-size:12px">${ic('trash',12)}</button>
    </div>`;
  }).join('');

  const fs=document.getElementById('fast-status');
  if(state.diet.fasting.active){
    document.getElementById('fast-info').textContent='Böjt aktív. Maradj erős.';
    document.getElementById('fast-btn').textContent='Böjt megszakítása';
    fs.textContent='böjtöl'; fs.style.background='rgba(255,92,31,0.2)'; fs.style.color='var(--pink)';
    startFastingTimer();
  }else{
    if(fastingInterval){ clearInterval(fastingInterval); fastingInterval=null; }
    document.getElementById('fast-info').textContent='Indíts böjtöt a 16 órás ablakhoz.';
    document.getElementById('fast-btn').textContent='Böjt kezdése';
    fs.textContent='inaktív'; fs.style.background='transparent'; fs.style.color='var(--dim)';
    document.getElementById('fast-timer').textContent='16:00';
    document.getElementById('fast-bar').style.width='0%';
  }
}

/* ---------------------------------------------------------------- RENDER: STAT */
function renderProgress(){
  const recent=realWorkouts(state).slice(-7);
  const card=document.getElementById('progress-chart-card');
  if(recent.length===0){
    card.innerHTML=`<div class="tiny text-center" style="padding:14px">Fejezz be egy edzést, és itt látod a fejlődésed.</div>`;
  }else{
    const labels=recent.map(w=>{const d=new Date(w.date);return `${d.getMonth()+1}/${d.getDate()}`;});
    const total=recent.reduce((s,w)=>s+w.volume,0);
    card.innerHTML=`<div class="chart">${hatchChart(recent.map(w=>w.volume),labels,'volumen')}</div>
      <div class="flex justify-between mt-2" style="padding:0 4px">
        <span class="tiny">utolsó ${recent.length} edzés</span>
        <span class="tiny num" style="color:var(--accent)">${total.toLocaleString('hu')} kg összesen</span>
      </div>`;
  }

  const prs=Object.entries(state.personalRecords);
  document.getElementById('pr-grid').innerHTML = prs.length===0
    ? `<div class="card tiny text-center" style="grid-column:span 2">Még nincs rekord. Kezdj el emelni!</div>`
    : prs.slice(0,6).map(([name,w])=>`<div class="stat-tile" style="text-align:left">
        <div class="tiny" style="margin-bottom:2px">${esc(name)}</div>
        <div class="num" style="font-size:24px;color:var(--accent)">${w} kg</div></div>`).join('');

  const vols={};
  state.workouts.forEach(w=>{ if(w.muscleVolume) Object.entries(w.muscleVolume).forEach(([m,v])=>vols[m]=(vols[m]||0)+v); });
  const ms=Object.keys(vols).sort((a,b)=>vols[b]-vols[a]);
  document.getElementById('muscle-breakdown').innerHTML = ms.length===0
    ? `<div class="tiny text-center" style="padding:10px">Fejezz be egy edzést az elemzéshez</div>`
    : ms.slice(0,6).map(m=>`<div class="muscle-row">
        <div class="label" style="width:78px;flex:none">${esc(muscleNamesHu[m]||m)}</div>
        <div class="muscle-bar" style="flex:1;width:auto;color:var(--purple)"><div class="muscle-bar-fill" style="width:${vols[m]/vols[ms[0]]*100}%"></div></div>
        <div class="tiny num" style="width:68px;text-align:right;color:var(--accent)">${vols[m].toLocaleString('hu')}kg</div>
      </div>`).join('');

  renderRecovery();
}

/* ---------------------------------------------------------------- RENDER: PROFIL */
function renderProfile(){
  document.getElementById('profile-level').textContent=state.user.level;
  document.getElementById('profile-title').textContent=getTitle(state.user.level);
  document.getElementById('profile-total-xp').textContent=`${state.user.totalXp.toLocaleString('hu')} összes XP`;
  const nameInput=document.getElementById('profile-name');
  if(document.activeElement!==nameInput) nameInput.value=state.user.name||'';
  document.getElementById('profile-workouts').textContent=realWorkouts(state).length;
  document.getElementById('profile-streak').textContent=state.user.streak;
  const totalVol=state.workouts.reduce((s,w)=>s+w.volume,0);
  document.getElementById('profile-volume').textContent=totalVol>1000?(totalVol/1000).toFixed(1)+'t':totalVol;
  const totalSec=state.workouts.reduce((s,w)=>s+(w.duration||0),0);
  document.getElementById('profile-time').textContent=Math.floor(totalSec/3600)+'ó '+Math.floor((totalSec%3600)/60)+'p';

  /* --- elmentett saját gyakorlatok: mikor és melyik edzéshez adtad hozzá --- */
  const sx=state.savedExercises||[];
  document.getElementById('saved-ex-count').textContent = sx.length ? sx.length+' db' : '';
  document.getElementById('saved-exercises').innerHTML = sx.length===0
    ? `<div class="card tiny text-center">Még nincs mentett gyakorlatod. A Kezdőlapon a „Saját gyakorlat hozzáadása" gombbal vehetsz fel újat — automatikusan ide is bekerül.</div>`
    : sx.slice().reverse().map(s=>{
        const mai=state.customTodayExercises.some(e=>e.name===s.name);
        const d=new Date(s.createdAt);
        return `<div class="card tight mb-2" style="padding:13px">
          <div class="flex justify-between items-start gap-2">
            <div style="flex:1;min-width:0">
              <div class="hand" style="font-size:21px;line-height:1.1">${esc(s.name)}</div>
              <div class="tiny">${esc(s.groups.map(muscleName).join(', '))} · ${s.sets}×${s.reps}${s.weight?' · '+s.weight+' kg':''}</div>
              <div class="tiny" style="margin-top:3px">Hozzáadva: <b style="color:var(--accent)">${esc(s.addedTo)}</b> · ${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}</div>
            </div>
            <button class="icon-btn bare" onclick="deleteSavedExercise('${s.id}')" style="color:var(--danger);font-size:14px">${ic('trash',14)}</button>
          </div>
          <button class="btn-secondary mt-2" onclick="useSavedExercise('${s.id}')" ${mai?'disabled style="opacity:.45"':''}>
            ${mai?'Már a mai tervben':'Mai tervhez adom'}</button>
        </div>`;
      }).join('');

  renderSaveStatus();

  let unlocked=0;
  document.getElementById('achievements-grid').innerHTML=achievements.map(a=>{
    const on=state.achievements.includes(a.id);
    if(on) unlocked++;
    return `<div class="achievement ${on?'unlocked':'locked'}">
      <div class="achievement-icon">${ic(a.icon,18)}</div>
      <div style="font-size:10px;font-weight:700;letter-spacing:.03em;line-height:1.1">${esc(a.name)}</div>
    </div>`;
  }).join('');
  document.getElementById('achievement-count').textContent=`${unlocked} / ${achievements.length}`;
  document.getElementById('app-version').textContent=APP_VERSION;
}

/* Mentés-diagnosztika: ha valaha megint eltűnnének az adatok, itt látszik,
   MELYIK tár hibázik — a felhasználónak és nekem is ez az első kapaszkodó. */
function renderSaveStatus(){
  const box=document.getElementById('save-status');
  if(!box) return;
  const jel=v=>v===true?'<b style="color:var(--success)">működik</b>'
            :v===false?'<b style="color:var(--danger)">HIBA</b>'
            :'<span class="faint">még nem próbált</span>';
  const ido=t=>{ if(!t) return '—'; const d=new Date(t);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`; };
  const mb=v=>v==null?'—':(v>1048576?(v/1048576).toFixed(1)+' MB':Math.round(v/1024)+' KB');
  const baj = SAVE_INFO.ls===false || SAVE_INFO.idb===false;
  box.innerHTML=`
    ${baj?`<div class="mb-3" style="color:var(--danger);font-size:13px;line-height:1.45">
        ⚠ Az egyik tár nem működik. Ha privát böngészésben (Private Browsing) nyitottad meg,
        a böngésző semmit nem enged menteni — nyisd meg normál ablakban, vagy telepítsd
        a kezdőképernyőre.</div>`:''}
    <div class="muscle-row"><div class="label">Fő tár (localStorage)</div><div class="tiny">${jel(SAVE_INFO.ls)}</div></div>
    <div class="muscle-row"><div class="label">Tartalék tár (IndexedDB)</div><div class="tiny">${jel(SAVE_INFO.idb)}</div></div>
    <div class="muscle-row"><div class="label">Utolsó sikeres mentés</div><div class="tiny num">${ido(SAVE_INFO.lastOk)}</div></div>
    <div class="muscle-row"><div class="label">Mentés mérete</div><div class="tiny num">${mb(SAVE_INFO.size)}</div></div>
    <div class="muscle-row"><div class="label">Tartós tárolás</div><div class="tiny">${SAVE_INFO.persisted===true?'<b style="color:var(--success)">engedélyezve</b>':SAVE_INFO.persisted===false?'<span style="color:var(--warning)">nem garantált</span>':'—'}</div></div>
    <div class="muscle-row"><div class="label">Foglalt / elérhető</div><div class="tiny num">${mb(SAVE_INFO.usage)} / ${mb(SAVE_INFO.quota)}</div></div>
    ${SAVE_INFO.lastErr?`<div class="tiny" style="margin-top:8px;color:var(--warning)">Utolsó hiba: ${esc(SAVE_INFO.lastErr)}</div>`:''}
    <div class="tiny" style="margin-top:10px">Ha eltűnnének az adatok: a Mentés fájlba gombbal bármikor készíthetsz másolatot, és a Visszatöltéssel bármikor helyreállítható.</div>`;
}
/* Írás-olvasás körteszt: valóban túlél-e egy mentés mindkét tárban. */
async function mentesTeszt(){
  const proba='fitmates_test_'+Date.now();
  let ls=false, idb=false, err='';
  try{ localStorage.setItem(proba,'1'); ls=localStorage.getItem(proba)==='1'; localStorage.removeItem(proba); }
  catch(e){ err=(e&&e.name)||String(e); }
  try{ await idbSet('__test',proba); idb=(await idbGet('__test'))===proba; await idbDel('__test'); }
  catch(e){ err=err||((e&&e.name)||String(e)); }
  SAVE_INFO.ls=ls; SAVE_INFO.idb=idb; if(err) SAVE_INFO.lastErr=err;
  await kerTartosTarolast();
  saveState();
  renderSaveStatus();
  showToast(ls&&idb ? 'Mindkét tár működik ✓' : (ls||idb ? 'Csak az egyik tár működik' : 'Egyik tár sem működik!'));
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
// az ábra futásidőben készül, ezért delegált kattintás-kezelés
document.getElementById('anatomy-figure').addEventListener('click',e=>{
  const p=e.target.closest('.anatomy-muscle');
  if(p) tapMuscle(p.dataset.muscle);
});

function setGoal(g){
  state.goal=g; state.todayFocus=null;      // célváltásnál a kézi fókusz elveszti értelmét
  saveState(); renderPlan(); showToast(`Cél: ${GOAL_INFO[g].nev}`);
}

/* ---------------------------------------------------------------- EDZÉS-FOLYAMAT */
function startSession(){
  if(state.completedToday){ showToast('Ma már befejezted. Gyere vissza holnap!'); return; }
  const today=generateTodayWorkout();
  if(!today || today.exercises.length===0){ showToast('Ma pihenőnap — írd át a mai tervet, ha mégis edzel.'); return; }
  state.activeSession={
    workoutName:today.name,
    exercises:JSON.parse(JSON.stringify(today.exercises)),
    currentExerciseIndex:0, currentSet:1, startTime:Date.now(),
    completedSets:[], finished:false, started:false, newPRs:[], newAchievements:[]
  };
  state.selectedMuscleFilter=null; state.highlightedExercise=null;
  setAnatomyView('front');
  document.getElementById('anatomy-day-name').textContent=today.name;
  document.getElementById('anatomy-hint').textContent='Koppints egy gyakorlatra vagy izomra';
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
// a köszöntéshez használt név
document.addEventListener('input',e=>{
  if(e.target.id==='profile-name'){
    state.user.name=e.target.value.trim().slice(0,18);
    saveState();
  }
});
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
  s.completedSets.push({exercise:ex.name,groups:ex.groups||groupsOf(ex.muscle),set:s.currentSet,weight:ex.weight,reps:ex.reps});
  state.lastWeights[ex.id||ex.name]=ex.weight;
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
  askConfirm('Edzés megszakítása?','Az eddig rögzített szettek elvesznek.','Megszakítás',()=>{
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
    ? `${nextEx.name} · ${s.currentSet}. szett` : 'Edzés befejezve';

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
  s.completedSets.forEach(set=>(set.groups||groupsOf(set.muscle)).forEach(g=>{ muscleVol[g]=(muscleVol[g]||0)+set.weight*set.reps; }));
  // A regeneráció a testtérkép régióira íródik (a tricepsz/bicepsz a "karra"),
  // különben a kar sosem frissült volna.
  Object.keys(muscleVol).forEach(g=>{ if(MUSCLES[g]) state.muscleRecovery[g]=Date.now(); });

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

  document.getElementById('summary-title').textContent=s.workoutName+' kész';
  document.getElementById('summary-duration').textContent=`${Math.floor(duration/60)}:${String(duration%60).padStart(2,'0')}`;
  document.getElementById('summary-volume').textContent=volume.toLocaleString('hu')+' kg';
  document.getElementById('summary-sets').textContent=sets;
  document.getElementById('summary-xp').textContent='+'+xpGained;

  const prBox=document.getElementById('summary-prs');
  if(s.newPRs.length){
    prBox.style.display='block';
    document.getElementById('summary-prs-list').innerHTML=s.newPRs.map(pr=>
      `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(233,233,238,.16)">
        <span style="font-size:13px">${esc(pr.name)}</span>
        <span class="num" style="color:var(--warning);font-weight:700">${pr.weight}kg <span class="pr-badge">PR</span></span></div>`).join('');
  }else prBox.style.display='none';

  const achBox=document.getElementById('summary-achievements');
  if(s.newAchievements.length){
    achBox.style.display='block';
    document.getElementById('summary-achievements-list').innerHTML=s.newAchievements.map(a=>
      `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid rgba(233,233,238,.16)">
        <div class="achievement-icon" style="width:36px;height:36px;font-size:16px;background:var(--accent);color:#000">${ic(a.icon,16)}</div>
        <div><div style="font-size:13px;font-weight:700">${esc(a.name)}</div>
        <div style="font-size:11px;color:var(--dim)">${esc(a.desc)}</div></div></div>`).join('');
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
        ALLOW_WIPE=true; LOAD_ERROR=null;
        state=deepMerge(JSON.parse(JSON.stringify(DEFAULT_STATE)),o);
        state.muscleRecovery=migrateRecovery(state.muscleRecovery);
        saveState(); ALLOW_WIPE=false; renderAll(); switchScreen('plan'); showToast('Mentés visszatöltve');
      }catch(e){ showToast('Hibás mentésfájl'); }
    };
    r.readAsText(f);
  };
  inp.click();
}
function resetData(){
  askConfirm('Minden adat törlése?','Ez véglegesen törli az edzéseidet, szintedet és jelvényeidet. Nem visszavonható.','Törlés',()=>{
    ALLOW_WIPE=true; LOAD_ERROR=null;
    state=JSON.parse(JSON.stringify(DEFAULT_STATE));
    idbDel(IDB_KEY).catch(()=>{});
    try{ localStorage.removeItem(LS_KEY+'_serult'); }catch(e){}
    saveState(); ALLOW_WIPE=false;
    renderAll(); switchScreen('plan'); showToast('Adatok törölve');
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

/* tartalék tár + tartós tárolás — az adatvesztés ellen */
hydrateFromIDB();
kerTartosTarolast().then(renderSaveStatus);

/* A service worker cache-first, ezért fejlesztés közben makacsul a RÉGI fájlokat
   szolgálná ki minden újratöltésnél (ez a hiba a korábbi projektekben is visszatért).
   Localhoston ezért ki van kapcsolva, sőt a korábban regisztrált példányt is
   eltakarítja; éles kiszolgálón normálisan működik. */
const IS_DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if('serviceWorker' in navigator){
  if(IS_DEV){
    navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});
    if(window.caches) caches.keys().then(ks=>ks.forEach(k=>caches.delete(k))).catch(()=>{});
  }else{
    window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
  }
}
