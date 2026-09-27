import { request } from './api';
import type { ProjectionApiState, ProjectionStatus, ProjectionStrategyReview } from '../../server/projection';
import type { ProjectionPlanningPackage, ProjectionProposal, ProjectionUnitId } from '../domain/projection';
import type { FileEntry, FileExportResult } from '../domain/files';
import type { WorkspaceSnapshot } from '../domain/model';
import './projection-panel.css';

interface ProjectionActions {
  flush(): Promise<void>;
  accept(snapshot: WorkspaceSnapshot): void;
  download(text: string, name: string, mime: string): void;
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
};
const kindLabels = { noteProse: '筆記正文', binding: '共享定義', recordInfo: 'Record 資訊' };

/** Review UI only; catalog interpretation and all authority checks remain in the host. */
export class ProjectionPanel {
  private container?: HTMLElement;
  private actions?: ProjectionActions;
  private state?: ProjectionApiState;
  private generation = 0;
  private busy = false;
  private selected = new Set<ProjectionUnitId>();
  private filter = '';
  private page = 0;
  private path = 'Groups/Selected.md';
  private proposalText = '';
  private review?: ProjectionStrategyReview;
  private includeDependencies = false;
  private message = '';
  private failure = '';
  private exported?: FileExportResult;

  async show(container: HTMLElement, actions: ProjectionActions, initialNoteId?: string) {
    this.destroy(); this.container = container; this.actions = actions; this.selected.clear(); this.review = undefined;
    this.proposalText = ''; this.exported = undefined; this.message = ''; this.failure = ''; this.filter = ''; this.page = 0;
    const generation = this.generation;
    container.textContent = '載入分組策略與 Markdown 狀態…';
    const state = await request<ProjectionApiState>('/projection/state');
    if (generation !== this.generation) return;
    this.state = state;
    if (initialNoteId) this.selected = new Set(state.catalog.units.filter(unit => unit.owner.kind === 'note' && unit.owner.id === initialNoteId).map(unit => unit.id));
    this.render();
  }
  destroy() { this.generation++; this.container = undefined; this.actions = undefined; this.busy = false; }
  private async wait<T>(pending: Promise<T>): Promise<T> {
    const generation = this.generation, result = await pending;
    if (generation !== this.generation || !this.container?.isConnected) throw new Error('分組面板已關閉；此回應不會套用到另一個 workspace。');
    return result;
  }
  private invalidateReview() { this.review = undefined; this.container?.querySelector('.gp-projection-review')?.remove(); }
  private async run(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true; this.failure = ''; const generation = this.generation; this.render();
    try { await action(); }
    catch (error) { if (generation === this.generation) this.failure = error instanceof Error ? error.message : String(error); }
    finally { if (generation === this.generation) { this.busy = false; this.render(); } }
  }
  private button(label: string, action: () => Promise<void>, primary = false) {
    const button = el('button', label, primary ? 'primary' : ''); button.type = 'button'; button.disabled = this.busy;
    button.onclick = () => void this.run(action); return button;
  }
  private async refresh() {
    const generation = this.generation; const next = await request<ProjectionApiState>('/projection/state');
    if (generation !== this.generation) throw new Error('分組面板已關閉。');
    this.state = next;
    const available = new Set(next.catalog.units.map(unit => unit.id));
    this.selected = new Set([...this.selected].filter(id => available.has(id)));
  }
  private requireSelection() {
    if (!this.selected.size) throw new Error('請先勾選要分組或匯出的資料。');
    return [...this.selected];
  }
  private async planningPackage() {
    const selectors = this.requireSelection(); await this.wait(this.actions!.flush());
    return this.wait(request<ProjectionPlanningPackage>('/projection/package', 'POST', { selectors, dependencyClosure: this.includeDependencies }));
  }
  private async preview(proposal: unknown) {
    await this.wait(this.actions!.flush());
    this.review = await this.wait(request<ProjectionStrategyReview>('/projection/strategy/plan', 'POST', { proposal }));
    this.message = this.review.canApply ? '請檢查下方差異，確認後才保存分組策略。' : '提案有問題，尚未套用。';
  }
  private renderStatus(parent: HTMLElement, status: ProjectionStatus) {
    const label = { idle: '尚未建立', pending: '有新資料等待 checkpoint', ready: '已發布', dirty: '外部變更待審查', error: '發布失敗' }[status.state];
    parent.append(el('h3', 'Markdown 與完整 fallback'), el('p', `${label} · DB ${status.workspaceRevision} · 最後成功 ${status.lastSuccessRevision ?? '—'}${status.lastSuccessAt ? ` · ${new Date(status.lastSuccessAt).toLocaleString()}` : ''}`));
    parent.append(el('code', status.projectionRoot, 'gp-projection-path'));
    if (status.error) parent.append(el('p', status.error, 'validation-error'));
    if (status.dirtyPaths.length) parent.append(el('p', `有 ${status.dirtyPaths.length} 個外部變更。請在「檔案與 Markdown」審查；重新發布不會覆蓋它們。`, 'validation-error'));
    const actions = el('div', '', 'gp-projection-actions');
    actions.append(this.button('建立完整 checkpoint', async () => {
      await this.wait(this.actions!.flush()); await this.wait(request('/projection/checkpoint', 'POST', {})); await this.refresh();
      this.message = 'Checkpoint 處理完成，請核對最新發布狀態。';
    }, true), this.button('在檔案總管開啟 Markdown', async () => { await request('/files/open-folder', 'POST', { path: 'Markdown' }); }),
    this.button('重新整理', () => this.refresh())); parent.append(actions);
    parent.append(el('p', 'DB 是執行中的資料來源。Markdown 可閱讀、拖給 AI；完整重建需連同隱藏的 .grasp-export 資料與附件保存。已提交更新約每 10 分鐘合併 checkpoint，也可立即手動建立。', 'muted'));
  }
  private renderUnits(parent: HTMLElement) {
    const state = this.state!;
    const search = el('input'); search.type = 'search'; search.placeholder = '搜尋筆記、共享定義或 Record'; search.setAttribute('aria-label', '搜尋分組資料'); search.value = this.filter;
    const count = el('p', '', 'muted'), list = el('div', '', 'gp-projection-units'), pager = el('div', '', 'gp-projection-actions');
    const draw = () => {
      const query = this.filter.normalize('NFC').toLocaleLowerCase();
      const items = state.catalog.units.filter(unit => `${unit.label} ${unit.id} ${kindLabels[unit.kind]}`.normalize('NFC').toLocaleLowerCase().includes(query));
      const size = 40; this.page = Math.max(0, Math.min(this.page, Math.ceil(items.length / size) - 1));
      count.textContent = `已選 ${this.selected.size} 項 · 符合 ${items.length} 項 · 共 ${state.catalog.units.length} 項`;
      list.replaceChildren(); pager.replaceChildren();
      for (const unit of items.slice(this.page * size, (this.page + 1) * size)) {
        const row = el('label', '', 'gp-projection-unit'); const check = el('input'); check.type = 'checkbox'; check.checked = this.selected.has(unit.id); check.disabled = this.busy;
        check.setAttribute('aria-label', `選取 ${kindLabels[unit.kind]} ${unit.label}`);
        check.onchange = () => { this.invalidateReview(); if (check.checked) this.selected.add(unit.id); else this.selected.delete(unit.id); count.textContent = `已選 ${this.selected.size} 項 · 符合 ${items.length} 項 · 共 ${state.catalog.units.length} 項`; };
        const label = el('span'); label.append(el('strong', unit.label), el('small', `${kindLabels[unit.kind]} · ${unit.id}`)); row.append(check, label); list.append(row);
      }
      const navigation = (label: string, action: () => void, disabled = false) => { const button = el('button', label); button.type = 'button'; button.disabled = this.busy || disabled; button.onclick = () => { action(); draw(); }; return button; };
      pager.append(navigation('選取本頁', () => { this.invalidateReview(); items.slice(this.page * size, (this.page + 1) * size).forEach(unit => this.selected.add(unit.id)); }), navigation('清除選取', () => { this.invalidateReview(); this.selected.clear(); }),
        navigation('上一頁', () => this.page--, this.page === 0), el('span', `${this.page + 1} / ${Math.max(1, Math.ceil(items.length / size))}`), navigation('下一頁', () => this.page++, (this.page + 1) * size >= items.length));
    };
    search.oninput = () => { this.filter = search.value; this.page = 0; draw(); };
    parent.append(el('h3', '選擇資料並安排輸出'), el('p', '同篇筆記中的定義可以分到不同檔案。移動輸出位置會保留原筆記、身分與 binding 位置；未分配資料仍會出現在完整 fallback。', 'muted'), search, count, list, pager); draw();
  }
  private render() {
    if (!this.container || !this.state) return;
    const state = this.state, body = el('section', '', 'gp-projection-panel'); body.setAttribute('aria-busy', String(this.busy));
    if (this.failure) { const error = el('p', this.failure, 'validation-error'); error.setAttribute('role', 'alert'); body.append(error); }
    if (this.message) { const message = el('p', this.message, 'gp-projection-message'); message.setAttribute('role', 'status'); body.append(message); }
    this.renderStatus(body, state.status);
    const current = el('details'); current.append(el('summary', `目前分組策略 · 修訂 ${state.strategy.revision} · ${state.strategy.groups.length} 個群組`));
    const groupList = el('div'); for (const group of state.strategy.groups) groupList.append(el('p', `${group.path} · ${group.members.length} 項`));
    current.append(groupList); body.append(current);
    this.renderUnits(body);
    const path = el('input'); path.value = this.path; path.disabled = this.busy; path.setAttribute('aria-label', '輸出 Markdown 相對路徑'); path.placeholder = 'Projects/Work.md'; path.oninput = () => { this.path = path.value; this.invalidateReview(); };
    const pathLabel = el('label', '合併選取資料至 Markdown 檔案'); pathLabel.append(path); body.append(pathLabel);
    const groupActions = el('div', '', 'gp-projection-actions');
    groupActions.append(this.button('預覽分組策略', async () => {
      const units = this.requireSelection(); const pkg = await this.planningPackage();
      const existing = state.strategy.groups.find(group => group.path === this.path);
      const proposal: ProjectionProposal = { format: 'grasp-projection-proposal', version: 1, workspaceId: pkg.workspaceId, base: pkg.base,
        planningPackageId: pkg.id, coverage: { mode: 'partial', units }, groups: [{ id: existing?.id ?? crypto.randomUUID(), path: this.path, render: 'sections-v1', members: units }], unassigned: 'deterministic-default-v1' };
      this.proposalText = JSON.stringify(proposal, null, 2); await this.preview(proposal);
    }, true), this.button('將選取項目改為未分配', async () => {
      const units = this.requireSelection(), pkg = await this.planningPackage();
      const proposal: ProjectionProposal = { format: 'grasp-projection-proposal', version: 1, workspaceId: pkg.workspaceId, base: pkg.base, planningPackageId: pkg.id,
        coverage: { mode: 'partial', units }, groups: [], unassign: units, unassigned: 'deterministic-default-v1' };
      this.proposalText = JSON.stringify(proposal, null, 2); await this.preview(proposal);
    })); body.append(groupActions);

    const dependency = el('label', '', 'gp-projection-check'); const include = el('input'); include.type = 'checkbox'; include.checked = this.includeDependencies;
    include.disabled = this.busy; include.onchange = () => { this.includeDependencies = include.checked; this.invalidateReview(); }; dependency.append(include, el('span', '部分匯出／外部分析資料包含選取值的依賴定義')); body.append(dependency);
    const exportActions = el('div', '', 'gp-projection-actions');
    exportActions.append(this.button('下載選取資料供外部分析', async () => {
      const pkg = await this.planningPackage(); this.actions!.download(JSON.stringify(pkg, null, 2), 'grasp-planning-package.json', 'application/json;charset=utf-8');
      this.message = '只下載本次選取範圍；將 JSON 交給外部協作者後，可在下方貼回分組提案。';
    }), this.button('匯出選取 Markdown', async () => {
      const selectors = this.requireSelection(); await this.wait(this.actions!.flush());
      this.exported = await this.wait(request<FileExportResult>('/projection/export', 'POST', { scope: 'partial', selectors, dependencyClosure: this.includeDependencies }));
      this.message = '已產生這次選取的檔案；部分匯出不承諾全 workspace 重建。';
    })); body.append(exportActions);
    if (this.exported) { body.append(el('code', this.exported.absolutePath, 'gp-projection-path'), this.button('開啟本次選取檔案資料夾', async () => { await request('/files/open-folder', 'POST', { path: this.exported!.path }); })); }

    const external = el('details'); external.open = !!this.proposalText; external.append(el('summary', '貼上外部協作者的分組提案'));
    const json = el('textarea'); json.value = this.proposalText; json.disabled = this.busy; json.rows = 9; json.spellcheck = false; json.setAttribute('aria-label', '分組提案 JSON'); json.oninput = () => { this.proposalText = json.value; this.invalidateReview(); };
    external.append(el('p', '提案必須指向提供的 planning package 和版本。過期或未知身分會要求重新審查，保存前不改 DB。', 'muted'), json,
      this.button('檢查外部提案', async () => { let proposal: unknown; try { proposal = JSON.parse(this.proposalText); } catch { throw new Error('提案不是有效 JSON。'); } await this.preview(proposal); })); body.append(external);
    if (this.review) {
      const review = this.review, preview = el('section', '', 'gp-projection-review'); preview.append(el('h3', '審查分組差異'));
      for (const issue of review.diagnostics) preview.append(el('p', issue.message, 'validation-error'));
      preview.append(el('p', `${review.changes.length} 項配置變更 · ${review.unassigned.length} 項未分配`));
      const changes = el('div', '', 'gp-projection-changes');
      for (const change of review.changes) changes.append(el('p', `${state.catalog.units.find(unit => unit.id === change.unitId)?.label ?? change.unitId}：${change.before?.path ?? '未分配'} → ${change.after?.path ?? '未分配'}`));
      preview.append(changes, el('p', '分組只決定輸出位置；不移動原始定義、不合併不同資料身分。', 'muted'));
      const apply = this.button('確認保存分組策略', async () => {
        await this.wait(this.actions!.flush());
        const result = await this.wait(request<{ snapshot: WorkspaceSnapshot }>('/projection/strategy/apply', 'POST', { token: review.token }));
        this.actions!.accept(result.snapshot); this.review = undefined; await this.refresh(); this.message = '分組策略已保存。建立 checkpoint 後即可從檔案總管取得新配置。';
      }, true); apply.disabled ||= !review.canApply || !review.token; preview.append(apply); body.append(preview);
    }
    this.container.replaceChildren(body);
  }
}

export async function locateProjectionUnit(unitId: ProjectionUnitId): Promise<FileEntry> {
  const located = await request<{ entry: FileEntry }>('/projection/locate', 'POST', { unitId });
  await request('/files/reveal', 'POST', { path: located.entry.path }); return located.entry;
}
