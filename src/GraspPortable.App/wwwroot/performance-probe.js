// Opt-in local acceptance instrumentation. Records durations and counts, never content or IDs.
let active=false, started=0, frame=0, previous=0, scrollingUntil=0, sequence=0;
let observer, samples={}, totals={}, pending=new Map(), skipped=0, finished=0, activity=0;
// Ten minutes at up to 300 Hz. Aggregate counts/max remain exact after this cap.
const limit=180000;
function add(kind, milliseconds) {
  if (!Number.isFinite(milliseconds)||milliseconds<0)return;
  const aggregate=totals[kind]??(totals[kind]={count:0,max:0,atLeast200ms:0});
  aggregate.count++;aggregate.max=Math.max(aggregate.max,milliseconds);if(milliseconds>=200)aggregate.atLeast200ms++;
  const values=samples[kind]??(samples[kind]=[]);
  if(values.length<limit)values.push(milliseconds);else skipped++;
}
function foreground(){return document.visibilityState==='visible'&&document.hasFocus();}
function afterPaint(work,valid=()=>true){requestAnimationFrame(()=>{if(valid())requestAnimationFrame(()=>{if(valid())work();});});}
function input(event){
  if(!active||!(event.target instanceof Element)
    ||!event.target.closest('input,textarea,[contenteditable="true"]'))return;
  activity++;
  if(!foreground()||event.type!=='beforeinput')return;
  const at=performance.now(), epoch=started;
  afterPaint(()=>add('inputToPaintOpportunity',performance.now()-at),()=>active&&started===epoch&&foreground());
}
function scroll(){scrollingUntil=performance.now()+200;}
function tick(at){
  if(!active)return;
  if(document.visibilityState==='visible'&&document.hasFocus()&&at-started>5000){
    if(previous){add('foregroundFrameInterval',at-previous);if(at<scrollingUntil)add('scrollFrameInterval',at-previous);}
    previous=at;
  }else previous=0;
  if(at-started>10*60*1000){stop();return;}
  frame=requestAnimationFrame(tick);
}
export function start(){
  stop(); samples={};totals={};pending=new Map();skipped=0;sequence=0;finished=0;activity=0;
  started=performance.now();previous=0;active=true;
  document.addEventListener('beforeinput',input,true);document.addEventListener('scroll',scroll,true);
  document.addEventListener('compositionstart',input,true);document.addEventListener('compositionend',input,true);
  try{observer=new PerformanceObserver(list=>{if(active&&foreground())for(const entry of list.getEntries())add('foregroundLongTask',entry.duration);});observer.observe({type:'longtask',buffered:false});}catch{}
  frame=requestAnimationFrame(tick);
}
export function begin(kind){if(!active)return 0;const id=++sequence;pending.set(id,{kind,at:performance.now(),activity,foreground:foreground()});return id;}
export function end(id,accepted=true,guard=null){
  const span=pending.get(id);pending.delete(id);if(!span||!active||!accepted)return;
  const epoch=started,root=guard?document.getElementById(guard.rootId):null;
  const valid=()=>active&&epoch===started&&span.foreground&&foreground()&&span.activity===activity
    &&(!guard||root&&root===document.getElementById(guard.rootId)&&root.isConnected
      &&root.getAttribute(guard.attribute)===guard.token&&root.getClientRects().length>0
      &&getComputedStyle(root).visibility==='visible');
  afterPaint(()=>add(span.kind,performance.now()-span.at),valid);
}
function stop(){
  if(active)finished=performance.now();active=false;cancelAnimationFrame(frame);observer?.disconnect();observer=undefined;
  document.removeEventListener('beforeinput',input,true);document.removeEventListener('scroll',scroll,true);
  document.removeEventListener('compositionstart',input,true);document.removeEventListener('compositionend',input,true);
}
export function report(finish=false){
  if(finish)stop();
  const summary={};
  for(const[kind,values]of Object.entries(samples)){
    const ordered=[...values].sort((a,b)=>a-b);
    summary[kind]={...totals[kind],retainedCount:ordered.length,p95:ordered[Math.max(0,Math.ceil(ordered.length*.95)-1)]??null,
      p95Population:totals[kind].count===ordered.length?'all':'retained-prefix'};
  }
  return JSON.stringify({format:1,elapsedMs:(finished||performance.now())-started,skipped,
    measurement:'Two rAF callbacks bound a paint opportunity, not a display-photon timestamp. Successful spans retain foreground, input generation and optional DOM token through both callbacks. Frame samples exclude the initial five seconds. Count/max/atLeast200ms include all observations; p95 uses retained samples; skipped counts omitted raw samples. Long frames require attribution.',summary,samples});
}
