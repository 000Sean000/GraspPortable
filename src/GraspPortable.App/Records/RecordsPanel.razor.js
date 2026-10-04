import { renderSafeMarkdown } from "../editor.js";

const rendered = new WeakMap();
let activeImages = 0;
const imageQueue = [];
function scheduleImage(work) {
    if (imageQueue.length >= 64) return Promise.resolve(null);
    return new Promise(resolve => {
        const run = () => {
            activeImages++;
            void work().then(resolve, () => resolve(null)).finally(() => { activeImages--; imageQueue.shift()?.(); });
        };
        if (activeImages < 2) run(); else imageQueue.push(run);
    });
}
export function disposeMarkdown(element) {
    const state = rendered.get(element);
    if (state) { state.active = false; state.controller.abort(); state.pending.clear(); state.cache.clear(); }
    rendered.delete(element);
}
export function renderMarkdown(element, markdown, origin, receiver, generation) {
    disposeMarkdown(element);
    const state = { active: true, controller: new AbortController(), pending: new Map(), cache: new Map(), cacheSize: 0 };
    rendered.set(element, state);
    element.innerHTML = renderSafeMarkdown(markdown);
    const current = () => state.active && rendered.get(element) === state && element.isConnected;
    element.querySelectorAll("a").forEach(anchor => {
        anchor.addEventListener("click", event => {
            event.preventDefault(); event.stopPropagation();
            if (!current()) return;
            const target = anchor.dataset.localTarget ?? anchor.getAttribute("href") ?? "";
            void receiver.invokeMethodAsync("Navigate", origin, target, anchor.dataset.wiki === "true", generation).catch(() => {});
        }, { signal: state.controller.signal });
    });
    const placeholders = [...element.querySelectorAll(".content-image-placeholder[data-source]")];
    for (const [index, placeholder] of placeholders.entries()) {
        const target = placeholder.dataset.source ?? "";
        if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(target)) {
            placeholder.textContent = `［圖片：${placeholder.getAttribute("aria-label")}（外部來源未載入）］`; continue;
        }
        if (index >= 64) { placeholder.textContent = "［圖片：本次顯示上限］"; continue; }
        const wiki = placeholder.dataset.wiki === "true", key = JSON.stringify([target, wiki]);
        const request = state.cache.has(key) ? Promise.resolve(state.cache.get(key)) : state.pending.get(key) ?? scheduleImage(async () => {
            if (!current()) return null;
            const value = await receiver.invokeMethodAsync("ResolveImage", origin, target, wiki, generation);
            if (!current() || typeof value !== "string" || value.length > 12 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/=]+$/.test(value)) return null;
            if (state.cache.size < 24 && state.cacheSize + value.length <= 4 * 1024 * 1024) { state.cache.set(key, value); state.cacheSize += value.length; }
            return value;
        }).finally(() => state.pending.delete(key));
        state.pending.set(key, request);
        void request.then(value => {
            if (!current() || !placeholder.isConnected) return;
            if (!value) { placeholder.textContent = `［圖片：${placeholder.getAttribute("aria-label")}（找不到或格式不支援）］`; return; }
            const image = document.createElement("img"); image.alt = placeholder.getAttribute("aria-label") ?? "";
            image.loading = "lazy"; image.src = value; placeholder.replaceWith(image);
        });
    }
}

const modals = new Map();
export function syncModal(id, receiver) {
    const element = document.getElementById(id), existing = modals.get(id);
    if (existing?.element === element) return;
    releaseModal(id);
    if (!element) return;
    const previousFocus = document.activeElement;
    const inertElements = [];
    for (let current = element; current?.parentElement; current = current.parentElement) {
        for (const sibling of current.parentElement.children) {
            if (sibling !== current && sibling instanceof HTMLElement) { inertElements.push([sibling, sibling.inert]); sibling.inert = true; }
        }
    }
    const controller = new AbortController();
    const focusable = () => [...element.querySelectorAll('a[href],button,input,textarea,select,[tabindex]:not([tabindex="-1"])')]
        .filter(node => !node.matches(":disabled") && !node.closest("[inert]") && node.getClientRects().length > 0);
    document.addEventListener("keydown", event => {
        if (event.isComposing) return;
        if (event.key === "Escape") {
            event.preventDefault(); event.stopImmediatePropagation();
            void receiver.invokeMethodAsync("CloseRecordsModal").catch(() => {});
        } else if (event.key === "Tab") {
            const controls = focusable(), first = controls[0], last = controls.at(-1);
            if (!first) { event.preventDefault(); element.focus(); return; }
            if (!element.contains(document.activeElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
                event.preventDefault(); (event.shiftKey ? last : first).focus();
            }
        }
    }, { capture: true, signal: controller.signal });
    modals.set(id, { element, controller, inertElements, previousFocus });
    (focusable()[0] ?? element).focus();
}
export function releaseModal(id) {
    const modal = modals.get(id); if (!modal) return;
    modal.controller.abort();
    for (const [element, previous] of modal.inertElements) element.inert = previous;
    modals.delete(id);
    if (modal.previousFocus instanceof HTMLElement && modal.previousFocus.isConnected && !modal.previousFocus.closest("[inert]")) modal.previousFocus.focus();
}
