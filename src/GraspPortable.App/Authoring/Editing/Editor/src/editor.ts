import { basicSetup } from "codemirror";
import { EditorView, Decoration, WidgetType, keymap } from "@codemirror/view";
import { EditorState, StateEffect, StateField, Transaction, Compartment, Prec } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import { indentWithTab, isolateHistory } from "@codemirror/commands";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { literalAction } from "./graspEditing";

export type Reference = { name: string; cachedValue: string; start: number; length: number; originNoteId?: string | null };
export type Region = { start: number; length: number; isComplete: boolean };
type Delta = { from: number; to: number; insert: string };
type DotNet = { invokeMethodAsync(name: string, ...args: unknown[]): Promise<unknown> };
let view: EditorView | undefined, dotnet: DotNet, noteId = "", raw = "", revision = 0;
let live = false, quiet = false, timer: ReturnType<typeof setTimeout> | undefined;
let locked = false, compositionActive = false;
const editability = new Compartment();
let pending: Delta[] = [], sending = Promise.resolve(), refs: Reference[] = [];
let graspRegions:Region[]=[];
const setReferences = StateEffect.define<Reference[]>();
const setRegions = StateEffect.define<Region[]>();
const escapeHtml = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const attribute = (s: string) => escapeHtml(s).replace(/"/g,"&quot;").replace(/'/g,"&#39;");
function imagePlaceholder(target: string, alt: string, wiki = false) {
  const remote=/^(?:https?:)?\/\//i.test(target);
  return `<span class="content-image-placeholder" data-source="${attribute(target)}" data-wiki="${wiki}" role="img" aria-label="${attribute(alt || target)}">${escapeHtml(remote ? `［遠端圖片：${alt || target}（未自動載入）］` : `［圖片：${alt || target}（載入中）］`)}</span>`;
}
const renderer = new Marked({ renderer: {
  html(token) {
    // Only the exact inert identity comment is presentation metadata. Fenced
    // examples stay code; all other raw HTML remains visible escaped text.
    if(/^<!-- grasp:(?:option|record) (?!0{32} -->)[0-9a-f]{32} -->$/.test(token.text))return "";
    return escapeHtml(token.text);
  },
  image(token) { return imagePlaceholder(token.href,token.text); }
}, extensions:[{
  name:"workspaceWiki", level:"inline",
  start(source) { const at=source.search(/!?\[\[(?!@)/); return at<0 ? undefined : at; },
  tokenizer(source) {
    const match=/^(!?)\[\[(?!@)([^\]\r\n]+)\]\]/.exec(source); if(!match)return;
    const split=match[2].indexOf("|"), target=(split<0?match[2]:match[2].slice(0,split)).trim();
    if(!target || target.startsWith("@"))return;
    return {type:"workspaceWiki",raw:match[0],target,label:split<0?target:match[2].slice(split+1),image:match[1]==="!"};
  },
  renderer(token) { return token.image ? imagePlaceholder(token.target,token.label,true)
    : `<a class="workspace-wiki-link" href="#" data-local-target="${attribute(token.target)}" data-wiki="true">${escapeHtml(token.label)}</a>`; }
}] });
function html(source: string) { return DOMPurify.sanitize(renderer.parse(source, { async: false }) as string); }
// Already-evaluated field content is Markdown only. Do not mount an editor or parse Grasp again.
export function renderSafeMarkdown(source: string): string { return html(source); }
let imageEpoch=0;
const imageCache=new Map<string,string>();
const imagePending=new Map<string,Promise<string|null>>();
let imageCacheSize=0;
let activeImages=0;
const imageJobs:(()=>void)[]=[];
function invalidateImages() { imageEpoch++; imageCache.clear(); imagePending.clear(); imageCacheSize=0; }
function scheduleImage(work:()=>Promise<string|null>):Promise<string|null> {
  if(imageJobs.length>=64)return Promise.resolve(null);
  return new Promise(resolve=>{
    const run=()=>{activeImages++;void work().then(resolve,()=>resolve(null)).finally(()=>{activeImages--;imageJobs.shift()?.();});};
    if(activeImages<2)run();else imageJobs.push(run);
  });
}
function rememberImage(key: string, value: string) {
  if(value.length>4*1024*1024)return;
  while(imageCache.size>=24 || imageCacheSize+value.length>4*1024*1024) {
    const oldest=imageCache.keys().next().value; if(oldest===undefined)break;
    imageCacheSize-=imageCache.get(oldest)!.length; imageCache.delete(oldest);
  }
  imageCache.set(key,value); imageCacheSize+=value.length;
}
async function resolveImage(origin: string,target: string,wiki: boolean,epoch: number): Promise<string|null> {
  const key=JSON.stringify([origin,target,wiki]);
  const cached=imageCache.get(key); if(cached)return cached;
  const pending=imagePending.get(key); if(pending)return pending;
  const request=scheduleImage(async()=>{
    if(epoch!==imageEpoch)return null;
    const value=await dotnet.invokeMethodAsync("OnResolveImage",origin,target,wiki);
    const result=typeof value==="string" && /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length<=12*1024*1024 ? value : null;
    if(result && epoch===imageEpoch)rememberImage(key,result); return result;
  }).finally(()=>{if(epoch===imageEpoch)imagePending.delete(key);});
  imagePending.set(key,request); return request;
}
function bindContent(element: HTMLElement,origin: string) {
  element.querySelectorAll<HTMLAnchorElement>("a").forEach(anchor=>{
    if(anchor.dataset.contentBound)return; anchor.dataset.contentBound="true";
    preservePreviewSelection(anchor);
    const target=anchor.dataset.localTarget??anchor.getAttribute("href")??"";
    const missingOrigin=contentOrigin(anchor,origin)==="" && !/^https?:\/\//i.test(target);
    if(missingOrigin) {
      anchor.setAttribute("aria-disabled","true"); anchor.title="來源筆記不存在，無法解析相對連結。";
      anchor.classList.add("content-origin-missing");
    }
    anchor.addEventListener("click",event=>{
      event.preventDefault(); event.stopPropagation();
      if(missingOrigin)return;
      if(/^https?:\/\//i.test(target))void dotnet.invokeMethodAsync("OnExternalLink",target);
      else void dotnet.invokeMethodAsync("OnLocalLink",contentOrigin(anchor,origin),target,anchor.dataset.wiki==="true");
    });
  });
  const placeholders=Array.from(element.querySelectorAll<HTMLElement>(".content-image-placeholder[data-source]"));
  const epoch=imageEpoch,capturedNote=noteId;
  // Limit one rendered chunk and use two workers; excess images remain explicit placeholders.
  const queue=placeholders.filter(placeholder=>{
    if(placeholder.dataset.contentBound)return false; placeholder.dataset.contentBound="true";
    if(contentOrigin(placeholder,origin)==="") {
      placeholder.textContent=`［圖片：${placeholder.getAttribute("aria-label")}（來源筆記不存在，無法解析）］`; return false;
    }
    if(/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(placeholder.dataset.source??"")) {
      placeholder.textContent=`［圖片：${placeholder.getAttribute("aria-label")}（外部來源未載入）］`; return false;
    }
    return true;
  });
  queue.slice(64).forEach(p=>{p.textContent=`［圖片：${p.getAttribute("aria-label")}（本次顯示上限）］`;});
  const visible=queue.slice(0,64);
  async function worker() {
    while(visible.length && epoch===imageEpoch && capturedNote===noteId) {
      const placeholder=visible.shift()!;
      const value=await resolveImage(contentOrigin(placeholder,origin),placeholder.dataset.source??"",placeholder.dataset.wiki==="true",epoch);
      if(epoch!==imageEpoch || capturedNote!==noteId || !placeholder.isConnected)continue;
      if(!value) {placeholder.textContent=`［圖片：${placeholder.getAttribute("aria-label")}（找不到或格式不支援）］`;continue;}
      const image=document.createElement("img"); image.alt=placeholder.getAttribute("aria-label")??"";
      image.style.maxWidth="100%"; image.style.height="auto"; image.loading="lazy"; image.src=value;
      image.addEventListener("load",()=>view?.requestMeasure(),{once:true});
      placeholder.replaceWith(image);
    }
  }
  // Widget DOM is connected by CodeMirror after toDOM returns.
  queueMicrotask(()=>{void worker();void worker();});
}
function contentOrigin(element: HTMLElement,fallback:string) {
  return element.closest<HTMLElement>("[data-origin-note-id]")?.dataset.originNoteId??fallback;
}
function preservePreviewSelection(element: HTMLElement) {
  // Default contenteditable mouse selection would expose the raw source before
  // click, removing the link that was just pressed. Keyboard/source editing is
  // still available by moving the editor selection into the source range.
  element.addEventListener("mousedown",event=>{
    if(event.button===0 && element.closest(".cm-editor"))event.preventDefault();
  });
}
function normalize(source: string) { return source.replace(/\r\n|\r/g, "\n"); }
function rawOffset(source: string, offset: number) {
  let i = 0, n = 0;
  while (i < source.length && n < offset) { if(source[i] === "\r" && source[i+1] === "\n") i++; i++; n++; }
  return i;
}
function normalizedOffset(source: string, offset: number) { return normalize(source.slice(0, offset)).length; }
function newline() { return raw.match(/\r\n|\r|\n/)?.[0] ?? "\n"; }
function referenceMarkup(reference: Reference): HTMLElement {
  const content = document.createElement("span"); content.className = "reference-content";
  content.innerHTML = html(reference.cachedValue || "（空值）");
  // Single-paragraph values are inline; long Markdown keeps its real blocks.
  if(content.children.length===1 && content.firstElementChild?.tagName==="P")content.firstElementChild.replaceWith(...content.firstElementChild.childNodes);
  const block=reference.cachedValue.includes("\n") || !!content.querySelector("p,pre,ul,ol,blockquote,h1,h2,h3,h4,h5,h6,table,hr");
  const element = document.createElement(block ? "div" : "span");
  element.className = "managed-reference" + (block ? " multiline" : "");
  element.dataset.identifier = reference.name;
  element.dataset.graspDefinition = reference.name;
  // Explicit null is an unresolved origin, never the note displaying the cache.
  // Undefined retains compatibility with callers predating origin metadata.
  if(reference.originNoteId!==undefined)element.dataset.originNoteId=reference.originNoteId??"";
  element.setAttribute("role","link");
  element.title = reference.name + " · 點選查看定義";
  element.tabIndex = 0;
  element.append(content);
  return element;
}
function bindReference(element: HTMLElement) {
  preservePreviewSelection(element);
  element.addEventListener("click", event => { if((event.target as Element).closest("a"))return; event.preventDefault(); event.stopPropagation(); void dotnet.invokeMethodAsync("OnReferenceClicked", element.dataset.graspDefinition); });
  element.addEventListener("keydown", event => { if(event.key === "Enter" && event.target===element) { event.preventDefault(); event.stopPropagation(); void dotnet.invokeMethodAsync("OnReferenceClicked", element.dataset.graspDefinition); } });
}
function makeReference(reference: Reference): HTMLElement {
  const element=referenceMarkup(reference);bindReference(element);bindContent(element,reference.originNoteId??noteId);return element;
}
class ReferenceWidget extends WidgetType {
  readonly epoch=imageEpoch;
  constructor(readonly reference: Reference) { super(); }
  eq(other: ReferenceWidget) { return other.epoch===this.epoch && other.reference.name === this.reference.name && other.reference.cachedValue === this.reference.cachedValue && other.reference.originNoteId===this.reference.originNoteId; }
  toDOM() { return makeReference(this.reference); }
  ignoreEvent() { return true; }
}
class ContentWidget extends WidgetType {
  readonly epoch=imageEpoch;
  constructor(readonly source: string,readonly origin: string) { super(); }
  eq(other: ContentWidget) {return other.epoch===this.epoch && other.source===this.source && other.origin===this.origin;}
  toDOM() {const element=document.createElement("span");element.className="content-preview";element.innerHTML=html(this.source);element.querySelectorAll("p").forEach(p=>{p.style.display="inline";p.style.margin="0";});bindContent(element,this.origin);return element;}
  ignoreEvent() {return true;}
}
// Backend ranges use raw UTF-16 offsets; editor state always uses normalized EOLs.
function editorReferences(source: string, references: Reference[]) {
  return references.filter(r => r.start >= 0 && r.start + r.length <= source.length)
    .map(r => { const start = normalizedOffset(source, r.start);
      return {...r, start, length:normalizedOffset(source, r.start+r.length)-start}; });
}
function editorRegions(source:string,regions:Region[]) {
  return regions.filter(r=>r.start>=0&&r.start+r.length<=source.length).map(r=>({...r,start:normalizedOffset(source,r.start),length:normalizedOffset(source,r.start+r.length)-normalizedOffset(source,r.start)}));
}
function decorations(state: EditorState, references: Reference[],regions:Region[]) {
  if (!live) return Decoration.none;
  const cursor = state.selection.main;
  const referenceRanges = references
    .map(r => ({ reference: r, from:r.start, to:r.start+r.length }))
    .filter(r => r.from < r.to && !(cursor.from <= r.to && cursor.to >= r.from));
  const ranges = referenceRanges.map(r => Decoration.replace({widget: new ReferenceWidget(r.reference)}).range(r.from, r.to));
  const contentRanges:{from:number;to:number}[]=[];
  const excluded:{from:number;to:number}[]=regions.map(r=>({from:r.start,to:r.start+r.length}));
  syntaxTree(state).iterate({enter(node){if(/^(FencedCode|CodeBlock|InlineCode|HTMLBlock|HTMLTag)$/.test(node.name)){excluded.push({from:node.from,to:node.to});return false;}}});
  const overlaps=(from:number,to:number,list:{from:number;to:number}[])=>list.some(r=>from<r.to&&to>r.from);
  const source=state.doc.toString(),wiki=/!?\[\[(?!@)[^\]\r\n]+\]\]/g;
  const escapedAt=(position:number)=>{let count=0;for(let at=position-1;at>=0&&source[at]==="\\";at--)count++;return count%2!==0;};
  let match:RegExpExecArray|null;
  while((match=wiki.exec(source))) {
    const from=match.index,to=from+match[0].length;
    if(escapedAt(from))continue;
    if(cursor.from<=to&&cursor.to>=from || overlaps(from,to,excluded) || references.some(r=>from<r.start+r.length&&to>r.start))continue;
    contentRanges.push({from,to});ranges.push(Decoration.replace({widget:new ContentWidget(match[0],noteId)}).range(from,to));
  }
  syntaxTree(state).iterate({ enter(node) {
    if(cursor.from <= node.to && cursor.to >= node.from) return;
    if(referenceRanges.some(r => r.from < node.to && r.to > node.from)) return;
    if(overlaps(node.from,node.to,excluded) || overlaps(node.from,node.to,contentRanges))return;
    if(node.name==="Link" || node.name==="Image" || node.name==="Autolink") {
      if(escapedAt(node.from))return false;
      const snippet=source.slice(node.from,node.to);
      // Lezer also labels unresolved reference-style brackets as Link. Do not
      // turn a source slice into a fresh wiki token after losing its escape/context.
      if(!/<(?:a\b|span\b[^>]*class="content-image-placeholder")/.test(html(snippet)))return false;
      contentRanges.push({from:node.from,to:node.to});
      ranges.push(Decoration.replace({widget:new ContentWidget(snippet,noteId)}).range(node.from,node.to));return false;
    }
    if(/^ATXHeading[1-6]$/.test(node.name)) ranges.push(Decoration.line({class:"cm-live-heading cm-live-"+node.name}).range(state.doc.lineAt(node.from).from));
    if(node.name === "StrongEmphasis") ranges.push(Decoration.mark({class:"cm-live-strong"}).range(node.from,node.to));
    if(node.name === "Emphasis") ranges.push(Decoration.mark({class:"cm-live-emphasis"}).range(node.from,node.to));
    if(node.name === "InlineCode") ranges.push(Decoration.mark({class:"cm-live-code"}).range(node.from,node.to));
    if(["HeaderMark","EmphasisMark","CodeMark"].includes(node.name) && node.from<node.to)
      ranges.push(Decoration.replace({}).range(node.from,node.to));
  }});
  return Decoration.set(ranges, true);
}
const referenceField = StateField.define({
  create: state => { const references=editorReferences(raw,refs),regions=editorRegions(raw,graspRegions); return {references,regions, decorations:decorations(state,references,regions)}; },
  update(value, transaction) {
    let references=value.references,regions=value.regions;
    if(transaction.docChanged) {
      invalidateImages();
      regions=regions.map(region=>{const start=transaction.changes.mapPos(region.start,-1),end=transaction.changes.mapPos(region.start+region.length,1);return {...region,start,length:end-start};}).filter(r=>r.length>0);
      references=references.flatMap(reference => {
        const end=reference.start+reference.length;
        let touched=false;
        transaction.changes.iterChangedRanges((from,to) => {
          if(from<end && to>reference.start) touched=true;
        });
        // Edited reference text must await parsing. Unchanged carriers can retain
        // their committed values while ordinary surrounding text is being typed.
        if(touched) return [];
        const start=transaction.changes.mapPos(reference.start,1);
        return [{...reference,start,length:transaction.changes.mapPos(end,-1)-start}];
      });
    }
    // Authoritative results are already normalized against their exact source.
    // Apply after mapping so a committed patch and its ranges arrive atomically.
    for(const effect of transaction.effects) if(effect.is(setReferences)) references=effect.value;
    for(const effect of transaction.effects) if(effect.is(setRegions)) regions=effect.value;
    return {references,regions,decorations:decorations(transaction.state,references,regions)};
  },
  provide: field => EditorView.decorations.from(field,value=>value.decorations)
});
function queueSend() {
  if(!pending.length || !noteId) return sending;
  const batch = pending; pending = [];
  const capturedId = noteId, capturedRevision = revision, composing = compositionActive || (view?.composing ?? false);
  sending = sending.then(async () => {
    await dotnet.invokeMethodAsync("OnEditorChanged", capturedId, capturedRevision, batch, composing);
  }).catch(async error => {
    // The JS document is still authoritative for unsent typing. Surface failure;
    // the explicit flush snapshot can recover the full latest text.
    console.error("Editor delivery failed", error);
    await dotnet.invokeMethodAsync("OnEditorDeliveryFailed", String(error));
  });
  return sending;
}
function schedule() { clearTimeout(timer); timer = setTimeout(() => { void queueSend(); }, 180); }
function plainGraspContext(state: EditorState, position: number) {
  const tree=ensureSyntaxTree(state,position,5); if(!tree)return false;
  if(state.field(referenceField).references.some(r=>position>=r.start && position<r.start+r.length))return false;
  for(let node=tree.resolveInner(position,-1); node; node=node.parent!) {
    if(/^(FencedCode|CodeBlock|InlineCode|HTMLBlock|HTMLTag|Link|Image|Autolink|Blockquote|BulletList|OrderedList)$/.test(node.name))return false;
  }
  const source=state.doc.toString();
  if(/^---\n/.test(source)) {
    const closing=/\n(?:---|\.\.\.)[ \t]*(?:\n|$)/g; closing.lastIndex=3;
    const match=closing.exec(source);
    if(!match || position<match.index+match[0].length)return false;
  }
  return true;
}
const literalInput=Prec.highest(EditorView.inputHandler.of((editor,from,to,text,insert) => {
  if(text!=="{" || from!==to || editor.state.selection.ranges.length!==1 || locked || compositionActive || editor.composing || editor.compositionStarted)return false;
  if(!insert().isUserEvent("input.type") || !plainGraspContext(editor.state,from))return false;
  const source=editor.state.doc.toString(), candidates=/^[ \t]{0,3}@code\{/gm;
  let match:RegExpExecArray|null;
  while((match=candidates.exec(source)) && match.index<from) {
    const start=match.index+match[0].indexOf("@code{");
    if(!plainGraspContext(editor.state,start))continue;
    const action=literalAction(source,start,from);
    if(action==="blocked")return false;
    if(!action)continue;
    const changes=action==="open" ? [{from,insert:"{}"}] : [{from,insert:"{"},{from:action.closing,insert:"}"}];
    editor.dispatch({changes,selection:{anchor:from+1},userEvent:"input.type",
      annotations:isolateHistory.of("full")});
    return true;
  }
  return false;
}));
function extensions() {
  return [
    editability.of(EditorState.readOnly.of(locked)),
    // Braces have Grasp-specific marker semantics. Leave ordinary Markdown,
    // pasted examples and disabled code fences untouched by generic pairing.
    EditorState.languageData.of(()=>[{closeBrackets:{brackets:["(","[","'",'"']}}]),
    basicSetup, markdown(), keymap.of([indentWithTab, { key: "Mod-s", run: () => { void dotnet.invokeMethodAsync("OnSaveRequested"); return true; } }]),
    EditorView.lineWrapping, referenceField, literalInput,
    EditorView.theme({
      "&": {height:"100%",fontSize:"16px",background:"transparent"},
      ".cm-scroller": {fontFamily:'"Cascadia Code","Consolas","Microsoft JhengHei",monospace',lineHeight:"1.75",overflow:"auto"},
      ".cm-content": {padding:"24px 26px 80px",caretColor:"#176655"},
      ".cm-gutters": {background:"#f8f9f5",color:"#98a19a",border:"none"},
      ".cm-activeLine": {background:"#edf4ee66"},
      ".cm-activeLineGutter": {background:"#edf4ee"},
      "&.cm-focused": {outline:"none"},
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {background:"#cce4da !important"}
    }),
    EditorView.updateListener.of(update => {
      if(quiet || !update.docChanged) return;
      const oldRaw = raw, lineEnding = newline(), changes: Delta[] = [];
      update.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
        changes.push({from:rawOffset(oldRaw,from), to:rawOffset(oldRaw,to), insert:inserted.toString().replace(/\n/g,lineEnding)});
      });
      for(const change of changes.reverse()) {
        raw = raw.slice(0,change.from)+change.insert+raw.slice(change.to);
        pending.push(change);
      }
      revision++; schedule();
    }),
    EditorView.domEventHandlers({
      compositionstart: () => { compositionActive=true; },
      blur: () => { void queueSend().then(() => dotnet.invokeMethodAsync("OnEditorBlurred")); },
      compositionend: () => { setTimeout(() => { compositionActive=false; void queueSend().then(() => dotnet.invokeMethodAsync("OnCompositionEnded")); },0); }
    })
  ];
}
export function mount(elementId: string, receiver: DotNet) {
  dotnet = receiver;
  view?.destroy();
  view = new EditorView({state:EditorState.create({doc:"",extensions:extensions()}),parent:document.getElementById(elementId)!});
}
export async function setDocument(id: string, source: string, localRevision: number, references: Reference[], livePreview: boolean, regions: Region[] = []) {
  clearTimeout(timer); await queueSend();
  invalidateImages();
  quiet = true; noteId = id; raw = source; revision = localRevision; pending = []; refs=references;graspRegions=regions; live=livePreview; compositionActive=false;
  view!.setState(EditorState.create({doc:normalize(source),extensions:extensions()}));
  view!.scrollDOM.scrollTop = 0;
  view!.scrollDOM.scrollLeft = 0;
  quiet = false;
}
export function setMode(livePreview: boolean) { live=livePreview; view?.dispatch({}); }
export function freeze(value: boolean) {
  locked=value;
  view?.dispatch({effects:editability.reconfigure(EditorState.readOnly.of(value))});
  const title=document.querySelector<HTMLInputElement>(".note-title"); if(title)title.disabled=value;
}
export function updateReferences(expectedSource: string, references: Reference[]) {
  if(raw !== expectedSource || compositionActive || view?.composing) return false;
  invalidateImages();
  view?.dispatch({effects:setReferences.of(editorReferences(expectedSource,references))}); return true;
}
export function applyCommitted(expectedSource: string, source: string, references: Reference[], regions: Region[] = []) {
  if(!view || raw !== expectedSource || compositionActive || view.composing || pending.length) return false;
  invalidateImages();
  const before = view.state.doc.toString(), after = normalize(source);
  let from=0; while(from<before.length && from<after.length && before[from]===after[from]) from++;
  let oldTo=before.length,newTo=after.length;
  while(oldTo>from && newTo>from && before[oldTo-1]===after[newTo-1]) {oldTo--;newTo--;}
  if(from>0 && /[\uD800-\uDBFF]/.test(before[from-1])) from--;
  quiet=true;
  view.dispatch({changes:before!==after ? {from,to:oldTo,insert:after.slice(from,newTo)} : undefined,
    effects:[setReferences.of(editorReferences(source,references)),setRegions.of(editorRegions(source,regions))],annotations:Transaction.addToHistory.of(false)});
  raw=source; quiet=false;
  return true;
}
export async function snapshot() {
  clearTimeout(timer);
  const result={noteId,source:raw,revision,composing:compositionActive || (view?.composing??false)};
  await queueSend(); return result;
}
export function focusAt(rawPosition: number, rawLength=0) {
  if(!view) return;
  const from=normalizedOffset(raw,rawPosition),to=normalizedOffset(raw,rawPosition+rawLength);
  view.dispatch({selection:{anchor:from,head:to},effects:EditorView.scrollIntoView(from,{y:"center"})}); view.focus();
}
export function insertText(text: string) {
  if(!view || locked) return;
  view.dispatch(view.state.replaceSelection(text)); view.focus();
}
// Ranges must belong to this exact raw source. Cached Markdown is rendered once
// and is never passed back through Grasp syntax recognition or this function.
export function renderManagedMarkdown(source: string, references: Reference[] = [], regions: Region[] = []): string {
  const target=document.createElement("div");
  const nonce=crypto.randomUUID();
  let represented=source;
  const blocks=regions.filter(r=>r.isComplete && r.start>=0 && r.length>0 && r.start+r.length<=source.length);
  const ordered=references.filter(r=>r.start>=0&&r.start+r.length<=source.length && !blocks.some(b=>r.start<b.start+b.length && r.start+r.length>b.start));
  const replacements=[...ordered.map((r,index)=>({...r,marker:"\uE000"+nonce+":"+index+"\uE001"})),
    ...blocks.map((r,index)=>({...r,marker:"\uE000"+nonce+":region:"+index+"\uE001"}))].sort((a,b)=>b.start-a.start);
  replacements.forEach(r=> { represented=represented.slice(0,r.start)+r.marker+represented.slice(r.start+r.length); });
  target.innerHTML=html(represented);
  const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT), nodes:Text[]=[];
  while(walker.nextNode()) nodes.push(walker.currentNode as Text);
  for(const node of nodes) {
    const expression=new RegExp("\uE000"+nonce+":(region:)?(\\d+)\uE001","g");
    let match:RegExpExecArray|null,last=0; const fragment=document.createDocumentFragment();
    while((match=expression.exec(node.data))) {
      fragment.append(document.createTextNode(node.data.slice(last,match.index)));
      if(match[1]) {
        const region=blocks[Number(match[2])], pre=document.createElement("pre"), code=document.createElement("code");
        const regionSource=source.slice(region.start,region.start+region.length);
        if(node.parentElement?.closest("pre"))fragment.append(document.createTextNode(regionSource));
        else {
          pre.className="grasp-definition-region"; code.textContent=regionSource;
          pre.style.whiteSpace="pre-wrap"; pre.style.overflowWrap="anywhere"; pre.append(code); fragment.append(pre);
        }
      } else fragment.append(referenceMarkup(ordered[Number(match[2])]));
      last=match.index+match[0].length;
    }
    if(last) {fragment.append(document.createTextNode(node.data.slice(last)));node.replaceWith(fragment);}
  }
  // Marked initially sees each opaque marker as paragraph text. Split that
  // paragraph around block regions rather than leaving invalid pre-inside-p DOM.
  target.querySelectorAll("p").forEach(paragraph=>{
    if(!Array.from(paragraph.children).some(child=>child.matches("pre.grasp-definition-region,div.managed-reference")))return;
    const fragment=document.createDocumentFragment(); let part=document.createElement("p");
    for(const child of Array.from(paragraph.childNodes)) {
      if(child instanceof HTMLElement && child.matches("pre.grasp-definition-region,div.managed-reference")) {
        if(part.childNodes.length)fragment.append(part);
        fragment.append(child); part=document.createElement("p");
      } else part.append(child);
    }
    if(part.childNodes.length)fragment.append(part); paragraph.replaceWith(fragment);
  });
  // HTML tokenization normalizes literal CRLF. An entity retains the exact raw
  // definition text across the shared renderer's serialize/insert boundary.
  return target.innerHTML.replace(/\r/g,"&#13;");
}
export function renderReading(elementId: string, source: string, references: Reference[], regions: Region[] = []) {
  const target=document.getElementById(elementId); if(!target)return;
  invalidateImages(); view?.dispatch({});
  target.innerHTML=renderManagedMarkdown(source,references,regions);
  target.querySelectorAll<HTMLElement>(".managed-reference[data-grasp-definition]").forEach(bindReference);
  bindContent(target,noteId);
}
export function scrollToContentAnchor(anchor: string) {
  const name=anchor.replace(/^#/,"");
  const target=document.getElementById("note-reading")??document.getElementById("reading");
  if(!target || !name)return false;
  const heading=Array.from(target.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")).find(h=>h.id===name || h.textContent?.trim()===name || h.textContent?.trim().toLowerCase().replace(/\s+/g,"-")===name.toLowerCase());
  if(!heading)return false;heading.scrollIntoView({block:"start"});return true;
}
export async function dispose() { clearTimeout(timer); await queueSend(); invalidateImages();view?.destroy(); view=undefined; }
