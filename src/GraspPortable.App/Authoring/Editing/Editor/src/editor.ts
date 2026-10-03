import { basicSetup } from "codemirror";
import { EditorView, Decoration, WidgetType, keymap } from "@codemirror/view";
import { EditorState, StateEffect, StateField, Transaction, Compartment } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { indentWithTab } from "@codemirror/commands";
import { Marked } from "marked";
import DOMPurify from "dompurify";

type Reference = { name: string; cachedValue: string; start: number; length: number };
type Delta = { from: number; to: number; insert: string };
type DotNet = { invokeMethodAsync(name: string, ...args: unknown[]): Promise<unknown> };
let view: EditorView | undefined, dotnet: DotNet, noteId = "", raw = "", revision = 0;
let live = false, quiet = false, timer: ReturnType<typeof setTimeout> | undefined;
let locked = false, compositionActive = false;
const editability = new Compartment();
let pending: Delta[] = [], sending = Promise.resolve(), refs: Reference[] = [];
const setReferences = StateEffect.define<Reference[]>();
const escapeHtml = (s: string) => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const renderer = new Marked({ renderer: { html(token) { return escapeHtml(token.text); } } });
function html(source: string) { return DOMPurify.sanitize(renderer.parse(source, { async: false }) as string); }
function normalize(source: string) { return source.replace(/\r\n|\r/g, "\n"); }
function rawOffset(source: string, offset: number) {
  let i = 0, n = 0;
  while (i < source.length && n < offset) { if(source[i] === "\r" && source[i+1] === "\n") i++; i++; n++; }
  return i;
}
function normalizedOffset(source: string, offset: number) { return normalize(source.slice(0, offset)).length; }
function newline() { return raw.match(/\r\n|\r|\n/)?.[0] ?? "\n"; }
function makeReference(reference: Reference): HTMLElement {
  const element = document.createElement("span");
  element.className = "managed-reference" + (reference.cachedValue.includes("\n") ? " multiline" : "");
  element.dataset.identifier = reference.name;
  element.title = reference.name + " · 點選查看定義";
  element.tabIndex = 0;
  const content = document.createElement("span"); content.className = "reference-content";
  content.innerHTML = html(reference.cachedValue || "（空值）");
  element.append(content);
  element.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); void dotnet.invokeMethodAsync("OnReferenceClicked", reference.name); });
  element.addEventListener("keydown", event => { if(event.key === "Enter") { event.preventDefault(); void dotnet.invokeMethodAsync("OnReferenceClicked", reference.name); } });
  return element;
}
class ReferenceWidget extends WidgetType {
  constructor(readonly reference: Reference) { super(); }
  eq(other: ReferenceWidget) { return other.reference.name === this.reference.name && other.reference.cachedValue === this.reference.cachedValue; }
  toDOM() { return makeReference(this.reference); }
  ignoreEvent() { return true; }
}
function decorations(state: EditorState) {
  if (!live) return Decoration.none;
  const cursor = state.selection.main;
  const referenceRanges = refs.filter(r => r.start >= 0 && r.start + r.length <= raw.length)
    .map(r => ({ reference: r, from: normalizedOffset(raw, r.start), to: normalizedOffset(raw, r.start+r.length) }))
    .filter(r => r.from < r.to && !(cursor.from <= r.to && cursor.to >= r.from));
  const ranges = referenceRanges.map(r => Decoration.replace({widget: new ReferenceWidget(r.reference)}).range(r.from, r.to));
  syntaxTree(state).iterate({ enter(node) {
    if(cursor.from <= node.to && cursor.to >= node.from) return;
    if(referenceRanges.some(r => r.from < node.to && r.to > node.from)) return;
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
  create: state => decorations(state),
  update(value, transaction) {
    for(const effect of transaction.effects) if(effect.is(setReferences)) refs = effect.value;
    if(transaction.docChanged) refs = [];
    return decorations(transaction.state);
  },
  provide: field => EditorView.decorations.from(field)
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
function extensions() {
  return [
    editability.of(EditorState.readOnly.of(locked)),
    basicSetup, markdown(), keymap.of([indentWithTab, { key: "Mod-s", run: () => { void dotnet.invokeMethodAsync("OnSaveRequested"); return true; } }]),
    EditorView.lineWrapping, referenceField,
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
export async function setDocument(id: string, source: string, localRevision: number, references: Reference[], livePreview: boolean) {
  clearTimeout(timer); await queueSend();
  quiet = true; noteId = id; raw = source; revision = localRevision; pending = []; refs=references; live=livePreview; compositionActive=false;
  view!.setState(EditorState.create({doc:normalize(source),extensions:extensions()}));
  quiet = false;
}
export function setMode(livePreview: boolean) { live=livePreview; view?.dispatch({effects:setReferences.of(refs)}); }
export function freeze(value: boolean) {
  locked=value;
  view?.dispatch({effects:editability.reconfigure(EditorState.readOnly.of(value))});
  const title=document.querySelector<HTMLInputElement>(".note-title"); if(title)title.disabled=value;
}
export function updateReferences(expectedSource: string, references: Reference[]) {
  if(raw !== expectedSource || compositionActive || view?.composing) return false;
  view?.dispatch({effects:setReferences.of(references)}); return true;
}
export function applyCommitted(expectedSource: string, source: string, references: Reference[]) {
  if(!view || raw !== expectedSource || compositionActive || view.composing || pending.length) return false;
  const before = view.state.doc.toString(), after = normalize(source);
  let from=0; while(from<before.length && from<after.length && before[from]===after[from]) from++;
  let oldTo=before.length,newTo=after.length;
  while(oldTo>from && newTo>from && before[oldTo-1]===after[newTo-1]) {oldTo--;newTo--;}
  if(from>0 && /[\uD800-\uDBFF]/.test(before[from-1])) from--;
  quiet=true;
  if(before!==after) view.dispatch({changes:{from,to:oldTo,insert:after.slice(from,newTo)},annotations:Transaction.addToHistory.of(false)});
  raw=source; refs=references; view.dispatch({effects:setReferences.of(references)}); quiet=false;
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
export function renderReading(elementId: string, source: string, references: Reference[]) {
  const target=document.getElementById(elementId); if(!target)return;
  const nonce=crypto.randomUUID();
  let represented=source;
  const ordered=references.filter(r=>r.start>=0&&r.start+r.length<=source.length).sort((a,b)=>b.start-a.start);
  ordered.forEach((r,index)=> { represented=represented.slice(0,r.start)+"\uE000"+nonce+":"+index+"\uE001"+represented.slice(r.start+r.length); });
  target.innerHTML=html(represented);
  const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT), nodes:Text[]=[];
  while(walker.nextNode()) nodes.push(walker.currentNode as Text);
  for(const node of nodes) {
    const expression=new RegExp("\uE000"+nonce+":(\\d+)\uE001","g");
    let match:RegExpExecArray|null,last=0; const fragment=document.createDocumentFragment();
    while((match=expression.exec(node.data))) {
      fragment.append(document.createTextNode(node.data.slice(last,match.index)),makeReference(ordered[Number(match[1])]));
      last=match.index+match[0].length;
    }
    if(last) {fragment.append(document.createTextNode(node.data.slice(last)));node.replaceWith(fragment);}
  }
  target.querySelectorAll("a").forEach(a=>a.addEventListener("click",event=>{
    event.preventDefault(); void dotnet.invokeMethodAsync("OnExternalLink",a.getAttribute("href")??"");
  }));
}
export async function dispose() { clearTimeout(timer); await queueSend(); view?.destroy(); view=undefined; }
