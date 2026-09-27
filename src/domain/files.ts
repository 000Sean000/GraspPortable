/** Plain file-host DTOs. Relative paths are confined to this workspace's managed file root. */
export interface FileEntry { name: string; path: string; absolutePath: string; kind: 'file' | 'directory'; size: number; modifiedAt: string }
export interface ProjectionPath { id: string; path: string }
export interface ExternalNoteReview {
  path: string; noteId: string; workspaceId: string; workspaceRevision: number; noteRevision: number;
  baselineSha256: string; sha256: string; markdown: string;
}
export interface FilesStatus {
  root: string;
  directories: { inbox: string; outbox: string; attachments: string; mirror: string; markdown: string; internal: string; manifests: string };
  projection: { path: string; absolutePath: string; notes: ProjectionPath[]; folders: ProjectionPath[]; attachments: ProjectionPath[]; units?: Array<{ unitId: string; path: string }> };
  mirror: {
    state: 'idle' | 'pending' | 'ready' | 'dirty' | 'error'; revision: number | null;
    manifestPath: string | null; indexPath: string | null; dirtyPaths: string[]; error?: string;
    writtenFiles: number; reusedFiles: number; elapsedMs: number;
  };
}
export interface FileExportResult { path: string; absolutePath: string; manifestPath: string; indexPath: string; files: number; bytes: number }
