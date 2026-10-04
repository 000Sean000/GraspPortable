import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Exercise the production barrier without loading editor dependencies or a GUI.
const source = (await readFile(new URL("../RecordsPanel.razor.js", import.meta.url), "utf8"))
    .replace('import { renderManagedMarkdown } from "../editor.js";', 'const renderManagedMarkdown = source => { if (source === "FAIL") throw new Error("render failure"); return source; };');
const { waitForRecordsPaint, renderMarkdown } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
function fixture() {
    const observers = new Set();
    globalThis.MutationObserver = class {
        constructor(callback) { this.callback = callback; }
        observe() { observers.add(this); }
        disconnect() { observers.delete(this); }
    };
    globalThis.requestAnimationFrame = callback => setTimeout(callback, 1);
    globalThis.cancelAnimationFrame = clearTimeout;
    const child = (expected = "2", ready = "2") => ({ dataset: { recordsPaintExpected: expected, recordsPaintReady: ready } });
    const scope = children => ({ isConnected: true, dataset: { recordsPaintScope: "panel", recordsPaintToken: "7" },
        getClientRects: () => [{}], querySelectorAll: () => children });
    const cells = [child(), child()], root = scope(cells), scopes = [root];
    globalThis.document = { visibilityState: "visible", documentElement: {},
        getElementById: () => root.isConnected ? root : null, querySelectorAll: () => scopes };
    return { child, scope, cells, root, scopes, observers, changed: () => { for (const observer of observers) observer.callback(); } };
}
test("accepts ready table and card, and releases its observer", async () => {
    const f = fixture(); f.scopes.push(f.scope([f.child()]));
    assert.equal(await waitForRecordsPaint("panel", "7", 30), true); assert.equal(f.observers.size, 0);
});
test("waits for the current child generation, never accepts an old ready marker", async () => {
    const f = fixture(); f.cells[0].dataset.recordsPaintReady = "1";
    let settled = false; const pending = waitForRecordsPaint("panel", "7", 200).then(result => { settled = true; return result; });
    await Promise.resolve(); assert.equal(settled, false);
    f.cells[0].dataset.recordsPaintReady = "2"; f.changed();
    assert.equal(await pending, true); assert.equal(f.observers.size, 0);
});
test("card readiness participates even when all table cells are ready", async () => {
    const f = fixture(); f.scopes.push(f.scope([f.child("4", "3")]));
    assert.equal(await waitForRecordsPaint("panel", "7", 15), false); assert.equal(f.observers.size, 0);
});
test("superseding the parent state rejects the old measurement", async () => {
    const f = fixture(); f.cells[0].dataset.recordsPaintReady = "1";
    const pending = waitForRecordsPaint("panel", "7", 200);
    f.root.dataset.recordsPaintToken = "8"; f.changed(); assert.equal(await pending, false);
});
test("explicit failed child is rejected without waiting for unrelated work", async () => {
    const f = fixture(); f.cells[0].dataset.recordsPaintFailed = "2";
    assert.equal(await waitForRecordsPaint("panel", "7", 200), false);
});
test("removed panel cancels pending readiness", async () => {
    const f = fixture(); f.cells[0].dataset.recordsPaintReady = "1";
    const pending = waitForRecordsPaint("panel", "7", 200);
    f.root.isConnected = false; f.changed(); assert.equal(await pending, false);
});
test("mixed modal and table states cannot produce a successful sample", async () => {
    const f = fixture(); const modal = f.scope([f.child()]); modal.dataset.recordsPaintToken = "6"; f.scopes.push(modal);
    assert.equal(await waitForRecordsPaint("panel", "7", 200), false);
});
test("timeout rejects an old ready value and cleans up", async () => {
    const f = fixture(); f.cells[0].dataset.recordsPaintReady = "1";
    assert.equal(await waitForRecordsPaint("panel", "7", 15), false); assert.equal(f.observers.size, 0);
});
test("legitimate empty/null-only table does not require a Markdown component", async () => {
    const f = fixture(); f.cells.length = 0;
    assert.equal(await waitForRecordsPaint("panel", "7", 30), true);
});
test("hidden panel is excluded from visible result measurements", async () => {
    const f = fixture(); f.root.getClientRects = () => [];
    assert.equal(await waitForRecordsPaint("panel", "7", 30), false);
});
function renderElement() {
    return { dataset: { recordsRenderExpected: "2", recordsPaintExpected: "2" }, isConnected: true, innerHTML: "previous",
        querySelectorAll: () => [], classList: { contains: () => false } };
}
test("renderer marks the exact applied generation ready", () => {
    const element = renderElement(); renderMarkdown(element, "current", "origin", {}, 2);
    assert.equal(element.innerHTML, "current"); assert.equal(element.dataset.recordsPaintReady, "2");
});
test("late renderer cannot overwrite a newer expected generation", () => {
    const element = renderElement(); renderMarkdown(element, "outdated", "origin", {}, 1);
    assert.equal(element.innerHTML, "previous"); assert.equal(element.dataset.recordsPaintReady, undefined);
});
test("renderer failure invalidates previous readiness", () => {
    const element = renderElement(); element.dataset.recordsPaintReady = "1";
    assert.throws(() => renderMarkdown(element, "FAIL", "origin", {}, 2), /render failure/);
    assert.equal(element.dataset.recordsPaintReady, undefined); assert.equal(element.dataset.recordsPaintFailed, "2");
});
function linkFixture(recordId, missingOrigin) {
    const events = new Map(), calls = [], element = renderElement();
    const anchor = { dataset: recordId ? { recordId } : {},
        getAttribute: () => "Target.md", closest: () => missingOrigin ? { dataset: { originNoteId: "" } } : null,
        addEventListener: (name, handler) => events.set(name, handler) };
    element.querySelectorAll = selector => selector === "a" ? [anchor] : [];
    const receiver = { invokeMethodAsync: (...args) => { calls.push(args); return Promise.resolve(); } };
    renderMarkdown(element, "carrier", "reader", receiver, 2);
    events.get("click")({ preventDefault() {}, stopPropagation() {} });
    return calls;
}
test("record identity wins over the path even when cached origin is missing", () => {
    const id = "1234567890abcdef1234567890abcdef";
    assert.deepEqual(linkFixture(id, true), [["NavigateRecord", id, 2]]);
});
test("ordinary links retain their path navigation route", () => {
    assert.deepEqual(linkFixture(null, false), [["Navigate", "reader", "Target.md", false, 2]]);
});
