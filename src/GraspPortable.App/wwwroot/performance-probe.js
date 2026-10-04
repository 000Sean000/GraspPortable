// Opt-in local acceptance instrumentation. Records durations and counts, never content or IDs.
let active=false, started=0, frame=0, previous=0, scrollingUntil=0, sequence=0;
let observer, samples={}, pending=new Map(), skipped=0, finished=0;
const limit=36000;
function add(kind, milliseconds) {
  if (!Number.isFinite(milliseconds)||milliseconds<0)return;
  const values=samples[kind]??(samples[kind]=[]);
  if(values.length<limit)values.push(milliseconds);else skipped++;
}
function afterPaint(work){requestAnimationFrame(()=>requestAnimationFrame(work));}
function input(event){
  if(!active||!document.hasFocus()||!(event.target instanceof Element)
    ||!event.target.closest('input,textarea,[contenteditable="true"]'))return;
  const at=performance.now(), epoch=started;
  afterPaint(()=>{if(active&&started===epoch)add('inputToPaintOpportunity',performance.now()-at);});
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
  stop(); samples={};pending=new Map();skipped=0;sequence=0;finished=0;
  started=performance.now();previous=0;active=true;
  document.addEventListener('beforeinput',input,true);document.addEventListener('scroll',scroll,true);
  try{observer=new PerformanceObserver(list=>{if(active&&document.hasFocus())for(const entry of list.getEntries())add('foregroundLongTask',entry.duration);});observer.observe({type:'longtask',buffered:false});}catch{}
  frame=requestAnimationFrame(tick);
}
export function begin(kind){if(!active)return 0;const id=++sequence;pending.set(id,{kind,at:performance.now()});return id;}
export function end(id,accepted=true){
  const span=pending.get(id);pending.delete(id);if(!span||!active||!accepted)return;
  const epoch=started;afterPaint(()=>{if(active&&epoch===started)add(span.kind,performance.now()-span.at);});
}
function stop(){
  if(active)finished=performance.now();active=false;cancelAnimationFrame(frame);observer?.disconnect();observer=undefined;
  document.removeEventListener('beforeinput',input,true);document.removeEventListener('scroll',scroll,true);
}
export function report(finish=false){
  if(finish)stop();
  const summary={};
  for(const[kind,values]of Object.entries(samples)){
    const ordered=[...values].sort((a,b)=>a-b);
    summary[kind]={count:ordered.length,p95:ordered[Math.max(0,Math.ceil(ordered.length*.95)-1)]??null,max:ordered.at(-1)??null,atLeast200ms:ordered.filter(x=>x>=200).length};
  }
  return JSON.stringify({format:1,elapsedMs:(finished||performance.now())-started,skipped,
    measurement:'Two rAF callbacks bound a paint opportunity; this is not a display-photon timestamp. Foreground samples exclude the initial five seconds. Long frames require attribution.',summary,samples});
}
