import { DatabaseSync } from 'node:sqlite';

// A frozen v0.1-format fixture built independently of the current store schema.
export function createV1Workspace(file: string) {
  const snapshot = {
    id: 'legacy-workspace', name: '舊版 Workspace', revision: 3,
    notes: [{ id: 'legacy-note', title: '舊筆記', markdown: '# 中文 😀\r\n\n@name = "保存"\n\n{{name}}', revision: 2, updatedAt: '2026-01-01T00:00:00.000Z' }],
    records: [{ id: 'legacy-record', collection: 'people', name: 'first', fields: { label: '{name}' }, revision: 3 }],
    settings: { mode: 'live', activeNote: 'legacy-note' },
  };
  const db = new DatabaseSync(file);
  try {
    db.exec(`CREATE TABLE workspace (id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL, settings_json TEXT NOT NULL);
      CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, markdown TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE records (id TEXT PRIMARY KEY, collection TEXT NOT NULL, name TEXT NOT NULL, fields_json TEXT NOT NULL, revision INTEGER NOT NULL, UNIQUE(collection, name));
      CREATE INDEX records_collection ON records(collection);
      CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, reason TEXT NOT NULL, workspace_revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL);
      PRAGMA application_id=1196576817; PRAGMA user_version=1;`);
    db.prepare('INSERT INTO workspace VALUES (?, ?, ?, ?)').run(snapshot.id, snapshot.name, snapshot.revision, JSON.stringify(snapshot.settings));
    const n = snapshot.notes[0]!; db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, ?)').run(n.id, n.title, n.markdown, n.revision, n.updatedAt);
    const r = snapshot.records[0]!; db.prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?)').run(r.id, r.collection, r.name, JSON.stringify(r.fields), r.revision);
    db.prepare('INSERT INTO history (created_at, reason, workspace_revision, snapshot_json) VALUES (?, ?, ?, ?)').run(n.updatedAt, '舊版回復點', snapshot.revision, JSON.stringify(snapshot));
  } finally { db.close(); }
  return snapshot;
}
