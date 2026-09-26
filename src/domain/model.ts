export interface Note { id: string; title: string; markdown: string; revision: number; updatedAt: string }
export interface StructuredRecord { id: string; collection: string; name: string; fields: Record<string, string>; revision: number }
export interface WorkspaceSnapshot { id: string; name: string; revision: number; notes: Note[]; records: StructuredRecord[]; settings: Record<string, string> }
export interface SourceLocation { noteId: string; from: number; to: number; line: number }
export interface Definition { name: string; template: string; location: SourceLocation; dependencies: string[] }
export interface Reference { name: string; location: SourceLocation; kind: 'reference' | 'dependency' }
export interface Diagnostic { kind: 'syntax' | 'duplicate' | 'missing' | 'cycle' | 'limit'; message: string; location?: SourceLocation; name?: string }
export interface ValueResult { value: string; status: 'ok' | 'missing' | 'cycle' | 'error'; message?: string }
export interface ParseResult { definitions: Definition[]; references: Reference[]; diagnostics: Diagnostic[] }
export interface RuntimeResult {
  revision: number; values: Record<string, ValueResult>; definitions: Definition[];
  references: Reference[]; diagnostics: Diagnostic[];
  metrics: { elapsedMs: number; recalculated: number; total: number; affected: number; indexMs?: number; dirtyMs?: number; calculationMs?: number };
}
export interface ImportChange { id: string; title: string; before: string; after: string; kind: 'create' | 'update' | 'unchanged' }
export interface ImportPlan { token: string; workspaceRevision: number; changes: ImportChange[]; records: StructuredRecord[]; diagnostics: Diagnostic[]; canApply: boolean }
