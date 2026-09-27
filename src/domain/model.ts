export interface Folder { id: string; parentId: string | null; name: string; revision: number }
export interface Note { id: string; title: string; markdown: string; revision: number; updatedAt: string; folderId: string | null }
export interface StructuredRecord { id: string; collection: string; name: string; fields: Record<string, string>; revision: number }
export interface WorkspaceSnapshot { id: string; name: string; revision: number; notes: Note[]; folders: Folder[]; records: StructuredRecord[]; settings: Record<string, string> }
export interface SourceLocation { noteId: string; from: number; to: number; line: number }
export type ValueOwner = { kind: 'note'; noteId: string } | { kind: 'record'; recordId: string; collection: string; recordName: string; field: string };
export interface Definition { name: string; template: string; location: SourceLocation; dependencies: string[]; owner?: ValueOwner; nameLocation?: SourceLocation }
export interface Reference { name: string; location: SourceLocation; kind: 'reference' | 'dependency'; owner?: ValueOwner; nameLocation?: SourceLocation }
export interface Diagnostic { kind: 'syntax' | 'duplicate' | 'missing' | 'cycle' | 'limit'; message: string; location?: SourceLocation; name?: string }
export interface ValueResult { value: string; status: 'ok' | 'missing' | 'cycle' | 'error'; message?: string }
export interface ParseResult { definitions: Definition[]; references: Reference[]; diagnostics: Diagnostic[] }
export interface RuntimeResult {
  revision: number; values: Record<string, ValueResult>; definitions: Definition[];
  references: Reference[]; diagnostics: Diagnostic[];
  metrics: { elapsedMs: number; recalculated: number; total: number; affected: number; indexMs?: number; dirtyMs?: number; calculationMs?: number };
}
export interface ImportChange { id: string; title: string; before: string; after: string; beforeFolderId: string | null; afterFolderId: string | null; kind: 'create' | 'update' | 'unchanged' }
export interface ImportPlan { token: string; workspaceRevision: number; changes: ImportChange[]; folders: Folder[]; records: StructuredRecord[]; diagnostics: Diagnostic[]; canApply: boolean }
