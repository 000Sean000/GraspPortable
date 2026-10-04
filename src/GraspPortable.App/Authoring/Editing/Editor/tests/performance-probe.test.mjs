import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('opt-in probe only accepts a current foreground paint and preserves full aggregates',async()=>{
  let time=1,sequence=0,focus=true,visible=true,longTasks;
  const frames=new Map(),listeners=new Map();
  const root={isConnected:true,token:'1',getAttribute(){return this.token;},getClientRects(){return visible?[{}]:[];}};
  const old=Object.fromEntries(['document','Element','requestAnimationFrame','cancelAnimationFrame','PerformanceObserver','getComputedStyle','performance'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const set=(key,value)=>Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  set('Element',class {closest(){return this;}});
  set('document',{visibilityState:'visible',hasFocus:()=>focus,getElementById:()=>root,
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)});
  set('performance',{now:()=>time});
  set('requestAnimationFrame',fn=>{const id=++sequence;frames.set(id,fn);return id;});
  set('cancelAnimationFrame',id=>frames.delete(id));
  set('getComputedStyle',()=>({visibility:'visible'}));
  set('PerformanceObserver',class {constructor(callback){longTasks=callback;}observe(){}disconnect(){}});
  const frame=()=>{time+=16;const batch=[...frames.values()];frames.clear();for(const fn of batch)fn(time);};
  try {
    const source=await readFile(new URL('../../../../wwwroot/performance-probe.js',import.meta.url),'utf8');
    const probe=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const guard={rootId:'note',attribute:'data-token',token:'1'};
    const count=kind=>JSON.parse(probe.report()).summary[kind]?.count??0;
    probe.start();
    probe.end(probe.begin('rendered'),true,guard);frame();frame();assert.equal(count('rendered'),1);
    probe.end(probe.begin('rejected'),false,guard);frame();frame();assert.equal(count('rejected'),0);
    probe.end(probe.begin('changed-token'),true,guard);frame();root.token='2';frame();assert.equal(count('changed-token'),0);root.token='1';
    probe.end(probe.begin('hidden'),true,guard);frame();visible=false;frame();assert.equal(count('hidden'),0);visible=true;
    probe.end(probe.begin('background'),true,guard);frame();document.visibilityState='hidden';frame();assert.equal(count('background'),0);document.visibilityState='visible';
    probe.end(probe.begin('lost-focus'),true,guard);frame();focus=false;frame();assert.equal(count('lost-focus'),0);focus=true;
    const typing=probe.begin('new-input');
    listeners.get('beforeinput')({type:'beforeinput',target:new Element()});
    probe.end(typing,true,guard);frame();frame();assert.equal(count('new-input'),0);
    const composing=probe.begin('ime');
    listeners.get('compositionstart')({type:'compositionstart',target:new Element()});
    probe.end(composing,true,guard);frame();frame();assert.equal(count('ime'),0);
    probe.end(probe.begin('restarted'),true,guard);frame();probe.start();frame();frame();assert.equal(count('restarted'),0);
    const entries=Array.from({length:180005},(_,i)=>({duration:i===180004?501:2}));
    longTasks({getEntries:()=>entries});
    const report=JSON.parse(probe.report(true)),aggregate=report.summary.foregroundLongTask;
    assert.equal(aggregate.count,180005);assert.equal(aggregate.retainedCount,180000);
    assert.equal(aggregate.max,501);assert.equal(aggregate.atLeast200ms,1);
    assert.equal(aggregate.p95Population,'retained-prefix');assert.equal(report.skipped,5);
  } finally {for(const [key,descriptor]of Object.entries(old))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});
