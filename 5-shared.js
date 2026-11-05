/* Bijay Cup 2026 - shared auction state engine
   One source of truth: localStorage + BroadcastChannel between operator and display windows.
   Works from file:// with no server and no internet. */
'use strict';
const AUCTION_MODE=(()=>{try{return localStorage.getItem('bijaycup2026_mode')||'live';}catch(e){return 'live';}})();
const AUCTION_LS_KEY='bijaycup2026_auction_v1'+(AUCTION_MODE==='rehearsal'?'_rehearsal':'');
const AUCTION_BC_NAME='bijaycup2026_live'+(AUCTION_MODE==='rehearsal'?'_rehearsal':'');


const AuctionStore=(()=>{
  let state=null;
  let bc=null; try{bc=new BroadcastChannel(AUCTION_BC_NAME);}catch(e){bc=null;}
  const listeners=new Set();

  const TEAM_DEFS=[
  ['Senior Strikers','senior-strikers'],['Lethal Knights','lethal-knights'],
  ['Maa Hingula 11','maa-hingula-11'],['Onyx Elite','onyx-elite'],
  ['Black Panthers','black-panthers'],['Blackfyre XI','blackfyre-xi'],
  ['Bhaichara','bhaichara'],['Team Karma','team-karma'],
  ['Royal Strikers','royal-strikers'],['Balunga','balunga']
];
  function teamSlug(name){const n=String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'');const d=TEAM_DEFS.find(([nm])=>n===nm.toLowerCase().replace(/[^a-z0-9]+/g,''));return d?d[1]:null;}
  function teamSlugByIdx(i){return (typeof i==='number'&&i>=0&&i<TEAM_DEFS.length)?TEAM_DEFS[i][1]:null;}
  function teamLogoSrc(name,idx){const s2=teamSlug(name)||teamSlugByIdx(idx);return s2?'assets/teams/'+s2+'.jpg':null;}
  /* v7.0 team identity: accent colours auto-derived from each team's actual logo art
     (saturated-tone average, brightness-normalised) + short broadcast abbreviations. */
  const TEAM_ACCENTS={'senior-strikers':'#e6ca7b','lethal-knights':'#e68633','maa-hingula-11':'#e65720','onyx-elite':'#e5b46b','black-panthers':'#e5a45f','blackfyre-xi':'#e64d2b','bhaichara':'#e59346','team-karma':'#e68d35','royal-strikers':'#e60d12','balunga':'#e66e0e'};
  function teamAccent(name,idx){const s2=teamSlug(name)||teamSlugByIdx(idx);return (s2&&TEAM_ACCENTS[s2])||'#e3b736';}
  function teamAbbr(name){const w=String(name||'').trim().split(/\s+/).filter(x=>/[A-Za-z]/.test(x));
    if(w.length>=2)return (w[0][0]+w[1][0]).toUpperCase();
    if(w.length===1)return w[0].replace(/[^A-Za-z]/g,'').slice(0,2).toUpperCase()||'?';
    return '?';}
  function defaultTeams(){return TEAM_DEFS.map(([name])=>({name,purseStart:8000}));}
  function freshState(){
    return {
      v:1, seq:0, renumV:'renum72-continuous',
      settings:{purseStart:8000,timerSecs:10,resetOnBid:true,squadMin:15,squadMax:20,keys:{sold:'s',unsold:'u',timer:'t'}},
      teams:defaultTeams(),
      /* runtime per player no: {status:'pending'|'sold'|'unsold'|'excluded', soldTo:teamIdx, soldPrice} */
      run:{},
      sets:{},            /* persisted Set-1/Set-2 assignments: {playerNo: 1|2} */
      order:PLAYERS.map(p=>p.no).sort((a,b)=>{const pa=PLAYERS.find(x=>x.no===a),pb=PLAYERS.find(x=>x.no===b);return ordK(pa)-ordK(pb)||a-b;}),
      currentIdx:0,
      bid:{amount:0,teamIdx:null},
      timer:{total:10,endsAt:null,running:false,remaining:10},
      /* v7.0 close-out machine (owner, 26 Oct): opening timer visible 10s. With bids,
         8s SILENT after each bid (a new bid restarts it), then a big visible 3-2-1
         with sound, then the gavel. With ZERO bids the 3-2-1 starts straight during the last 3s of
         the opening 10s (owner revision 26 Oct 23:38). The gavel NEVER finalizes anything -
         the admin chooses SOLD or UNSOLD manually ("even for sold", 23:00). */
      countdown:{phase:'idle',endsAt:null},
      layout:'A',squadTeamIdx:null,closing:false,statsView:'stats',spendSort:'spent',squadSort:'number',squadPage:0,soundTest:0,
      overlay:null,           /* {type:'sold'|'unsold', playerNo, teamIdx, price, at} */
      lastBuyIdx:null,
      ticker:'',
      salesHistory:[],
      saleOrder:[],
      adjustments:[],       /* purse adjustments (e.g. release refunds); resetAuction must start clean */
      log:[],
      updatedAt:Date.now()
    };
  }
  /* v5 data cleanup: 15 earlier duplicate submissions were removed; each retired
     serial maps to the surviving registration (same person, latest submission).
     Unambiguous saved records (a sale/set on the retired serial only, or identical
     duplicates) migrate automatically. Conflicts - both serials of a pair having
     different records, or different Set tags - are NEVER silently resolved in the
     live auction: they surface as state.migration.conflicts and the operator picks
     what to keep (auction actions block until resolved). The original saved state
     is preserved under a premigration backup key. In rehearsal mode conflicts
     auto-resolve to the surviving (latest submission) record with a visible notice. */
  const RETIRED_NOS={1:28,2:23,3:24,4:25,5:143,7:53,8:9,11:158,12:48,13:123,15:135,16:68,18:61,19:91,20:45};
  /* v7.3: team slot 6 was renamed Dahi Bara 11 -> Bhaichara. Rename by slot only when the saved name is exactly the old name; custom names, roster, sales and purses are untouched. */
  function migrateTeamRename(s){if(s&&Array.isArray(s.teams)&&s.teams[6]&&String(s.teams[6].name||'').toLowerCase().replace(/[^a-z0-9]+/g,'')==='dahibara11')s.teams[6].name='Bhaichara';}
  function migrateRetired(s){
    if(s.renumV==='renum72-continuous')return;
    const mapNo=no=>RETIRED_NOS[no]||no;
    if(Array.isArray(s.order)){
      const seen=new Set();
      s.order=s.order.map(mapNo).filter(no=>{if(seen.has(no))return false;seen.add(no);return true;});
    }
    if(s.saleOrder)s.saleOrder=s.saleOrder.map(mapNo);
    if(s.overlay&&s.overlay.playerNo!=null)s.overlay.playerNo=mapNo(s.overlay.playerNo);
    const conflicts=[],auto=[];
    const sameRec=(a,b)=>a&&b&&a.status===b.status&&a.soldTo===b.soldTo&&a.soldPrice===b.soldPrice;
    if(s.run)for(const old in RETIRED_NOS){
      const rec=s.run[old];if(!rec)continue;
      const surv=RETIRED_NOS[old];const cur=s.run[surv];
      if(!cur||sameRec(cur,rec)){if(!cur)s.run[surv]=rec;delete s.run[old];}
      else if(AUCTION_MODE==='rehearsal'){auto.push('Kept the latest-submission record for player #'+surv+' (duplicate serial #'+old+' also had one)');delete s.run[old];}
      /* live conflict: keep BOTH records in place; resolution applies the pick */
      else conflicts.push({type:'run',retired:Number(old),survivor:surv,retiredRec:rec,survivorRec:cur});
    }
    if(s.sets)for(const old in RETIRED_NOS){
      if(s.sets[old]==null)continue;
      const surv=RETIRED_NOS[old];
      if(s.sets[surv]==null||s.sets[surv]===s.sets[old]){s.sets[surv]=s.sets[old];delete s.sets[old];}
      else if(AUCTION_MODE==='rehearsal'){auto.push('Kept the latest-submission Set tag for player #'+surv);s.sets[surv]=s.sets[surv];delete s.sets[old];}
      else{conflicts.push({type:'set',retired:Number(old),survivor:surv,retiredSet:s.sets[old],survivorSet:s.sets[surv]});delete s.sets[old];}
    }
    if(conflicts.length)s.migration={pending:true,conflicts};
    if(auto.length)s.migrationNotice=auto;
  }

  /* v7.2: gap-free continuous numbering 1-196 (owner request 26 Oct 23:33, after the
     retired-serial explanation). v7.1-and-earlier saves carry the old serials with dedup
     gaps; every serial-keyed structure is remapped ONCE, stamped via state.renumV.
     Player identity (name/reg), records, prices, purses and Set tags are unchanged. */
  const RENUM_V72={6:1,9:2,10:3,14:4,17:5,21:6,22:7,23:8,24:9,25:10,26:11,27:12,28:13,29:14,30:15,31:16,32:17,33:18,34:19,35:20,36:21,37:22,38:23,39:24,40:25,41:26,42:27,43:28,44:29,45:30,46:31,47:32,48:33,49:34,50:35,51:36,52:37,53:38,54:39,55:40,56:41,57:42,58:43,59:44,60:45,61:46,62:47,63:48,64:49,65:50,66:51,67:52,68:53,69:54,70:55,71:56,72:57,73:58,74:59,75:60,76:61,77:62,78:63,79:64,80:65,81:66,82:67,83:68,84:69,85:70,86:71,87:72,88:73,89:74,90:75,91:76,92:77,93:78,94:79,95:80,96:81,97:82,98:83,99:84,100:85,101:86,102:87,103:88,104:89,105:90,106:91,107:92,108:93,109:94,110:95,111:96,112:97,113:98,114:99,115:100,116:101,117:102,118:103,119:104,120:105,121:106,122:107,123:108,124:109,125:110,126:111,127:112,128:113,129:114,130:115,131:116,132:117,133:118,134:119,135:120,136:121,137:122,138:123,139:124,140:125,141:126,142:127,143:128,144:129,145:130,146:131,147:132,148:133,149:134,150:135,151:136,152:137,153:138,154:139,155:140,156:141,157:142,158:143,159:144,160:145,161:146,162:147,163:148,164:149,165:150,166:151,167:152,168:153,169:154,170:155,171:156,172:157,173:158,174:159,175:160,176:161,177:162,178:163,179:164,180:165,181:166,182:167,183:168,184:169,185:170,186:171,187:172,188:173,189:174,190:175,191:176,192:177,193:178,194:179,195:180,196:181,197:182,198:183,199:184,200:185,201:186,202:187,203:188,204:189,205:190,206:191,207:192,208:193,209:194,210:195,211:196};
  const RENUM_V72_STAMP='renum72-continuous';
  function renumMap72(no){return RENUM_V72[no]!=null?RENUM_V72[no]:no;}
  function renumFields72(st){
    if(Array.isArray(st.order))st.order=st.order.map(renumMap72);
    if(st.saleOrder)st.saleOrder=st.saleOrder.map(renumMap72);
    if(st.run){const r={};for(const k in st.run)r[renumMap72(Number(k))]=st.run[k];st.run=r;}
    if(st.sets){const t={};for(const k in st.sets)t[renumMap72(Number(k))]=st.sets[k];st.sets=t;}
    if(Array.isArray(st.salesHistory))st.salesHistory.forEach(h=>{if(h&&h.no!=null)h.no=renumMap72(h.no);});
    if(st.overlay&&st.overlay.playerNo!=null)st.overlay.playerNo=renumMap72(st.overlay.playerNo);
  }
  function renumberToV72(s){
    if(!s||s.renumV===RENUM_V72_STAMP)return;
    renumFields72(s);
    s.renumV=RENUM_V72_STAMP;
    /* stored snapshots: remap too, so RESTORE / undo can't resurrect old serials */
    try{
      const meta=JSON.parse(localStorage.getItem(SNAP_PREFIX+'idx')||'{"n":0,"items":[]}');
      for(const it of (meta.items||[])){
        try{
          const key=SNAP_PREFIX+(it.slot!=null?it.slot:it.id);
          const raw=localStorage.getItem(key);if(!raw)continue;
          const d=JSON.parse(raw);
          if(d&&d.state&&d.state.renumV!==RENUM_V72_STAMP){
            renumFields72(d.state);d.state.renumV=RENUM_V72_STAMP;
            if(Array.isArray(d.playersets))d.playersets.forEach(ps=>{if(ps&&ps.no!=null)ps.no=renumMap72(ps.no);});
            localStorage.setItem(key,JSON.stringify(d));
          }
        }catch(e){}
      }
    }catch(e){}
  }

  function load(){
    try{const raw=localStorage.getItem(AUCTION_LS_KEY);if(raw){
      try{const bk=AUCTION_LS_KEY+'_premigration_v5';if(!localStorage.getItem(bk))localStorage.setItem(bk,raw);}catch(e){}
      state=JSON.parse(raw);
      /* v6.3: legacy builds used placeholder team names "TEAM 1".."TEAM 10".
         Untouched placeholders adopt the real team names so logos resolve.
         Custom names are kept - teamLogoSrc falls back to the slot logo. */
      if(Array.isArray(state.teams))state.teams.forEach((t,i)=>{if(t&&/^TEAM\s+\d{1,2}$/i.test(String(t.name||'').trim())&&TEAM_DEFS[i])t.name=TEAM_DEFS[i][0];});
      migrateRetired(state);migrateTeamRename(state);
      renumberToV72(state);
      if(state.sets)for(const no in state.sets){const p=player(Number(no));if(p)p.set=state.sets[no];} /* apply AFTER renumber so v7.1 set tags land on the new serials */
      /* v7.4 identity-preserving migration: remember WHO is on screen (by player number) before the queue is filtered, re-sorted or extended, so a build change never moves the live position to a different player. */
      let __curNo0=null,__migNotes=[];
      if(Array.isArray(state.order)&&state.currentIdx!=null&&state.currentIdx>=0&&state.currentIdx<state.order.length)__curNo0=state.order[state.currentIdx];
      if(Array.isArray(state.order)){const __gone=state.order.filter(no=>!player(no));state.order=state.order.filter(no=>player(no));if(!state.order.length)state.order=PLAYERS.map(p=>p.no);
        if(__curNo0!=null&&!player(__curNo0)){__migNotes.push('The player that was on screen (#'+__curNo0+') is not in this build. The queue moved to the first pending player.');__curNo0=null;state.currentIdx=0;}
        else if(__curNo0!=null){state.currentIdx=state.order.indexOf(__curNo0);}
        if(__gone.length)__migNotes.push('Removed '+__gone.length+' queue slot(s) that are not players in this build: '+__gone.slice(0,10).join(', ')+(__gone.length>10?' ...':''));}
      /* v6.4: keep the auction queue in ascending player-number order. Retired-serial
         migration remaps numbers in place, which left queues like 28,23,24,25,143,6,53,9.
         Sorting is display/order only - every player keeps their number and saved record.
         currentIdx is remapped so the SAME player stays current after the sort. */
      if(Array.isArray(state.order)){
        const curNo=(state.currentIdx!=null&&state.currentIdx>=0&&state.currentIdx<state.order.length)?state.order[state.currentIdx]:null;
        /* players added after the save was written join the queue too */
        for(const p of PLAYERS)if(!state.order.includes(p.no))state.order.push(p.no);
        state.order=[...state.order].sort((a,b)=>{const pa=player(a),pb=player(b);return ordK(pa)-ordK(pb)||a-b;}); /* Set 1 list order first (owner 28 Oct), then ascending */
        if(curNo!=null){const ni=state.order.indexOf(curNo);state.currentIdx=ni>=0?ni:0;}
      }
      if(!Array.isArray(state.salesHistory))state.salesHistory=[];
      /* v7.0: Set 1/2 tags are provisional until the owner's 29 Oct list (his word:
         "set 1/2 is pending for all"). The shipped list carries a stamp; a saved
         auction from before that list adopts the shipped tags wholesale. Sales,
         purses and player records are untouched - only Set tags refresh. */
      if(typeof SETS_VERSION!=='undefined'&&state.setsV!==SETS_VERSION){
        if(state.setsV===undefined){
          /* Legacy save from a build before stamping: adopt the stamp but KEEP the save's own set tags untouched - nothing is silently overwritten on upgrade to v7.0. */
          state.setsV=SETS_VERSION;
        }else{
          /* This build ships a NEWER authoritative list (e.g. the owner's 29 Oct final list): adopt it wholesale from the pristine shipped snapshot, replacing any conflicting saved in-app tags. Sales, purses, statuses and playerIDs are never touched. */
          state.sets={};
          for(const ps of SHIPPED_SETS)if(ps.set===1||ps.set===2)state.sets[ps.no]=ps.set;
          for(const pl of PLAYERS)pl.set=state.sets[pl.no]||null;
          state.setsV=SETS_VERSION;
        }
      }
      if(!state.settings)state.settings={};
      if(!state.settings.keys)state.settings.keys={sold:'s',unsold:'u',timer:'t'};
      if(!state.countdown)state.countdown={phase:'idle',endsAt:null};
      if(!state.statsView)state.statsView='stats';if(!state.spendSort)state.spendSort='spent';if(!state.squadSort)state.squadSort='number';if(typeof state.squadPage!=='number')state.squadPage=0;if(typeof state.soundTest!=='number')state.soundTest=0;
      if(state.currentIdx>=state.order.length)state.currentIdx=0;
      for(const no in state.run||{}){if(!player(Number(no))&&!RETIRED_NOS[no]){const r=state.run[no];
        if(r&&(r.status==='sold'||r.soldPrice)){__migNotes.push('KEPT a recorded sale for #'+no+' (price '+r.soldPrice+', team '+(r.soldTo!=null?r.soldTo+1:'?')+') although this build has no such player. Purses still count it. Check this one before the auction.');}
        else delete state.run[no];}}
      if(__migNotes.length){state.migrationNotice=(state.migrationNotice||[]).concat(__migNotes);}
      /* after the final queue sort: make sure the same player is still current */
      if(__curNo0!=null&&Array.isArray(state.order)){const __i=state.order.indexOf(__curNo0);if(__i>=0)state.currentIdx=__i;}
      return;}}catch(e){}
    state=freshState();save();
  }
  function save(){state.updatedAt=Date.now();try{localStorage.setItem(AUCTION_LS_KEY,JSON.stringify(state));}catch(e){}}
  function broadcast(){if(bc)try{bc.postMessage({t:'state'});}catch(e){}}
  function commit(mut){mut(state);state.seq++;save();broadcast();emit();}
  /* v7.3 photo switch: each player keeps BOTH the portrait (photoJ) and the original form upload (orig).
     state.photoMode[no]==='orig' shows the original on screen; default is the portrait. Identity, IDs, sales and purses are never touched. */
  function applyPhotos(){try{PLAYERS.forEach(p=>{if(p.photoJ===undefined)p.photoJ=p.photo||null;p.photo=(state&&state.photoMode&&state.photoMode[p.no]==='orig'&&p.orig)?p.orig:p.photoJ;});}catch(e){}}
  function emit(){applyPhotos();listeners.forEach(fn=>{try{fn(state);}catch(e){}});}
  function onChange(fn){listeners.add(fn);}
  if(bc)bc.onmessage=()=>{load();emit();};
  addEventListener('storage',e=>{if(e.key===AUCTION_LS_KEY){load();emit();}});

  /* ---- derived ---- */
  function player(no){return PLAYERS.find(p=>p.no===no);}
  function runOf(no){return state.run[no]||{status:'pending'};}
  /* queue key: Set 1 list slots first, then Set 2 in the owner's 31 Oct half-group order, then anyone else */
  function ordK(p){return !p?99999:p.s1slot?p.s1slot:p.s2slot?1000+p.s2slot:99999;}
  function silentMs(p){return p&&Number(p.set)===2?6000:8000;} /* silent wait after a bid: 8s Set 1, 6s Set 2 */
  function currentPlayer(){const no=state.order[state.currentIdx];return no!=null?player(no):null;}
  function nextPendingIdx(from){for(let i=from;i<state.order.length;i++){if(runOf(state.order[i]).status==='pending')return i;}return -1;}
  function teamPurse(i){
    let p=state.teams[i].purseStart;
    for(const no in state.run){const r=state.run[no];if((r.status==='sold'||r.status==='released')&&r.soldTo===i)p-=r.soldPrice;}
    for(const adj of (state.adjustments||[]))if(adj.teamIdx===i)p+=adj.points;
    return p;
  }
  function teamSquad(i){return Object.keys(state.run).filter(no=>state.run[no].status==='sold'&&state.run[no].soldTo===i).length;}
  function minBidFor(p){return p.set===1?100:50;}
  function migBlocked(){return !!(state.migration&&state.migration.pending);}
  function incrementFor(p,amount){if(p&&p.set===1)return 100; /* owner 31 Oct: Set 1 bids rise by 100 only */ return amount>=500?100:50;}
  function counts(){let s=0,u=0,e=0;for(const no in state.run){const st=state.run[no].status;if(st==='sold')s++;else if(st==='unsold')u++;else if(st==='excluded'||st==='released')e++;}return{sold:s,unsold:u,excluded:e,left:PLAYERS.filter(p=>!p.ph).length-s-u-e};}

  /* ===== v7.3 helpers: leadership, role groups, coming up, stats, squad pages, advisory ===== */
  const ROLE_ORDER=['Batsman','Wicketkeeper','All-rounder','Bowler'];
  const ROLE_LABEL={'Batsman':'BATSMEN','Wicketkeeper':'WICKETKEEPERS','All-rounder':'ALL-ROUNDERS','Bowler':'BOWLERS'};
  function roleRank(r){const i=ROLE_ORDER.indexOf(r);return i<0?ROLE_ORDER.length:i;}
  function roleLabel(r){return ROLE_LABEL[r]||String(r||'OTHER').toUpperCase();}
  function leadFor(i){
    try{
      const sl=teamSlug(state.teams[i].name)||teamSlugByIdx(i);
      const L=(typeof LEADERSHIP!=='undefined'&&sl)?LEADERSHIP[sl]:null;
      if(!L)return null;
      const out=[];
      for(const [k,lab] of [['owner','OWNER'],['captain','CAPTAIN'],['vice','VICE-CAPTAIN']]){
        const m=L[k];if(m&&m.name)out.push({role:lab,name:String(m.name),photo:m.photo||null});
      }
      return out.length?out:null;
    }catch(e){return null;}
  }
  function upNextList(n){
    n=n||3;const out=[];
    const cur=currentPlayer();
    let from=state.currentIdx+1;
    if(cur&&runOf(cur.no).status==='pending')from=state.currentIdx;
    for(let i=from;i<state.order.length&&out.length<n;i++){
      const no=state.order[i];
      if(runOf(no).status==='pending'){const p=player(no);if(p)out.push({no:p.no,q:p.q||null,name:p.name,role:p.role,photo:p.photo||null,set:p.set||null,minBid:p.set?minBidFor(p):null,batting:p.batting||'',bowling:p.bowling||'',city:p.city||''});}
    }
    return out;
  }
  function teamBuys(i){
    return Object.keys(state.run).map(Number).filter(no=>state.run[no].status==='sold'&&state.run[no].soldTo===i).map(no=>{
      const p=player(no)||{};return{no,q:p.q||null,name:p.name||('#'+no),role:p.role||'',photo:p.photo||null,price:state.run[no].soldPrice};});
  }
  /* role-grouped, sorted, paginated squad pages for projector reading */
  const SQ_ROW_PX=236,SQ_HEAD_PX=26,SQ_AVAIL_PX=580,SQ_LEAD_PX=132;
  function squadPages(i){
    const buys=teamBuys(i);
    const bySort=(a,b)=>state.squadSort==='price'?(b.price-a.price||a.no-b.no):(a.no-b.no);
    const groups=[];
    for(const r of [...new Set(buys.map(b=>b.role))].sort((a,b)=>roleRank(a)-roleRank(b)||String(a).localeCompare(String(b)))){
      groups.push({role:r,items:buys.filter(b=>b.role===r).sort(bySort)});
    }
    const lead=leadFor(i);
    const pages=[[]];let used=0;let avail=SQ_AVAIL_PX-(lead?SQ_LEAD_PX:0);
    for(const g of groups){
      for(let k=0;k<g.items.length;k+=4){
        const cards=g.items.slice(k,k+4);
        const head=(k===0)?SQ_HEAD_PX:0;
        const hdr=(k===0);
        const need=SQ_ROW_PX+head;
        let pg=pages[pages.length-1];
        if(used+need>avail&&pg.length){pages.push([]);pg=pages[pages.length-1];used=0;avail=SQ_AVAIL_PX;}
        let headText=null,cont=false;
        if(hdr)headText=roleLabel(g.role);
        else if(!pg.length){headText=roleLabel(g.role);cont=true;}
        const extra=(!hdr&&headText)?SQ_HEAD_PX:0;
        pg.push({head:headText,cont,count:g.items.length,cards});
        used+=need+extra;
      }
    }
    return pages;
  }
  function statsData(){
    const sales=Object.keys(state.run).map(Number).filter(no=>state.run[no].status==='sold').map(no=>{
      const p=player(no)||{};const r=state.run[no];
      return{no,name:p.name||('#'+no),role:p.role||'-',set:p.set||null,photo:p.photo||null,teamIdx:r.soldTo,price:r.soldPrice};});
    const order=(state.saleOrder||[]);
    const rank=no=>{const k=order.indexOf(no);return k<0?-1:k;};
    const total=sales.reduce((a,b)=>a+b.price,0);
    const c=counts();
    let hi=null,lo=null;
    for(const x of sales){if(!hi||x.price>hi.price||(x.price===hi.price&&rank(x.no)<rank(hi.no)))hi=x;if(!lo||x.price<lo.price||(x.price===lo.price&&rank(x.no)<rank(lo.no)))lo=x;}
    const tiesHi=hi?sales.filter(x=>x.price===hi.price).length:0;
    const tiesLo=lo?sales.filter(x=>x.price===lo.price).length:0;
    const roles={};
    for(const x of sales){const r=roles[x.role]||(roles[x.role]={role:x.role,sold:0,sum:0});r.sold++;r.sum+=x.price;}
    const byRole=Object.values(roles).sort((a,b)=>roleRank(a.role)-roleRank(b.role)).map(r=>({...r,avg:r.sold?Math.round(r.sum/r.sold):0}));
    const tagged=PLAYERS.filter(p=>p.set===1||p.set===2).length;
    const setRow=k=>{const l=sales.filter(x=>x.set===k);const sum=l.reduce((a,b)=>a+b.price,0);return{set:k,sold:l.length,sum,avg:l.length?Math.round(sum/l.length):0};};
    const untaggedSold=sales.filter(x=>!x.set).length;
    const teams=state.teams.map((t,i)=>{
      const mine=sales.filter(x=>x.teamIdx===i);const spent=mine.reduce((a,b)=>a+b.price,0);
      return{i,name:t.name,squad:mine.length,spent,avg:mine.length?Math.round(spent/mine.length):null,purse:teamPurse(i)};});
    return{sold:c.sold,unsold:c.unsold,excluded:c.excluded,left:c.left,total:PLAYERS.filter(p=>!p.ph).length,
      totalSpent:total,avg:sales.length?Math.round(total/sales.length):0,
      highest:hi,tiesHi,lowest:lo,tiesLo,byRole,tagged,untaggedSold,sets:[setRow(1),setRow(2)],teams};
  }
  /* break slideshow data: actual results only, nothing invented */
  function breakData(){
    const order=(state.saleOrder||[]);
    const rank=no=>{const k=order.indexOf(no);return k<0?-1:k;};
    const sales=Object.keys(state.run).map(Number).filter(no=>state.run[no].status==='sold').map(no=>{
      const p=player(no)||{};const r=state.run[no];
      return{no,name:p.name||('#'+no),role:p.role||'-',photo:p.photo||null,teamIdx:r.soldTo,price:r.soldPrice};});
    const better=(a,b)=>!b||a.price>b.price||(a.price===b.price&&rank(a.no)<rank(b.no));
    const roles=[...new Set(sales.map(x=>x.role))].sort((a,b)=>roleRank(a)-roleRank(b)||String(a).localeCompare(String(b)));
    const topByRole=roles.map(r=>{let h=null;let n=0;for(const x of sales.filter(y=>y.role===r)){n++;if(better(x,h))h=x;}return{role:r,label:roleLabel(r),count:n,top:h,tied:sales.filter(y=>y.role===r&&y.price===h.price).length};});
    const top=sales.slice().sort((a,b)=>b.price-a.price||rank(a.no)-rank(b.no)).slice(0,5);
    const teams=state.teams.map((t,i)=>{
      const mine=sales.filter(x=>x.teamIdx===i);const spent=mine.reduce((a,b)=>a+b.price,0);
      let hi=null;for(const x of mine){if(better(x,hi))hi=x;}
      const groups=[...new Set(mine.map(x=>x.role))].sort((a,b)=>roleRank(a)-roleRank(b)||String(a).localeCompare(String(b))).map(r=>({role:r,label:roleLabel(r),names:mine.filter(x=>x.role===r).sort((a,b)=>b.price-a.price||a.no-b.no).map(x=>({name:x.name,price:x.price}))}));
      return{i,name:t.name,purse:teamPurse(i),squad:mine.length,spent,avg:mine.length?Math.round(spent/mine.length):null,top:hi,groups};});
    const c=counts();
    return{sold:sales.length,left:c.left,unsold:c.unsold,topByRole,top,teams,spendRows:sortedTeams('spent')};
  }
  function sortedTeams(key){
    const t=statsData().teams.slice();
    const val=x=>key==='avg'?(x.avg==null?-1:x.avg):key==='purse'?x.purse:x.spent;
    return t.sort((a,b)=>val(b)-val(a)||a.i-b.i);
  }
  /* admin-only advisory: could this bid leave the team unable to reach the squad minimum? */
  function squadAdvisory(teamIdx,amount){
    const min=state.settings.squadMin,max=state.settings.squadMax;
    const cur=currentPlayer();
    const squadNow=teamSquad(teamIdx),squadAfter=squadNow+1;
    const purseAfter=teamPurse(teamIdx)-amount;
    const need=Math.max(0,min-squadAfter);
    const pool=[];let unsold=0;
    for(const no of state.order){
      if(cur&&no===cur.no)continue;
      const st=runOf(no).status;
      if(st==='pending'||st==='unsold'){
        const p=player(no);if(!p)continue;
        if(st==='unsold')unsold++;
        pool.push(p.set===1?100:50); /* lowest possible base: untagged counted at 50 */
      }
    }
    pool.sort((a,b)=>a-b);
    const cheapest=pool.slice(0,need).reduce((a,b)=>a+b,0);
    const sold=Object.keys(state.run).filter(no=>state.run[no].status==='sold').map(no=>state.run[no].soldPrice);
    const avgSale=sold.length?Math.round(sold.reduce((a,b)=>a+b,0)/sold.length):0;
    let level='ok',msg='';
    if(squadAfter>max)level='full';
    if(need>0){
      if(pool.length<need){level='red';msg='Only '+pool.length+' players are left in the pool but '+need+' more are needed.';}
      else if(purseAfter<cheapest){level='red';msg='Cannot reach '+min+' players: '+fmtN(purseAfter)+' pts left, and the '+need+' cheapest remaining base prices total '+fmtN(cheapest)+'.';}
      else if(avgSale>0&&purseAfter<need*avgSale){level='amber';msg='Tight: '+fmtN(purseAfter)+' pts for '+need+' more players is under the average sale so far ('+fmtN(avgSale)+' each).';}
      else msg='Still possible: '+fmtN(purseAfter)+' pts for '+need+' more players (cheapest possible total '+fmtN(cheapest)+').';
    }else msg='Squad minimum '+min+' is met after this player.';
    return{level,msg,need,squadAfter,purseAfter,cheapest,poolCount:pool.length,unsoldInPool:unsold,avgSale,min};
  }
  function fmtN(n){return Number(n||0).toLocaleString('en-IN');}
  function view(){
    applyPhotos();const p=currentPlayer();
    return {
      layout:state.layout,overlay:state.overlay,entrance:(state.entrance&&state.teams[state.entrance.teamIdx]?{teamIdx:state.entrance.teamIdx,at:state.entrance.at,hold:!!state.entrance.hold,name:state.teams[state.entrance.teamIdx].name,lead:leadFor(state.entrance.teamIdx)}:null),seq:state.seq,closing:!!state.closing,
      currentPlayer:p?{...p,minBid:(p.set?minBidFor(p):null),photoMode:((state.photoMode&&state.photoMode[p.no])==='orig'&&p.orig)?'orig':'jersey'}:null,
      nextPlayer:(()=>{const ni=nextPendingIdx(state.currentIdx+1);return ni>=0?player(state.order[ni]):null;})(),
      bid:state.bid,timer:timerView(),countdown:countdownView(),lastBuyIdx:state.lastBuyIdx,ticker:state.ticker,counts:counts(),
      salesHistory:(state.salesHistory||[]).slice(-5).reverse().map(h=>({no:h.no,price:h.price,at:h.at,
        teamName:state.teams[h.teamIdx]?state.teams[h.teamIdx].name:'?',
        teamIdx:h.teamIdx,
        playerName:(player(h.no)||{}).name||('#'+h.no)})),
      squadTeamIdx:state.squadTeamIdx,
      squadSort:state.squadSort,squadPage:state.squadPage,soundTest:state.soundTest,statsView:state.statsView,spendSort:state.spendSort,
      upNext:(state.layout==='N'?upNextList(3):null),
      stats:(state.layout==='T'?statsData():null),
      brk:((state.layout==='X'||state.layout==='W')?breakData():null),
      spendRows:(state.layout==='T'?sortedTeams(state.spendSort):null),
      squadPageData:(state.layout==='S'&&state.squadTeamIdx!=null?(()=>{const pg=squadPages(state.squadTeamIdx);const k=Math.min(state.squadPage||0,pg.length-1);return{rows:pg[k],page:k,total:pg.length,lead:(k===0?leadFor(state.squadTeamIdx):null),count:teamBuys(state.squadTeamIdx).length};})():null),
      squadPlayers:(state.squadTeamIdx!=null?Object.keys(state.run).map(Number).filter(no=>state.run[no].status==='sold'&&state.run[no].soldTo===state.squadTeamIdx).map(no=>{const p=player(no);return{no,name:p?p.name:'?',photo:p?p.photo:null,price:state.run[no].soldPrice};}):[]),
      overlay:state.overlay&&state.overlay.playerNo?{...state.overlay,playerName:(player(state.overlay.playerNo)||{}).name}:state.overlay,
      teams:state.teams.map((t,i)=>({name:t.name,purse:teamPurse(i),squad:teamSquad(i),squadMax:state.settings.squadMax,squadMin:state.settings.squadMin}))
    };
  }
  function timerView(){
    const t=state.timer;let secs=t.remaining;
    if(t.running&&t.endsAt)secs=Math.max(0,Math.ceil((t.endsAt-Date.now())/1000));
    return{secs,total:t.total,running:t.running};
  }
  function countdownView(){
    const cd=state.countdown||{phase:'idle'};
    let secs=null;
    if(cd.endsAt)secs=Math.max(0,Math.ceil((cd.endsAt-Date.now())/1000));
    return{phase:cd.phase,secs};
  }

  /* v7.0 recovery: automatic rolling snapshots after every confirmed transaction.
     Kept OUTSIDE the live state key so the operator<->display sync stays lean. */
  const SNAP_PREFIX=AUCTION_LS_KEY+'_snap_';
  function snapshotState(label){
    try{
      const meta=JSON.parse(localStorage.getItem(SNAP_PREFIX+'idx')||'{"n":0,"items":[]}');
      const slot=meta.n%5;
      const payload=JSON.stringify({state,playersets:PLAYERS.map(p=>({no:p.no,set:p.set}))});
      localStorage.setItem(SNAP_PREFIX+slot,payload);
      meta.n++;meta.items.push({at:Date.now(),label:String(label||'snapshot').slice(0,80),slot});
      while(meta.items.length>5)meta.items.shift();
      localStorage.setItem(SNAP_PREFIX+'idx',JSON.stringify(meta));
    }catch(e){}
  }
  function listSnapshots(){try{return (JSON.parse(localStorage.getItem(SNAP_PREFIX+'idx')||'{"items":[]}').items||[]).slice().reverse();}catch(e){return[];}}
  function restoreSnapshot(slot){const raw=localStorage.getItem(SNAP_PREFIX+slot);if(!raw)return{ok:false};actions.importJSON(raw);return{ok:true};}

  /* ---- operator actions ---- */
  function addLog(text,kind){state.log.unshift({at:Date.now(),text,kind:kind||''});if(state.log.length>5000)state.log.length=5000;}
  const actions={
    selectPlayer(no){
      commit(s=>{const i=s.order.indexOf(no);if(i>=0){s.currentIdx=i;const p=player(no);
        s.bid={amount:0,teamIdx:null};s.timer={total:s.settings.timerSecs,endsAt:Date.now()+s.settings.timerSecs*1000,running:true,remaining:s.settings.timerSecs};
        s.countdown={phase:'idle',endsAt:null};
        s.overlay=null;}});
    },
    nextPlayer(){commit(s=>{const ni=nextPendingIdx(s.currentIdx+1);if(ni>=0){s.currentIdx=ni;
      s.bid={amount:0,teamIdx:null};s.timer={total:s.settings.timerSecs,endsAt:Date.now()+s.settings.timerSecs*1000,running:true,remaining:s.settings.timerSecs};s.countdown={phase:'idle',endsAt:null};s.overlay=null;}});},
    prevPlayer(){commit(s=>{for(let i=s.currentIdx-1;i>=0;i--){if(runOf(s.order[i]).status==='pending'){s.currentIdx=i;break;}}
      s.bid={amount:0,teamIdx:null};s.timer={total:s.settings.timerSecs,endsAt:Date.now()+s.settings.timerSecs*1000,running:true,remaining:s.settings.timerSecs};s.countdown={phase:'idle',endsAt:null};s.overlay=null;});},
    placeBid(teamIdx,amount,opts){
      if(migBlocked())return{ok:false,err:'Resolve the data-cleanup conflict first'};
      const p=currentPlayer();if(!p)return{ok:false,err:'no player'};
      const pst=runOf(p.no).status;if(pst!=='pending')return{ok:false,err:'player already '+pst+' - go to NEXT'};
      if(p.hold)return{ok:false,err:'bidding blocked: '+p.hold};
      if(p.set==null)return{ok:false,err:'assign Set 1 or 2 first (tap the SET tag)'};
      const amt=Math.round(Number(amount));
      if(!amt||amt<=0)return{ok:false,err:'bad amount'};
      let err=null;
      commit(s=>{
        const min=minBidFor(p);
        if(amt<min){err='below min bid '+min;return;}
        const stepOk=(p.set===1?((amt-min)%100===0):(amt<500?((amt-min)%50===0):((amt-500)%100===0)));
        if(p.set===1&&!(opts&&opts.correction)){const exp=(s.bid&&s.bid.amount>0)?s.bid.amount+100:min;if(amt!==exp){err='Set 1: next bid must be exactly '+exp.toLocaleString('en-IN')+' (+100 each time)';return;}}
        if(!stepOk){err=(p.set===1?'invalid increment (Set 1 rises by 100 only)':'invalid increment (x50 to 500, x100 beyond)');return;}
        if(teamPurse(teamIdx)<amt){err='purse too low';return;}
        if(teamSquad(teamIdx)>=s.settings.squadMax){err='squad full';return;}
        /* bid trail for UNDO LAST BID: only valid while its top entry equals the live bid */
        {const tr=s.bidTrail,pb=s.bid||{amount:0,teamIdx:null};
         let list=(tr&&tr.no===p.no&&Array.isArray(tr.list))?tr.list.slice():[];
         const top=list[list.length-1];
         if(pb.amount>0){if(!top||top.amount!==pb.amount||top.teamIdx!==pb.teamIdx)list=[{amount:pb.amount,teamIdx:pb.teamIdx}];}
         else list=[];
         list.push({amount:amt,teamIdx});if(list.length>200)list.shift();
         s.bidTrail={no:p.no,list};}
        s.bid={amount:amt,teamIdx};
        if(s.timer.running){s.timer.running=false;s.timer.endsAt=null;s.timer.remaining=s.timer.total;} /* visible timer disappears on first bid */
        s.countdown={phase:'silent8',endsAt:Date.now()+silentMs(p)}; /* 8 silent seconds after every bid (6 for Set 2, owner 31 Oct); gavel never finalizes */
        addLog((s.teams[teamIdx].name)+' bid '+amt.toLocaleString('en-IN')+' on '+p.name,'gold');
      });
      return err?{ok:false,err}:{ok:true};
    },
    undoLastBid(){ /* reverses only the most recent BID on the player on screen; never touches sales, purses or other players */
      if(migBlocked())return{ok:false,err:'Resolve the data-cleanup conflict first'};
      const p=currentPlayer();if(!p)return{ok:false,err:'no player'};
      if(runOf(p.no).status!=='pending')return{ok:false,err:'player already '+runOf(p.no).status+' - use UNDO LAST SALE'};
      let err=null;
      commit(s=>{
        const tr=s.bidTrail,b=s.bid||{amount:0,teamIdx:null};
        if(!b.amount){err='no bid to undo';return;}
        if(!tr||tr.no!==p.no||!tr.list||!tr.list.length){err='no recorded bid to undo (use STEP or CLEAR BID)';return;}
        const top=tr.list[tr.list.length-1];
        if(top.amount!==b.amount||top.teamIdx!==b.teamIdx){err='no recorded bid to undo (use STEP or CLEAR BID)';return;}
        const list=tr.list.slice(0,-1);const prev=list[list.length-1];
        const tn=s.teams[b.teamIdx]?s.teams[b.teamIdx].name:'?';
        s.bidTrail={no:p.no,list};
        if(prev){s.bid={amount:prev.amount,teamIdx:prev.teamIdx};s.countdown={phase:'silent8',endsAt:Date.now()+silentMs(p)};
          addLog('UNDO BID: '+tn+' '+b.amount.toLocaleString('en-IN')+' removed on '+p.name+'; bid back to '+(s.teams[prev.teamIdx]?s.teams[prev.teamIdx].name:'?')+' '+prev.amount.toLocaleString('en-IN'),'warn');}
        else{s.bid={amount:0,teamIdx:null};s.timer={total:s.settings.timerSecs,endsAt:Date.now()+s.settings.timerSecs*1000,running:true,remaining:s.settings.timerSecs};s.countdown={phase:'idle',endsAt:null};
          addLog('UNDO BID: '+tn+' '+b.amount.toLocaleString('en-IN')+' removed on '+p.name+'; no bid now','warn');}
      });
      return err?{ok:false,err}:{ok:true};
    },
    clearBid(){commit(s=>{s.bid={amount:0,teamIdx:null};});},
    setLayout(l){commit(s=>{s.layout=['A','B','W','X','S','C','N','T'].includes(l)?l:'A';s.closing=false;s.squadPage=0;});},
    showStats(v){commit(s=>{s.layout='T';s.statsView=(v==='spend'?'spend':'stats');s.closing=false;});},
    setSpendSort(k){commit(s=>{s.spendSort=['spent','avg','purse'].includes(k)?k:'spent';});},
    setSquadSort(k){commit(s=>{s.squadSort=(k==='price'?'price':'number');s.squadPage=0;});},
    squadPageStep(d){commit(s=>{if(s.layout!=='S'||s.squadTeamIdx==null)return;const n=squadPages(s.squadTeamIdx).length;s.squadPage=Math.max(0,Math.min(n-1,(s.squadPage||0)+d));});},
    soundTest(){commit(s=>{s.soundTest=Date.now();});},
    closingNext(){commit(s=>{
      if(s.layout==='S'&&s.closing&&s.squadTeamIdx!=null&&(s.squadPage||0)<squadPages(s.squadTeamIdx).length-1){s.squadPage=(s.squadPage||0)+1;addLog('Closing presentation: '+s.teams[s.squadTeamIdx].name+' page '+(s.squadPage+1),'info');return;}
      s.squadPage=0;
      if(s.layout==='C'){s.layout='S';s.squadTeamIdx=0;s.closing=true;}
      else if(s.layout==='S'&&s.squadTeamIdx!=null&&s.squadTeamIdx<9){s.squadTeamIdx++;s.closing=true;}
      else if(s.layout==='S'&&s.squadTeamIdx===9){s.layout='C';s.closing=true;}
      else{s.layout='C';s.closing=true;}
      addLog('Closing presentation: '+(s.layout==='C'?'title card':s.teams[s.squadTeamIdx].name),'info');
    });},
    markSold(){
      if(migBlocked())return{ok:false,err:'Resolve the data-cleanup conflict first'};
      const p=currentPlayer();if(!p)return{ok:false};
      if(runOf(p.no).status!=='pending')return{ok:false,err:'player already '+runOf(p.no).status};
      if(!state.bid.amount||state.bid.teamIdx==null)return{ok:false,err:'no bid'};
      const b={...state.bid};
      commit(s=>{ /* transaction first, animation after */
        const prevMax=Object.keys(s.run).reduce((m,k)=>{const r=s.run[k];return r.status==='sold'?Math.max(m,r.soldPrice||0):m;},0);
        s.timer.running=false;s.timer.endsAt=null;s.timer.remaining=s.timer.total;
        s.countdown={phase:'idle',endsAt:null};
        s.run[p.no]={status:'sold',soldTo:b.teamIdx,soldPrice:b.amount};
        s.lastBuyIdx=b.teamIdx;
        s.saleOrder=(s.saleOrder||[]).filter(no=>no!==p.no);s.saleOrder.push(p.no);
        const isRecord=b.amount>prevMax&&prevMax>0;
        const squadNow=teamSquad(b.teamIdx);
        s.salesHistory=(s.salesHistory||[]);s.salesHistory.push({no:p.no,teamIdx:b.teamIdx,price:b.amount,at:Date.now()});
        if(s.salesHistory.length>10)s.salesHistory=s.salesHistory.slice(-10);
        s.ticker=s.teams[b.teamIdx].name+' signed '+p.name+' for '+b.amount.toLocaleString('en-IN')+' pts';
        addLog(s.teams[b.teamIdx].name+' signed '+p.name+' for '+b.amount.toLocaleString('en-IN')+' pts','gold');
        if(isRecord)addLog('NEW AUCTION RECORD: '+p.name+' at '+b.amount.toLocaleString('en-IN')+' pts (was '+prevMax.toLocaleString('en-IN')+')','gold');
        if(squadNow>=s.settings.squadMax)addLog(s.teams[b.teamIdx].name+' squad complete ('+squadNow+'/'+s.settings.squadMax+')','gold');
        s.overlay={type:'sold',playerNo:p.no,teamIdx:b.teamIdx,price:b.amount,at:Date.now(),
          record:isRecord,prevBest:isRecord?prevMax:null,squadComplete:squadNow>=s.settings.squadMax};
        s.bid={amount:0,teamIdx:null};
      });
      snapshotState('SOLD: '+p.name);
      return{ok:true};
    },
    markUnsold(){
      if(migBlocked())return{ok:false,err:'Resolve the data-cleanup conflict first'};
      const p=currentPlayer();if(!p)return{ok:false};
      if(runOf(p.no).status!=='pending')return{ok:false,err:'player already '+runOf(p.no).status};
      commit(s=>{
        s.timer.running=false;s.timer.endsAt=null;s.timer.remaining=s.timer.total;
        s.countdown={phase:'idle',endsAt:null};
        s.run[p.no]={status:'unsold'};
        s.unsoldOrder=(s.unsoldOrder||[]).filter(n=>n!==p.no);s.unsoldOrder.push(p.no);
        addLog(p.name+' unsold - to pool','');
        s.overlay={type:'unsold',playerNo:p.no,at:Date.now()};
        s.bid={amount:0,teamIdx:null};
      });
      snapshotState('UNSOLD: '+p.name);
      return{ok:true};
    },
    undoLastUnsold(){
      if(migBlocked())return{ok:false,err:'Resolve the data-cleanup conflict first'};
      let done=false,nm='';
      commit(s=>{
        const uns=Object.keys(s.run).map(Number).filter(no=>s.run[no]&&s.run[no].status==='unsold');
        if(!uns.length)return;
        const rec=(s.unsoldOrder||[]).filter(no=>s.run[no]&&s.run[no].status==='unsold');
        const last=rec.length?rec[rec.length-1]:uns.sort((x,y)=>s.order.indexOf(x)-s.order.indexOf(y)).pop();
        const p=player(last);nm=p?p.name:('#'+last);
        delete s.run[last];
        s.unsoldOrder=rec.filter(no=>no!==last);
        const i=s.order.indexOf(last);if(i>=0)s.currentIdx=i;
        s.bid={amount:0,teamIdx:null};s.overlay=null;
        s.timer={total:s.settings.timerSecs,endsAt:null,running:false,remaining:s.settings.timerSecs};
        s.countdown={phase:'idle',endsAt:null};
        addLog('UNDO: '+nm+' unsold reversed - back on the block','warn');
        done=true;
      });
      if(done)snapshotState('UNDO unsold');
      return{ok:done,name:nm};
    },
    skipOverlay(){commit(s=>{s.overlay=null;});},
    entranceStart(i,hold){commit(s=>{if(i>=0&&i<s.teams.length)s.entrance={teamIdx:i,at:Date.now(),hold:!!hold};});},
    entranceSkip(){commit(s=>{s.entrance=null;});},
    undoLastSale(){
      if(migBlocked())return{ok:false,err:'Resolve the data-cleanup conflict first'};
      let done=false;
      commit(s=>{
        const sold=Object.keys(s.run).map(Number).filter(no=>s.run[no].status==='sold');
        if(!sold.length)return;
        /* undo the most recent by log order: keep sale order array */
        const recorded=(s.saleOrder||[]).filter(no=>s.run[no]&&s.run[no].status==='sold');
        const history=(s.salesHistory||[]).map(h=>h.no).filter(no=>s.run[no]&&s.run[no].status==='sold');
        const last=recorded.length?recorded[recorded.length-1]:(history.length?history[history.length-1]:sold[sold.length-1]);
        const r=s.run[last];const p=player(last);
        delete s.run[last];
        s.saleOrder=recorded.filter(no=>no!==last);
        s.lastBuyIdx=null;
        if(p){addLog('UNDO: '+p.name+' sale reversed ('+s.teams[r.soldTo].name+' '+r.soldPrice+')','warn');
          s.run[p.no]={status:'pending'};delete s.run[p.no];
          if(Array.isArray(s.salesHistory)){for(let i=s.salesHistory.length-1;i>=0;i--){if(s.salesHistory[i].no===p.no){s.salesHistory.splice(i,1);break;}}}
          const i=s.order.indexOf(p.no);if(i>=0)s.currentIdx=i;
          s.bid={amount:0,teamIdx:null};s.overlay=null;}
        done=true;
      });
      if(done)snapshotState('UNDO sale');
      return{ok:done};
    },
    showSquadOnLED(i){commit(s=>{s.layout='S';s.squadTeamIdx=i;s.squadPage=0;s.closing=false;});},
    resolveMigration(picks){ /* operator's per-conflict choice: 'survivor' (latest submission) or 'retired' (earlier submission) */
      commit(s=>{
        const m=s.migration;if(!m||!m.pending)return;
        m.conflicts=m.conflicts.filter((c,i)=>{
          const pick=picks[i];if(!pick)return true;
          const p=player(c.survivor);const nm=p?p.name:('#'+c.survivor);
          if(c.type==='run'){
            if(pick==='retired')s.run[c.survivor]=c.retiredRec;
            delete s.run[c.retired];
            addLog('Data cleanup: kept '+(pick==='retired'?'earlier':'latest')+'-submission record for '+nm,'warn');
          }else if(c.type==='set'){
            s.sets[c.survivor]=(pick==='retired'?c.retiredSet:c.survivorSet);
            if(p)p.set=s.sets[c.survivor];
            addLog('Data cleanup: '+nm+' set to Set '+s.sets[c.survivor],'warn');
          }
          return false;
        });
        if(!m.conflicts.length)delete s.migration;
      });
    },
    clearMigrationNotice(){commit(s=>{delete s.migrationNotice;});},
    reauctionUnsold(){
      if(migBlocked())return{ok:false,err:'Resolve the data-cleanup conflict first'};
      let n=0;
      commit(s=>{for(const no of s.order){if(s.run[no]&&s.run[no].status==='unsold'){delete s.run[no];n++;}}s.unsoldOrder=[];
        if(n){s.currentIdx=0;const ni=nextPendingIdx(0);if(ni>=0)s.currentIdx=ni;
          s.bid={amount:0,teamIdx:null};s.timer={total:s.settings.timerSecs,endsAt:Date.now()+s.settings.timerSecs*1000,running:true,remaining:s.settings.timerSecs};s.overlay=null;
          addLog('Unsold re-auction round started ('+n+' players)','warn');}});
      return{ok:n>0,count:n};
    },
    excludePlayer(no){if(migBlocked())return{ok:false,err:'Resolve the data-cleanup conflict first'};
      commit(s=>{s.run[no]={status:'excluded'};const p=player(no);if(p)addLog('Excluded '+p.name,'warn');
      if(s.order[s.currentIdx]===no){const ni=nextPendingIdx(s.currentIdx+1);if(ni>=0)s.currentIdx=ni;}});},
    includePlayer(no){commit(s=>{if(s.run[no]&&s.run[no].status==='excluded')delete s.run[no];});},
    adjustPurse(teamIdx,points,reason){if(migBlocked())return;
      commit(s=>{s.adjustments=s.adjustments||[];s.adjustments.push({teamIdx,points,reason,at:Date.now()});
      addLog(s.teams[teamIdx].name+(points<0?' penalty ':' adjustment ')+points+' pts'+(reason?' ('+reason+')':''),'warn');});},
    releasePlayer(no,teamIdx){ if(migBlocked())return; /* updated rule (owner 26 Oct): on squad shortfall the highest-bidded player is removed, 30% of his bid refunded (70% retained), and the player returns to the unsold pool. Manual operator action. */
      commit(s=>{const r=s.run[no];if(r&&r.status==='sold'){const price=r.soldPrice;const refund=Math.round(price*0.3);
        s.run[no]={status:'unsold'};s.saleOrder=(s.saleOrder||[]).filter(n=>n!==no);s.adjustments=s.adjustments||[];
        s.adjustments.push({teamIdx,points:-(price-refund),reason:'release: 70% of bid retained (30% refunded)',at:Date.now()});
        const p=player(no);addLog('RELEASED: '+(p?p.name:no)+' from '+s.teams[teamIdx].name+' -> unsold pool (refund '+refund.toLocaleString('en-IN')+' pts = 30% of '+price.toLocaleString('en-IN')+')','warn');
        if(Array.isArray(s.salesHistory)){for(let i=s.salesHistory.length-1;i>=0;i--){if(s.salesHistory[i].no===no){s.salesHistory.splice(i,1);break;}}}
      }});
      snapshotState('RELEASE: '+(player(no)?player(no).name:no));},
    setPhotoMode(no,mode){commit(s=>{const p=player(no);if(!p)return;s.photoMode=s.photoMode||{};if(mode==='orig'&&p.orig)s.photoMode[no]='orig';else delete s.photoMode[no];});},
    setPlayerSet(no,set){commit(s=>{const p=player(no);if(p){p.set=(set===1?1:2);s.sets=s.sets||{};s.sets[no]=p.set;}});},
    setTeamName(i,name){commit(s=>{s.teams[i].name=String(name||('TEAM '+(i+1))).slice(0,18);});},
    teamSlug,teamSlugByIdx,teamLogoSrc,
    updateSettings(patch){commit(s=>{Object.assign(s.settings,patch);
      if(patch.timerSecs){s.timer.total=patch.timerSecs;if(!s.timer.running)s.timer.remaining=patch.timerSecs;}});},
    timerStart(){commit(s=>{if(!s.timer.running){s.timer.running=true;s.timer.endsAt=Date.now()+s.timer.remaining*1000;}});},
    timerPause(){commit(s=>{if(s.timer.running){s.timer.remaining=Math.max(0,Math.ceil((s.timer.endsAt-Date.now())/1000));s.timer.running=false;s.timer.endsAt=null;}});},
    timerReset(){commit(s=>{s.timer.running=false;s.timer.endsAt=null;s.timer.remaining=s.timer.total;s.countdown={phase:'idle',endsAt:null};});},
    timerTick(){ /* operator calls on interval; drives timer + close-out machine */
      const cd=state.countdown;
      if(cd&&cd.phase!=='idle'&&cd.endsAt&&Date.now()>=cd.endsAt){
        commit(s=>{
          if(s.countdown.phase==='silent8'){s.countdown={phase:'final3',endsAt:Date.now()+3000};addLog('Closing: 3 - 2 - 1','warn');}
          else if(s.countdown.phase==='final3'){s.countdown={phase:'done',endsAt:null};addLog('Gavel - awaiting the admin\'s call (SOLD or UNSOLD)','warn');}
        });
        return;
      }
      if(state.timer.running&&state.timer.endsAt&&state.bid&&!state.bid.amount&&(!cd||cd.phase==='idle')){
        const leftMs=state.timer.endsAt-Date.now();
        if(leftMs>0&&leftMs<=3000){ /* zero-bid opening: 3-2-1 runs inside the last 3s of the 10s timer; gavel at 10s total (owner, 26 Oct 23:38) */
          commit(s=>{s.countdown={phase:'final3',endsAt:s.timer.endsAt};addLog('Closing: 3 - 2 - 1','warn');});
          return;
        }
      }
      if(state.timer.running&&state.timer.endsAt&&Date.now()>=state.timer.endsAt){
        commit(s=>{s.timer.running=false;s.timer.endsAt=null;s.timer.remaining=0;
          /* zero bids: gavel fires via the final3 that ended with the timer (owner, 26 Oct 23:38); fallback only if it never started */
          if(!s.bid.amount&&(!s.countdown||s.countdown.phase==='idle'))s.countdown={phase:'final3',endsAt:Date.now()};});
      } else if(state.timer.running){save();broadcast();emit();}
    },
    resetAuction(){commit(s=>{const keepTeams=s.teams.map(t=>t.name);const settings=s.settings;const keepSets=s.sets||{};
      const fresh=freshState();fresh.teams=keepTeams.map(n=>({name:n,purseStart:settings.purseStart}));
      fresh.settings=settings;for(const k of Object.keys(s))delete s[k];Object.assign(s,fresh);
      s.sets=keepSets;for(const no in s.sets){const p=player(Number(no));if(p)p.set=s.sets[no];} /* keep set assignments */
      addLog('Auction reset','warn');});},
    resultsCSV(){
      const lines=['Team,Auction No,Player Name,Reg No,Role,Set,Price (pts)'];
      const teams=state.teams.map((t,i)=>({i,name:t.name}));
      for(const t of teams){
        const buys=Object.keys(state.run).map(Number).filter(no=>state.run[no].status==='sold'&&state.run[no].soldTo===t.i);
        for(const no of buys){const p=player(no);const r=state.run[no];
          lines.push([t.name,(p&&p.q)||no,'"'+(p?p.name:'?')+'"',p?p.reg:'',p?p.role:'',p?(p.set===1?1:2):'',r.soldPrice].join(','));}
      }
      lines.push('');lines.push('Team,Players Bought,Spent (pts),Purse Left (pts)');
      for(const t of teams){const spent=state.teams[t.i].purseStart-teamPurse(t.i);
        lines.push([t.name,teamSquad(t.i),spent,teamPurse(t.i)].join(','));}
      return lines.join('\n');
    },
    unsoldCSV(){
      const q=t=>'"'+String(t==null?'':t).replace(/"/g,'""')+'"';
      const lines=['Status,Queue No,App No,Player Name,Reg No,Branch,Role,Set,Base Price (pts)'];
      for(const no of state.order){
        if(!state.run[no]||state.run[no].status!=='unsold')continue;
        const p=player(no);if(!p)continue;
        lines.push(['UNSOLD',(p.q||no),no,q(p.name),q(p.reg),q(p.branch),q(p.role),(p.set===1?1:(p.set===2?2:'')),(p.set===1?100:(p.set===2?50:''))].join(','));
      }
      return lines.join('\n');
    },
    auditCSV(){
      const q=t=>'"'+String(t).replace(/"/g,'""')+'"';
      const lines=['Time,Event'];
      for(const e of (state.log||[]))lines.push(new Date(e.at).toLocaleString('en-IN')+','+q(e.text));
      return lines.join('\n');
    },
    finalReportCSV(){
      const q=t=>'"'+String(t).replace(/"/g,'""')+'"';
      const lines=['BIJAY CUP 2026 - FINAL AUCTION REPORT','Generated,'+new Date().toLocaleString('en-IN'),''];
      lines.push('SOLD PLAYERS');lines.push('Team,Auction No,Player Name,Reg No,Role,Set,Price (pts)');
      for(let i=0;i<state.teams.length;i++){
        const buys=Object.keys(state.run).map(Number).filter(no=>state.run[no].status==='sold'&&state.run[no].soldTo===i).sort((a,b)=>a-b);
        for(const no of buys){const pl=player(no);const r=state.run[no];
          lines.push([q(state.teams[i].name),no,q(pl?pl.name:'?'),pl?pl.reg:'',q(pl?pl.role:''),pl?(pl.set===1?1:2):'',r.soldPrice].join(','));}
      }
      lines.push('');lines.push('UNSOLD PLAYERS');lines.push('Player No,Player Name,Reg No,Role');
      for(const no of state.order){const r=state.run[no];if(r&&r.status==='unsold'){const pl=player(no);lines.push([no,q(pl?pl.name:'?'),pl?pl.reg:'',q(pl?pl.role:'')].join(','));}}
      lines.push('');lines.push('EXCLUDED / RELEASED');lines.push('Player No,Player Name,Status');
      for(const no in state.run){const r=state.run[no];if(r.status==='excluded'||r.status==='released'){const pl=player(Number(no));lines.push([no,q(pl?pl.name:'?'),r.status].join(','));}}
      lines.push('');lines.push('PURSE ADJUSTMENTS');lines.push('Team,Points,Reason,Time');
      for(const a of (state.adjustments||[]))lines.push([q(state.teams[a.teamIdx]?state.teams[a.teamIdx].name:'?'),a.points,q(a.reason||''),new Date(a.at).toLocaleString('en-IN')].join(','));
      lines.push('');lines.push('PURSE SUMMARY');lines.push('Team,Players Bought,Spent (pts),Purse Left (pts)');
      let rec={price:0,no:null};
      for(const no in state.run){const r=state.run[no];if(r.status==='sold'&&r.soldPrice>rec.price)rec={price:r.soldPrice,no:Number(no),teamIdx:r.soldTo};}
      for(let i=0;i<state.teams.length;i++){const spent=state.teams[i].purseStart-teamPurse(i);
        lines.push([q(state.teams[i].name),teamSquad(i),spent,teamPurse(i)].join(','));}
      if(rec.no!=null){const pl=player(rec.no);lines.push('');lines.push('TOP SALE,'+q((pl?pl.name:'#')+' - '+rec.price.toLocaleString('en-IN')+' pts - '+state.teams[rec.teamIdx].name));}
      return lines.join('\n');
    },
    exportJSON(){return JSON.stringify({state,playersets:PLAYERS.map(p=>({no:p.no,set:p.set}))},null,1);},
    importJSON(txt){
      const d=JSON.parse(txt);if(!d||!d.state||!Array.isArray(d.state.order)||!d.state.run)throw new Error('Invalid auction save');
      const incoming=d.state;const old=incoming.renumV!==RENUM_V72_STAMP;
      migrateRetired(incoming);renumberToV72(incoming);migrateTeamRename(incoming);
      if(Array.isArray(d.playersets)){
        incoming.sets=incoming.sets||{};
        for(const ps of d.playersets){const no=old?renumMap72(RETIRED_NOS[ps.no]||ps.no):ps.no;
          if(ps.set===1||ps.set===2)incoming.sets[no]=ps.set;}
      }
      /* v7.4: a restored snapshot/import from an older build gets the same identity-preserving normalisation as load(): same player stays current, queue drops non-players and gains new ones, recorded sales on missing players are KEPT and flagged, tags adopt this build's list when the stamp differs. */
      const notes=[];
      if(Array.isArray(incoming.order)){
        const cur0=(incoming.currentIdx!=null&&incoming.currentIdx>=0&&incoming.currentIdx<incoming.order.length)?incoming.order[incoming.currentIdx]:null;
        const gone=incoming.order.filter(no=>!player(no));
        incoming.order=incoming.order.filter(no=>player(no));
        for(const p of PLAYERS)if(!incoming.order.includes(p.no))incoming.order.push(p.no);
        incoming.order.sort((a,b)=>{const pa=player(a),pb=player(b);return ordK(pa)-ordK(pb)||a-b;});
        const ci=cur0!=null?incoming.order.indexOf(cur0):-1;
        if(ci>=0)incoming.currentIdx=ci;else{incoming.currentIdx=0;if(cur0!=null)notes.push('The player that was on screen (#'+cur0+') is not in this build. The queue moved to the first pending player.');}
        if(gone.length)notes.push('Removed '+gone.length+' queue slot(s) that are not players in this build: '+gone.slice(0,10).join(', '));
      }
      for(const no in (incoming.run||{})){if(!player(Number(no))){const r=incoming.run[no];if(r&&(r.status==='sold'||r.soldPrice))notes.push('KEPT a recorded sale for #'+no+' (price '+r.soldPrice+') although this build has no such player. Purses still count it. Check this one before the auction.');else delete incoming.run[no];}}
      if(typeof SETS_VERSION!=='undefined'&&incoming.setsV!==SETS_VERSION){incoming.sets={};for(const ps of SHIPPED_SETS)if(ps.set===1||ps.set===2)incoming.sets[ps.no]=ps.set;incoming.setsV=SETS_VERSION;}
      if(notes.length)incoming.migrationNotice=(incoming.migrationNotice||[]).concat(notes);
      commit(s=>{for(const k of Object.keys(s))delete s[k];Object.assign(s,incoming);
        for(const p of PLAYERS)p.set=(s.sets||{})[p.no]||null;
      });
    },
  };


  load();
  return {get state(){return state;},onChange,view,actions,player,runOf,teamPurse,teamSquad,minBidFor,incrementFor,counts,currentPlayer,teamAccent,teamAbbr,listSnapshots,restoreSnapshot,snapshotNow:snapshotState,statsData,sortedTeams,squadAdvisory,squadPages,leadFor,upNextList,roleLabel,teamBuys};
})();
