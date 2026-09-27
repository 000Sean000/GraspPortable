/** Plain file-host DTOs. Relative paths are confined to this workspace's managed file root. */
export interface FileEntry { name: string; path: string; absolutePath: string; kind: 'file' | 'directory'; size: number; modifiedAt: string }
export interface FilesStatus {
  root: string;
  directories: { inbox: string; outbox: string; attachments: string; mirror: string };
  mirror: {
    state: 'idle' | 'pending' | 'ready' | 'error'; revision: number | null;
    manifestPath: string | null; indexPath: string | null; dirtyPaths: string[]; error?: string;
    writtenFiles: number; reusedFiles: number; elapsedMs: number;
  };
}
export interface FileExportResult { path: string; absolutePath: string; manifestPath: string; indexPath: string; files: number; bytes: number }
