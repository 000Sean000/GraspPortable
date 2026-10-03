using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GraspPortable.Contracts;
using GraspPortable.Core.Knowledge;
using GraspPortable.Host.Notifications;
using GraspPortable.Host.Workspace;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

static string? Argument(string name) { var args = Environment.GetCommandLineArgs(); var at = Array.IndexOf(args, name); return at >= 0 && at + 1 < args.Length ? args[at + 1] : null; }
var workspacePath = Path.GetFullPath(Argument("--workspace") ?? throw new ArgumentException("--workspace is required"));
var credential = await Console.In.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(15));
if (credential is null || credential.Length < 32) throw new ArgumentException("Startup credential required on stdin.");
var credentialBytes = Encoding.UTF8.GetBytes("Bearer " + credential);
var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.WebHost.ConfigureKestrel(options => { options.Listen(IPAddress.Loopback, 0); options.Limits.MaxRequestBodySize = 16 * 1024 * 1024; });
builder.Services.AddSingleton(new SqliteWorkspaceRepository(workspacePath));
builder.Services.AddSingleton<IWorkspaceRepository>(sp => sp.GetRequiredService<SqliteWorkspaceRepository>());
builder.Services.AddSingleton<KnowledgeService>();
builder.Services.AddSingleton<RevisionHub>();
var app = builder.Build();
var knowledge = app.Services.GetRequiredService<KnowledgeService>();
var hub = app.Services.GetRequiredService<RevisionHub>();
knowledge.Changed += hub.Publish;
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
app.Use(async (context, next) =>
{
    var supplied = Encoding.UTF8.GetBytes(context.Request.Headers.Authorization.ToString());
    if (!CryptographicOperations.FixedTimeEquals(supplied, credentialBytes)) { context.Response.StatusCode = 401; return; }
    // The API is for the native .NET client, not browser-origin requests.
    if (context.Request.Headers.ContainsKey("Origin")) { context.Response.StatusCode = 403; return; }
    try { await next(); }
    catch (KeyNotFoundException error) { context.Response.StatusCode = 404; await context.Response.WriteAsJsonAsync(new ApiError(error.Message)); }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
    catch (Exception error)
    {
        Console.Error.WriteLine(error);
        if (!context.Response.HasStarted) { context.Response.StatusCode = 500; await context.Response.WriteAsJsonAsync(new ApiError("操作失敗；尚未確認儲存，請保留草稿並查詢操作狀態。")); }
    }
});
DiagnosticDto Diag(GraspPortable.Core.ValueEngine.ParseDiagnostic d) => new(d.Code, d.Message, d.Span.Start, d.Span.Length);
OperationResult Result(Receipt receipt) => new(receipt.OperationId, receipt.Status, receipt.Revision, receipt.NoteId, receipt.Message, receipt.Diagnostics?.Select(Diag).ToArray(), receipt.AffectedNoteIds);
DefinitionDto Definition(KnowledgeDefinition d) => new(d.Id, d.NoteId, d.Name, d.Value, d.Status, d.IsLiteral, d.Span.Start, d.Span.Length, d.NameSpan.Start, d.NameSpan.Length, d.LastGoodValue);
ReferenceDto Reference(string noteId, GraspPortable.Core.ValueEngine.ParsedReference r) => new(noteId, r.Name, r.Kind.ToString(), r.CachedValue, r.Span.Start, r.Span.Length, r.ValueSpan.Start, r.ValueSpan.Length);
ImpactDto Impact(Impact impact) => new(impact.Revision, impact.NoteIds, impact.Definitions, impact.References, impact.HasDirtyDraft, impact.Message);
app.MapGet("/api/workspace", () => { var s = knowledge.Current; return new WorkspaceInfo(s.WorkspaceId, workspacePath, s.Revision, s.PolicyRevision, s.Languages); });
app.MapGet("/api/notes", (string? search) => knowledge.Current.Notes.Values.Where(n => string.IsNullOrWhiteSpace(search) || n.Title.Contains(search, StringComparison.OrdinalIgnoreCase)).OrderBy(n => n.Title).Take(500).Select(n => new NoteSummary(n.Id, n.Title, n.Revision, knowledge.GetDraft(n.Id) is not null)).ToArray());
app.MapGet("/api/notes/{id}", (string id) =>
{
    var s = knowledge.Current; var note = s.Notes[id]; var draft = knowledge.GetDraft(id);
    return new NoteDto(id, note.Title, note.Source, note.Revision, s.Revision, draft is null ? null : new(draft.SessionId, draft.Revision, draft.BaseNoteRevision, draft.Source, draft.Title),
        s.Definitions.Values.Where(d => d.NoteId == id).Select(Definition).ToArray(), note.Syntax.References.Select(r => Reference(id, r)).ToArray(), note.Diagnostics.Select(Diag).ToArray());
});
app.MapPost("/api/notes", async (CreateNoteRequest request, HttpContext context) => Result(await knowledge.CreateNoteAsync(request.OperationId, request.Title, request.Source, context.RequestAborted)));
app.MapPut("/api/notes/{id}/draft", async (string id, SaveDraftRequest request) => Result(await knowledge.SaveDraftAsync(new(id, request.SessionId, request.DraftRevision, request.BaseNoteRevision, request.Title, request.Source))));
app.MapPost("/api/notes/{id}/commit", async (string id, CommitNoteRequest request, HttpContext context) => Result(await knowledge.CommitNoteAsync(new(request.OperationId, id, request.SessionId, request.DraftRevision, request.ExpectedNoteRevision, request.ExpectedKnowledgeRevision, request.ConfirmRename), context.RequestAborted)));
app.MapGet("/api/definitions", () => knowledge.Current.Definitions.Values.OrderBy(d => d.Name).Select(Definition).ToArray());
app.MapGet("/api/definitions/{id}/impact", (string id) => Impact(knowledge.LiteralImpact(id)));
app.MapGet("/api/definitions/{id}/references", (string id) => { var s = knowledge.Current; var name = s.Definitions[id].Name; return s.Notes.Values.SelectMany(n => n.Syntax.References.Where(r => r.Name == name).Select(r => Reference(n.Id, r))).ToArray(); });
app.MapPost("/api/definitions/{id}/literal", async (string id, LiteralChangeRequest request, HttpContext context) => Result(await knowledge.ChangeLiteralAsync(request.OperationId, id, request.ExpectedKnowledgeRevision, request.Value, context.RequestAborted)));
app.MapPost("/api/policy/preview", (PolicyRequest request) => Impact(knowledge.PolicyImpact(request.EnabledFenceLanguages)));
app.MapPost("/api/policy", async (PolicyRequest request, HttpContext context) => Result(await knowledge.ChangePolicyAsync(request.OperationId, request.ExpectedKnowledgeRevision, request.EnabledFenceLanguages, context.RequestAborted)));
app.MapGet("/api/receipts/{id}", (string id) => knowledge.GetReceipt(id) is { } receipt ? Result(receipt) : new OperationResult(id, "unknown", knowledge.Current.Revision));
app.MapGet("/api/events", async (HttpContext context) =>
{
    context.Response.ContentType = "text/event-stream"; context.Response.Headers.CacheControl = "no-store";
    var subscription = hub.Subscribe();
    try
    {
        async Task Send(ChangeNotice notice) { await context.Response.WriteAsync($"data: {JsonSerializer.Serialize(new RevisionEvent(notice.Revision, notice.NoteIds, notice.PolicyRevision), json)}\n\n", context.RequestAborted); await context.Response.Body.FlushAsync(context.RequestAborted); }
        var s = knowledge.Current; await Send(new(s.Revision, [], s.PolicyRevision));
        await foreach (var notice in subscription.Reader.ReadAllAsync(context.RequestAborted)) await Send(notice);
    }
    finally { hub.Unsubscribe(subscription.Id); }
});
app.MapPost("/api/shutdown", async () => { await knowledge.DrainAsync(); app.Lifetime.StopApplication(); return Results.Ok(); });
await app.StartAsync();
var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
Console.WriteLine(JsonSerializer.Serialize(new { port = new Uri(address).Port, workspaceId = knowledge.Current.WorkspaceId, protocolVersion = Protocol.Version }));
Console.Out.Flush();
if (int.TryParse(Argument("--parent-pid"), out var parentId))
{
    _ = Task.Run(async () => { try { using var parent = Process.GetProcessById(parentId); await parent.WaitForExitAsync(); } catch (ArgumentException) { } finally { await knowledge.DrainAsync(); app.Lifetime.StopApplication(); } });
}
await app.WaitForShutdownAsync();
