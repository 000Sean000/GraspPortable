import { renderManagedMarkdown } from "../editor.js";

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
export function applyMarkdownBatch(commands) {
    // Fail one cell independently; its existing paint-failed token remains authoritative.
    return commands.map(command => {
        try {
            if (command.operation === "dispose") disposeMarkdown(command.element);
            else if (command.operation === "render") {
                if (command.element?.isConnected)
                    renderMarkdown(command.element, command.markdown, command.origin, command.receiver,
                        command.generation, command.references, command.regions);
            } else return false;
            return true;
        } catch { return false; }
    });
}
export function renderMarkdown(element, markdown, origin, receiver, generation, references = [], regions = []) {
    const token = String(generation);
    if (element.dataset.recordsRenderExpected !== token) return;
    delete element.dataset.recordsPaintReady;
    delete element.dataset.recordsPaintFailed;
    try {
        renderMarkdownContent(element, markdown, origin, receiver, generation, references, regions);
        if (element.dataset.recordsRenderExpected === token && element.dataset.recordsPaintExpected === token)
            element.dataset.recordsPaintReady = token;
    } catch (error) {
        if (element.dataset.recordsPaintExpected === token) element.dataset.recordsPaintFailed = token;
        throw error;
    }
}
function renderMarkdownContent(element, markdown, origin, receiver, generation, references, regions) {
    disposeMarkdown(element);
    const state = { active: true, controller: new AbortController(), pending: new Map(), cache: new Map(), cacheSize: 0 };
    rendered.set(element, state);
    element.innerHTML = renderManagedMarkdown(markdown, references, regions);
    const current = () => state.active && rendered.get(element) === state && element.isConnected;
    element.querySelectorAll("a").forEach(anchor => {
        const target = anchor.dataset.localTarget ?? anchor.getAttribute("href") ?? "";
        const recordId = anchor.dataset.recordId;
        // Empty origin is deliberate: an unresolved cached reference must never
        // borrow the reader's relative path and silently open another same-named file.
        const linkOrigin = anchor.closest("[data-origin-note-id]")?.dataset.originNoteId ?? origin;
        const external = /^https?:\/\//i.test(target);
        const missingOrigin = linkOrigin === "" && !external && !recordId;
        if (missingOrigin) {
            anchor.setAttribute("aria-disabled", "true");
            anchor.title = "引用來源定義已不存在，無法確定此相對連結的位置。";
            anchor.setAttribute("aria-label", `${anchor.textContent ?? target}（引用來源缺失，連結停用）`);
            const message = document.createElement("small");
            message.className = "content-origin-missing"; message.textContent = "（來源缺失）";
            anchor.append(message);
        }
        anchor.addEventListener("click", event => {
            event.preventDefault(); event.stopPropagation();
            if (!current() || missingOrigin) return;
            if (recordId) {
                void receiver.invokeMethodAsync("NavigateRecord", recordId, generation).catch(() => {}); return;
            }
            void receiver.invokeMethodAsync("Navigate", external ? origin : linkOrigin, target, anchor.dataset.wiki === "true", generation).catch(() => {});
        }, { signal: state.controller.signal });
    });
    element.querySelectorAll("[data-grasp-definition]").forEach(reference => {
        const navigate = event => {
            if (event.target instanceof Element && event.target.closest("a")) return;
            event.preventDefault(); event.stopPropagation();
            if (current()) void receiver.invokeMethodAsync("NavigateDefinition", reference.dataset.graspDefinition, generation).catch(() => {});
        };
        reference.addEventListener("click", navigate, { signal: state.controller.signal });
        reference.addEventListener("keydown", event => {
            if (event.key === "Enter" && event.target === reference) navigate(event);
        }, { signal: state.controller.signal });
    });
    if (element.classList.contains("compact")) requestAnimationFrame(() => {
        if (!current()) return;
        const clip = element.getBoundingClientRect();
        // Summary cells expose only visible links to Tab; the full field keeps every link.
        element.querySelectorAll("a,[data-grasp-definition]").forEach(link => {
            const visible = [...link.getClientRects()].some(rect => rect.top < clip.bottom && rect.bottom > clip.top && rect.left < clip.right && rect.right > clip.left);
            if (!visible) link.tabIndex = -1;
        });
    });
    const placeholders = [...element.querySelectorAll(".content-image-placeholder[data-source]")];
    for (const [index, placeholder] of placeholders.entries()) {
        const target = placeholder.dataset.source ?? "";
        if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/\/)/.test(target)) {
            placeholder.textContent = `［圖片：${placeholder.getAttribute("aria-label")}（外部來源未載入）］`; continue;
        }
        if (index >= 64) { placeholder.textContent = "［圖片：本次顯示上限］"; continue; }
        const imageOrigin = placeholder.closest("[data-origin-note-id]")?.dataset.originNoteId ?? origin;
        if (imageOrigin === "") {
            placeholder.textContent = `［圖片：${placeholder.getAttribute("aria-label")}（引用來源缺失，未載入）］`;
            placeholder.title = "引用來源定義已不存在，無法確定此相對圖片的位置。";
            continue;
        }
        const wiki = placeholder.dataset.wiki === "true", key = JSON.stringify([imageOrigin, target, wiki]);
        const request = state.cache.has(key) ? Promise.resolve(state.cache.get(key)) : state.pending.get(key) ?? scheduleImage(async () => {
            if (!current()) return null;
            const value = await receiver.invokeMethodAsync("ResolveImage", imageOrigin, target, wiki, generation);
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

// Opt-in parent barrier. DOM tokens contain generations only; no source or IDs
// are sent to the timing report. Image loading is deliberately not awaited.
export function waitForRecordsPaint(rootId, token, timeoutMs = 2000) {
    return new Promise(resolve => {
        let done = false, frame = 0, timer;
        const finish = accepted => {
            if (done) return;
            done = true; observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer); resolve(accepted);
        };
        const check = () => {
            if (done) return;
            const root = document.getElementById(rootId);
            if (!root?.isConnected || root.dataset.recordsPaintToken !== token || document.visibilityState === "hidden" || root.getClientRects().length === 0)
                return finish(false);
            const scopes = [...document.querySelectorAll("[data-records-paint-scope]")].filter(scope => scope.dataset.recordsPaintScope === rootId);
            if (!scopes.includes(root) || scopes.some(scope => scope.dataset.recordsPaintToken !== token)) return finish(false);
            const children = scopes.flatMap(scope => [...scope.querySelectorAll("[data-records-paint-expected]")]);
            if (children.some(child => child.dataset.recordsPaintFailed === child.dataset.recordsPaintExpected)) return finish(false);
            if (children.every(child => child.dataset.recordsPaintExpected && child.dataset.recordsPaintReady === child.dataset.recordsPaintExpected)) finish(true);
        };
        const observer = new MutationObserver(() => {
            if (!done && !frame) frame = requestAnimationFrame(() => { frame = 0; check(); });
        });
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true,
            attributeFilter: ["data-records-paint-scope", "data-records-paint-token", "data-records-paint-expected", "data-records-paint-ready", "data-records-paint-failed", "class", "style"] });
        timer = setTimeout(() => finish(false), Math.max(1, Math.min(timeoutMs, 2000)));
        check();
    });
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
