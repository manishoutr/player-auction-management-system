/* Bijay Cup 2026 - audience sound design (synthesized in-browser, no audio files, works offline).
   Display window only. Master mute + master volume + per-cue volumes persist locally. */
const AuctionSound=(()=>{
  let ctx=null;
  let enabled=(localStorage.getItem('bijaycup2026_sound')||'on')==='on';
  let volume=parseFloat(localStorage.getItem('bijaycup2026_vol')||'0.8');
  const CATS=['sold','unsold','bid','reveal','tick','record'];
  let catVol={};
  try{catVol=JSON.parse(localStorage.getItem('bijaycup2026_catvol')||'{}')||{};}catch(e){catVol={};}
  for(const c of CATS)if(typeof catVol[c]!=='number')catVol[c]=1;
  function persist(){try{localStorage.setItem('bijaycup2026_catvol',JSON.stringify(catVol));}catch(e){}}
  function ac(){if(!ctx){try{ctx=new (window.AudioContext||window.webkitAudioContext)();}catch(e){}}
    if(ctx&&ctx.state==='suspended')ctx.resume();return ctx;}
  function out(cat){const c=ac();if(!c)return null;const g=c.createGain();
    g.gain.value=volume*(catVol[cat]==null?1:catVol[cat]);g.connect(c.destination);return g;}
  function thump(g,c,t0,f0,f1,dur,peak){
    const o=c.createOscillator();o.type='sine';o.frequency.setValueAtTime(f0,t0);
    o.frequency.exponentialRampToValueAtTime(f1,t0+dur);
    const og=c.createGain();og.gain.setValueAtTime(0.0001,t0);
    og.gain.exponentialRampToValueAtTime(peak,t0+0.012);
    og.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    o.connect(og);og.connect(g);o.start(t0);o.stop(t0+dur+0.05);}
  function tone(g,c,t0,f0,dur,peak,type){
    const o=c.createOscillator();o.type=type||'triangle';o.frequency.setValueAtTime(f0,t0);
    const og=c.createGain();og.gain.setValueAtTime(0.0001,t0);
    og.gain.exponentialRampToValueAtTime(peak,t0+0.015);
    og.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    o.connect(og);og.connect(g);o.start(t0);o.stop(t0+dur+0.05);}
  function noiseHit(g,c,t0,dur,peak,hp){
    const n=c.sampleRate*dur|0;const buf=c.createBuffer(1,n,c.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/n,2.2);
    const src=c.createBufferSource();src.buffer=buf;
    const f=c.createBiquadFilter();f.type='highpass';f.frequency.value=hp;
    const ng=c.createGain();ng.gain.value=peak;
    src.connect(f);f.connect(ng);ng.connect(g);src.start(t0);}
  function sweep(g,c,t0,dur,peak){ /* airy rising whoosh for the reveal */
    const n=c.sampleRate*dur|0;const buf=c.createBuffer(1,n,c.sampleRate);
    const d=buf.getChannelData(0);for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*Math.sin(Math.PI*i/n);
    const src=c.createBufferSource();src.buffer=buf;
    const f=c.createBiquadFilter();f.type='bandpass';f.Q.value=1.2;
    f.frequency.setValueAtTime(300,t0);f.frequency.exponentialRampToValueAtTime(3200,t0+dur);
    const ng=c.createGain();ng.gain.value=peak;
    src.connect(f);f.connect(ng);ng.connect(g);src.start(t0);}
  function ready(cat){if(!enabled||!CATS.includes(cat))return null;const c=ac();if(!c)return null;
    const g=out(cat);if(!g)return null;return{g,c,t:c.currentTime};}
  return {
    get enabled(){return enabled;},get volume(){return volume;},
    cats:CATS,
    catVolume(c){return catVol[c]==null?1:catVol[c];},
    setCatVolume(c,v){if(CATS.includes(c)){catVol[c]=Math.max(0,Math.min(1,v));persist();}},
    setEnabled(v){enabled=!!v;try{localStorage.setItem('bijaycup2026_sound',enabled?'on':'off');}catch(e){}},
    setVolume(v){volume=Math.max(0,Math.min(1,v));try{localStorage.setItem('bijaycup2026_vol',String(volume));}catch(e){}},
    unlock(){ac();},
    sold(){const r=ready('sold');if(!r)return;const{g,c,t}=r;
      thump(g,c,t,220,55,0.5,0.9); noiseHit(g,c,t,0.22,0.5,900);
      thump(g,c,t+0.16,330,70,0.7,0.8); noiseHit(g,c,t+0.16,0.3,0.4,600);},
    unsold(){const r=ready('unsold');if(!r)return;const{g,c,t}=r;
      thump(g,c,t,160,48,0.85,0.55);},
    bid(){const r=ready('bid');if(!r)return;const{g,c,t}=r; /* short bright paddle blip */
      tone(g,c,t,660,0.09,0.32); tone(g,c,t+0.07,990,0.11,0.26);},
    reveal(){const r=ready('reveal');if(!r)return;const{g,c,t}=r;
      sweep(g,c,t,0.85,0.5); thump(g,c,t+0.62,180,60,0.5,0.7);},
    tick(){const r=ready('tick');if(!r)return;const{g,c,t}=r; /* countdown pulse click */
      noiseHit(g,c,t,0.05,0.3,1400); tone(g,c,t,1250,0.06,0.18,'square');},
    record(){const r=ready('record');if(!r)return;const{g,c,t}=r; /* rising milestone sting */
      tone(g,c,t,523,0.16,0.4); tone(g,c,t+0.13,659,0.16,0.4); tone(g,c,t+0.26,784,0.3,0.5);
      noiseHit(g,c,t+0.26,0.3,0.25,1200);},
    gavel(){const r=ready('sold');if(!r)return;const{g,c,t}=r; /* 3-2-1 gavel hit (timer close) */
      noiseHit(g,c,t,0.12,0.9,500); thump(g,c,t,140,40,0.5,1.0);
      noiseHit(g,c,t+0.28,0.12,0.8,500); thump(g,c,t+0.28,120,36,0.6,1.0);}
  };
})();
