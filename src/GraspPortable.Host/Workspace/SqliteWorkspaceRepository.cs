using System.Text.Json;
using GraspPortable.Core.Knowledge;
using Microsoft.Data.Sqlite;

namespace GraspPortable.Host.Workspace;

/// <summary>Knowledge read schema and atomic write adapter. One process owns a workspace lock.</summary>
public sealed class SqliteWorkspaceRepository : IWorkspaceRepository
{
    private readonly FileStream workspaceLock;
    private readonly string connectionString;
    private readonly bool markdownSources;
    // Allows a transaction rollback test without adding a product HTTP failure-injection endpoint.
    public Action? BeforeCommitForTest { get; set; }
    public SqliteWorkspaceRepository(string path, bool markdownSources = false)
    {
        this.markdownSources = markdownSources;
        Directory.CreateDirectory(path);
        try { workspaceLock = new(Path.Combine(path, ".grasp.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException e) { throw new IOException("這個 workspace 已由另一個 Grasp Host 開啟。", e); }
        var databasePath = Path.Combine(path, "workspace.grasp.db");
        var existingDatabase = File.Exists(databasePath) && new FileInfo(databasePath).Length > 0;
        connectionString = new SqliteConnectionStringBuilder { DataSource = databasePath, Mode = SqliteOpenMode.ReadWriteCreate, Pooling = true }.ToString();
        try
        {
            using var db = Open();
            if (existingDatabase)
            {
                using var inspect = db.CreateCommand();
                inspect.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='meta'";
                if ((long)inspect.ExecuteScalar()! != 1 || GetMeta(db, "schema") != (markdownSources ? "2" : "1"))
                    throw new InvalidOperationException(markdownSources
                        ? "此 workspace 需要先遷移至新的 Markdown 資料夾；未變更原資料庫。"
                        : "不支援的 workspace 資料版本；未變更資料庫。");
            }
            using (var pragma = db.CreateCommand()) { pragma.CommandText = "PRAGMA journal_mode=WAL;"; pragma.ExecuteNonQuery(); }
            using var initialization = db.BeginTransaction();
            using var command = db.CreateCommand();
            command.Transaction = initialization;
            command.CommandText = """
                CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS notes_title ON notes(title COLLATE NOCASE);
                CREATE TABLE IF NOT EXISTS definitions(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE BINARY, note_id TEXT NOT NULL, body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS definitions_note ON definitions(note_id);
                CREATE TABLE IF NOT EXISTS drafts(note_id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS receipts(operation_id TEXT PRIMARY KEY, body TEXT NOT NULL);
                """;
            command.ExecuteNonQuery();
            if(markdownSources)
            {
                command.CommandText = "CREATE TABLE IF NOT EXISTS source_files(id TEXT PRIMARY KEY, body TEXT NOT NULL);";
                command.ExecuteNonQuery();
            }
            SetDefault(db, initialization, "schema", markdownSources ? "2" : "1"); SetDefault(db, initialization, "workspaceId", Guid.NewGuid().ToString("N"));
            SetDefault(db, initialization, "revision", "0"); SetDefault(db, initialization, "policyRevision", "0"); SetDefault(db, initialization, "languages", "[\"\",\"grasp\"]");
            initialization.Commit();
        }
        catch { workspaceLock.Dispose(); throw; }
    }
    private SqliteConnection Open()
    {
        var db = new SqliteConnection(connectionString); db.Open();
        using var command = db.CreateCommand(); command.CommandText = "PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;"; command.ExecuteNonQuery(); return db;
    }
    private static void SetDefault(SqliteConnection db, SqliteTransaction transaction, string key, string value)
    { using var cmd = db.CreateCommand(); cmd.Transaction = transaction; cmd.CommandText = "INSERT OR IGNORE INTO meta(key,value) VALUES($key,$value)"; cmd.Parameters.AddWithValue("$key", key); cmd.Parameters.AddWithValue("$value", value); cmd.ExecuteNonQuery(); }
    private static string GetMeta(SqliteConnection db, string key)
    { using var cmd = db.CreateCommand(); cmd.CommandText = "SELECT value FROM meta WHERE key=$key"; cmd.Parameters.AddWithValue("$key", key); return (string)cmd.ExecuteScalar()!; }
    private static List<T> ReadAll<T>(SqliteConnection db, string table)
    {
        using var cmd = db.CreateCommand(); cmd.CommandText = $"SELECT body FROM {table}";
        using var reader = cmd.ExecuteReader(); var values = new List<T>();
        while (reader.Read()) values.Add(JsonSerializer.Deserialize<T>(reader.GetString(0))!); return values;
    }
    public Snapshot Load()
    {
        using var db = Open();
        return new(GetMeta(db, "workspaceId"), long.Parse(GetMeta(db, "revision")), long.Parse(GetMeta(db, "policyRevision")),
            JsonSerializer.Deserialize<string[]>(GetMeta(db, "languages"))!, ReadAll<Note>(db, "notes").ToDictionary(n => n.Id), ReadAll<KnowledgeDefinition>(db, "definitions").ToDictionary(d => d.Id));
    }
    public IReadOnlyList<Draft> LoadDrafts() { using var db = Open(); return ReadAll<Draft>(db, "drafts"); }
    public IReadOnlyList<MarkdownFileState> LoadSourceFiles()
    { if(!markdownSources) return []; using var db = Open(); return ReadAll<MarkdownFileState>(db, "source_files"); }
    public Receipt? FindReceipt(string operationId)
    {
        using var db = Open(); using var cmd = db.CreateCommand(); cmd.CommandText = "SELECT body FROM receipts WHERE operation_id=$id"; cmd.Parameters.AddWithValue("$id", operationId);
        return cmd.ExecuteScalar() is string json ? JsonSerializer.Deserialize<Receipt>(json) : null;
    }
    public void SaveDraft(Draft draft)
    {
        using var db = Open(); using var cmd = db.CreateCommand();
        cmd.CommandText = "INSERT INTO drafts(note_id,body) VALUES($id,$body) ON CONFLICT(note_id) DO UPDATE SET body=excluded.body";
        cmd.Parameters.AddWithValue("$id", draft.NoteId); cmd.Parameters.AddWithValue("$body", JsonSerializer.Serialize(draft)); cmd.ExecuteNonQuery();
    }
    public void Commit(Snapshot previous, Snapshot next, Receipt receipt, string? consumedDraftNoteId)
        => CommitCore(previous, next, receipt, consumedDraftNoteId, null);
    public void CommitSources(Snapshot previous, Snapshot next, Receipt receipt, string? consumedDraftNoteId,
        IReadOnlyList<MarkdownFileState> sourceFiles)
    {
        if(!markdownSources) throw new InvalidOperationException("Markdown source registry requires a schema 2 workspace.");
        CommitCore(previous, next, receipt, consumedDraftNoteId, sourceFiles);
    }
    private void CommitCore(Snapshot previous, Snapshot next, Receipt receipt, string? consumedDraftNoteId,
        IReadOnlyList<MarkdownFileState>? sourceFiles)
    {
        var priorSources = sourceFiles is null ? null : LoadSourceFiles().ToDictionary(f => f.DocumentId, StringComparer.Ordinal);
        using var db = Open(); using var transaction = db.BeginTransaction();
        void Execute(string sql, params (string Key, object Value)[] args)
        { using var cmd = db.CreateCommand(); cmd.Transaction = transaction; cmd.CommandText = sql; foreach (var (key, value) in args) cmd.Parameters.AddWithValue(key, value); cmd.ExecuteNonQuery(); }
        // Removing renamed rows first avoids unique-index collisions while preserving canonical IDs.
        foreach (var old in previous.Definitions.Values)
            if (!next.Definitions.TryGetValue(old.Id, out var replacement) || old.Name != replacement.Name)
                Execute("DELETE FROM definitions WHERE id=$id", ("$id", old.Id));
        foreach (var note in next.Notes.Values)
            if (!previous.Notes.TryGetValue(note.Id, out var old) || note.Revision != old.Revision || next.PolicyRevision != previous.PolicyRevision)
                Execute("INSERT INTO notes(id,title,body) VALUES($id,$title,$body) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body", ("$id", note.Id), ("$title", note.Title), ("$body", JsonSerializer.Serialize(note)));
        foreach(var removed in previous.Notes.Keys.Where(id => !next.Notes.ContainsKey(id)))
            Execute("DELETE FROM notes WHERE id=$id", ("$id", removed));
        foreach (var definition in next.Definitions.Values)
            if (!previous.Definitions.TryGetValue(definition.Id, out var old) || definition != old)
                Execute("INSERT INTO definitions(id,name,note_id,body) VALUES($id,$name,$note,$body) ON CONFLICT(id) DO UPDATE SET name=excluded.name,note_id=excluded.note_id,body=excluded.body", ("$id", definition.Id), ("$name", definition.Name), ("$note", definition.NoteId), ("$body", JsonSerializer.Serialize(definition)));
        Execute("UPDATE meta SET value=$value WHERE key='revision'", ("$value", next.Revision.ToString()));
        Execute("UPDATE meta SET value=$value WHERE key='policyRevision'", ("$value", next.PolicyRevision.ToString()));
        Execute("UPDATE meta SET value=$value WHERE key='languages'", ("$value", JsonSerializer.Serialize(next.Languages)));
        Execute("INSERT INTO receipts(operation_id,body) VALUES($id,$body)", ("$id", receipt.OperationId), ("$body", JsonSerializer.Serialize(receipt)));
        if (consumedDraftNoteId is not null) Execute("DELETE FROM drafts WHERE note_id=$id", ("$id", consumedDraftNoteId));
        if(sourceFiles is not null)
        {
            var sourceIds = sourceFiles.Select(f => f.DocumentId).ToHashSet(StringComparer.Ordinal);
            foreach(var removed in priorSources!.Keys.Where(id => !sourceIds.Contains(id)))
                Execute("DELETE FROM source_files WHERE id=$id", ("$id", removed));
            foreach(var file in sourceFiles)
                if(!priorSources.TryGetValue(file.DocumentId, out var prior) || file != prior)
                    Execute("INSERT INTO source_files(id,body) VALUES($id,$body) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
                        ("$id", file.DocumentId), ("$body", JsonSerializer.Serialize(file)));
        }
        BeforeCommitForTest?.Invoke(); transaction.Commit();
    }
    public void Dispose() { SqliteConnection.ClearAllPools(); workspaceLock.Dispose(); }
}
