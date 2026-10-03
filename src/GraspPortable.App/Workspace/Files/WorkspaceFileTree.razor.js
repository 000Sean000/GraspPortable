const instances = new WeakMap();
function invoke(instance, method, ...args) {
    // A component can be disposed while an input event is in flight.
    void instance.receiver.invokeMethodAsync(method, ...args).catch(error => console.debug("File explorer input ended", error));
}
function visibleEntries(root) {
    return [...root.querySelectorAll("button[data-explorer-path]")].filter(el => el.getClientRects().length);
}
export function attach(root, receiver) {
    detach(root);
    const instance = { receiver, menu: null, previousFocus: null };
    instance.treeKey = event => {
        const entry = event.target.closest("button[data-explorer-path]");
        if (!entry || !root.contains(entry)) return;
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
            event.preventDefault();
            const box = entry.getBoundingClientRect();
            invoke(instance, "OpenKeyboardMenu", entry.dataset.explorerPath, box.left + 16, box.bottom);
            return;
        }
        const entries = visibleEntries(root), at = entries.indexOf(entry);
        let next;
        if (event.key === "ArrowDown") next = entries[Math.min(entries.length - 1, at + 1)];
        if (event.key === "ArrowUp") next = entries[Math.max(0, at - 1)];
        if (event.key === "Home") next = entries[0];
        if (event.key === "End") next = entries[entries.length - 1];
        if (next) { event.preventDefault(); next.focus(); return; }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            if (event.key === "ArrowRight" && entry.getAttribute("aria-expanded") === "true") {
                entries[at + 1]?.focus();
            } else invoke(instance, "TreeArrow", entry.dataset.explorerPath, event.key);
        }
    };
    instance.menuKey = event => {
        if (!instance.menu) return;
        if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation();
            invoke(instance, "CloseMenuFromKeyboard"); return;
        }
        if (!instance.menu.contains(event.target)) return;
        const buttons = [...instance.menu.querySelectorAll('button[role="menuitem"]')];
        const at = buttons.indexOf(document.activeElement);
        let next;
        if (event.key === "ArrowDown") next = buttons[(at + 1) % buttons.length];
        if (event.key === "ArrowUp") next = buttons[(at - 1 + buttons.length) % buttons.length];
        if (event.key === "Home") next = buttons[0];
        if (event.key === "End") next = buttons[buttons.length - 1];
        if (event.key === "Tab") next = buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length];
        if (next) { event.preventDefault(); next.focus(); }
    };
    instance.resize = () => { if (instance.menu) invoke(instance, "CloseMenuFromKeyboard"); };
    root.addEventListener("keydown", instance.treeKey);
    document.addEventListener("keydown", instance.menuKey, true);
    window.addEventListener("resize", instance.resize);
    instances.set(root, instance);
}
export function showMenu(root, menu, x, y) {
    const instance = instances.get(root);
    if (!instance) return;
    instance.previousFocus = document.activeElement;
    instance.menu = menu;
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + "px";
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + "px";
    menu.querySelector('button[role="menuitem"]')?.focus();
}
export function hideMenu(root) {
    const instance = instances.get(root);
    if (!instance) return;
    instance.menu = null;
    if (instance.previousFocus?.isConnected) instance.previousFocus.focus({ preventScroll: true });
    instance.previousFocus = null;
}
export function focusPath(root, path) {
    visibleEntries(root).find(el => el.dataset.explorerPath === path)?.focus();
}
export function revealPath(root, path) {
    // Reveal the active note without taking keyboard focus away from its editor.
    visibleEntries(root).find(el => el.dataset.explorerPath.toLowerCase() === path.toLowerCase())
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
export function detach(root) {
    const instance = instances.get(root);
    if (!instance) return;
    root.removeEventListener("keydown", instance.treeKey);
    document.removeEventListener("keydown", instance.menuKey, true);
    window.removeEventListener("resize", instance.resize);
    instances.delete(root);
}
