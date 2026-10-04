using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using GraspPortable.Core.Knowledge;
using GraspPortable.Core.ValueEngine;
using GraspPortable.Host.Workspace;
using GraspPortable.Host.Workspace.Markdown;

try
{
// A bounded measurement, not a benchmark platform or UI-performance substitute.
var repoRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../"));
var output = Path.Combine(repoRoot, "workspaces", "SourcePerformance-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(output);
var results = new List<ScenarioResult>();
var failures = new List<string>();
var sdk = "unavailable";
using (var process = Process.Start(new ProcessStartInfo("dotnet", "--version") { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true }))
    if (process is not null) { sdk = (await process.StandardOutput.ReadToEndAsync()).Trim(); await process.WaitForExitAsync(); }
Console.WriteLine($"Environment: {RuntimeInformation.OSDescription}; {RuntimeInformation.ProcessArchitecture}; .NET {Environment.Version}; SDK {sdk}; CPU threads {Environment.ProcessorCount}");
Console.WriteLine("Evidence: " + output);
foreach (var scenario in new[] { new Scenario("small", 100, 5, 1000, false, 30, 800), new Scenario("chain1000", 1001, 3, 2, false, 1, 2000), new Scenario("fanout10000", 10001, 3, 2, true, 1, 2000) })
{
    try
    {
        var path = Path.Combine(output, scenario.Name); Directory.CreateDirectory(path);
        using var physical = new MarkdownWorkspaceRepository(path);
        using var repository = new TimedRepository(physical);
        using var knowledge = new KnowledgeService(repository);
        var seed = Stopwatch.StartNew();
        var source = new StringBuilder("@code{\n@N0 = {x}\n");
        for (var i = 1; i < scenario.Nodes; i++) source.Append('@').Append('N').Append(i).Append(" = N").Append(scenario.Fanout ? 0 : i - 1).Append('\n');
        source.Append('}');
        Check((await knowledge.CreateNoteAsync(Id(), "Definitions", source.ToString())).Status == "committed", "Seed definitions failed.");
        var remaining = scenario.ReferencePositions;
        for (var i = 1; i < scenario.NoteCount; i++)
        {
            var references = remaining / (scenario.NoteCount - i); remaining -= references;
            var body = string.Join('\n', Enumerable.Repeat("[x](:ref:N" + (scenario.Nodes - 1) + ")", references));
            Check((await knowledge.CreateNoteAsync(Id(), "Reader" + i, body)).Status == "committed", "Seed reference note failed.");
        }
        seed.Stop();
        Verify(knowledge, physical, scenario, "x", verifyPhysical: true);
        var rootId = knowledge.Current.Definitions.Values.Single(d => d.Name == "N0").Id;
        var warmup = new List<Timing>();
        if (scenario.Operations > 1)
            for (var i = 0; i < 2; i++)
            {
                var value = i % 2 == 0 ? "y" : "x";
                warmup.Add(await Update(value));
                Verify(knowledge, physical, scenario, value, verifyPhysical: false);
            }
        var measured = new List<Timing>();
        for (var i = 0; i < scenario.Operations; i++)
        {
            var value = i % 2 == 0 ? "y" : "x";
            measured.Add(await Update(value));
            Verify(knowledge, physical, scenario, value, verifyPhysical: i == scenario.Operations - 1);
        }
        var sorted = measured.Select(t => t.TotalMs).Order().ToArray();
        var p95 = sorted[(int)Math.Ceiling(sorted.Length * .95) - 1];
        var result = new ScenarioResult(scenario.Name, path, scenario.NoteCount, scenario.Nodes, scenario.ReferencePositions,
            seed.Elapsed.TotalMilliseconds, warmup.ToArray(), measured.ToArray(), p95, scenario.ThresholdMs, p95 <= scenario.ThresholdMs, true);
        results.Add(result); Save();
        Console.WriteLine($"{scenario.Name}: notes={scenario.NoteCount}, nodes={scenario.Nodes}, refs={scenario.ReferencePositions}; seed={seed.Elapsed.TotalMilliseconds:F1} ms; updates={measured.Count}; p95={p95:F1} ms; gate={scenario.ThresholdMs} ms; {(result.Passed ? "PASS" : "FAIL")}");
        Console.WriteLine($"  median components: prepare={Median(measured.Select(t => t.PrepareMs)):F1}; source+journal={Median(measured.Select(t => t.SourceJournalMs)):F1}; SQL+finalize={Median(measured.Select(t => t.DatabaseFinalizeMs)):F1} ms");
        async Task<Timing> Update(string value)
        {
            repository.Start();
            var receipt = await knowledge.ChangeLiteralAsync(Id(), rootId, knowledge.Current.Revision, value);
            var timing = repository.Stop();
            Check(receipt.Status == "committed", "Measured update was not committed: " + receipt.Status);
            Check(repository.CommitObserved && repository.PhysicalWriteObserved, "Measured update did not include a physical source write.");
            return timing;
        }
    }
    catch (Exception error) { failures.Add(scenario.Name + ": " + error.GetType().Name + ": " + error.Message); Save(); Console.Error.WriteLine(failures[^1]); }
}
Save();
Console.WriteLine("Result JSON: " + Path.Combine(output, "result.json"));
return failures.Count == 0 && results.Count == 3 && results.All(r => r.Passed) ? 0 : 1;

string Id() => Guid.NewGuid().ToString("N");
void Check(bool valid, string message) { if (!valid) throw new InvalidOperationException(message); }
double Median(IEnumerable<double> values) { var ordered = values.Order().ToArray(); return ordered[ordered.Length / 2]; }
void Save() => File.WriteAllText(Path.Combine(output, "result.json"), JsonSerializer.Serialize(new {
    StartedUtc = Directory.GetCreationTimeUtc(output), Runtime = Environment.Version.ToString(), Sdk = sdk,
    OS = RuntimeInformation.OSDescription, Architecture = RuntimeInformation.ProcessArchitecture.ToString(), ProcessorCount = Environment.ProcessorCount,
    Processor = Environment.GetEnvironmentVariable("PROCESSOR_IDENTIFIER"), BuildConfiguration =
#if DEBUG
    "Debug",
#else
    "Release",
#endif
    Measurement = "Full KnowledgeService.ChangeLiteralAsync using MarkdownWorkspaceRepository, including preparation, durable file journal, source writes, SQLite and receipt finalization; excludes post-operation correctness checks. No GUI evidence.",
    PhaseMeaning = "PrepareMs ends when repository.Commit starts; SourceJournalMs ends at AfterFilesWritten hook; DatabaseFinalizeMs includes SQLite commit and semantic-finalized journal marker. Seed and two small-case warmups are excluded from samples.",
    ChainMeaning = "chain1000 = 1000 edges plus literal root; fanout10000 = 10000 direct dependents plus literal root. Values remain one character, never exponential text.",
    Workspaces = output, Results = results, Failures = failures
}, new JsonSerializerOptions { WriteIndented = true }));
void Verify(KnowledgeService knowledge, MarkdownWorkspaceRepository physical, Scenario scenario, string expected, bool verifyPhysical)
{
    var snapshot = knowledge.Current;
    Check(snapshot.Notes.Count == scenario.NoteCount && snapshot.Definitions.Count == scenario.Nodes, "Wrong measurement dimensions.");
    Check(snapshot.Definitions.Values.All(d => d.Status == "Valid" && d.Value == expected), "Computed values/status incorrect.");
    var references = snapshot.Notes.Values.SelectMany(n => n.Syntax.References).ToArray();
    Check(references.Length == scenario.ReferencePositions && references.All(r => r.CachedValue == expected), "Committed reference caches incorrect.");
    if (!verifyPhysical) return;
    var sourceFiles = physical.LoadSourceFiles();
    Check(sourceFiles.Count == scenario.NoteCount, "Unexpected physical file count.");
    foreach (var sourceFile in sourceFiles)
    {
        var envelope = MarkdownEnvelopeCodec.Read(File.ReadAllText(Path.Combine(output, scenario.Name, sourceFile.RelativePath)));
        Check(envelope.CanRewrite, "Physical envelope is invalid.");
        var parsed = GraspParser.Parse(envelope.Body, snapshot.Languages);
        Check(parsed.IsValid && parsed.References.All(r => r.CachedValue == expected), "Physical cached reference differs from committed result.");
    }
}
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}

sealed record Scenario(string Name, int Nodes, int NoteCount, int ReferencePositions, bool Fanout, int Operations, double ThresholdMs);
sealed record Timing(double TotalMs, double PrepareMs, double SourceJournalMs, double DatabaseFinalizeMs);
sealed record ScenarioResult(string Name, string Workspace, int Notes, int Nodes, int ReferencePositions, double SeedMs,
    Timing[] Warmups, Timing[] Samples, double P95Ms, double ThresholdMs, bool Passed, bool CorrectnessPassed);
sealed class TimedRepository : IWorkspaceRepository
{
    private readonly MarkdownWorkspaceRepository inner;
    private readonly Stopwatch watch = new();
    private double commitStart, filesWritten;
    public bool CommitObserved { get; private set; }
    public bool PhysicalWriteObserved { get; private set; }
    public bool UsesSavedSourceAuthority => true;
    public TimedRepository(MarkdownWorkspaceRepository inner)
    {
        this.inner = inner;
        inner.AfterFilesWrittenForTest = () => { if (watch.IsRunning) { filesWritten = watch.Elapsed.TotalMilliseconds; PhysicalWriteObserved = true; } };
    }
    public void Start() { CommitObserved = PhysicalWriteObserved = false; commitStart = filesWritten = 0; watch.Restart(); }
    public Timing Stop() { watch.Stop(); return new(watch.Elapsed.TotalMilliseconds, commitStart, filesWritten - commitStart, watch.Elapsed.TotalMilliseconds - filesWritten); }
    public Snapshot Load() => inner.Load();
    public IReadOnlyList<Draft> LoadDrafts() => inner.LoadDrafts();
    public Receipt? FindReceipt(string operationId) => inner.FindReceipt(operationId);
    public void SaveDraft(Draft draft) => inner.SaveDraft(draft);
    public void Commit(Snapshot previous, Snapshot next, Receipt receipt, string? consumedDraftNoteId)
    { if (watch.IsRunning) { commitStart = watch.Elapsed.TotalMilliseconds; CommitObserved = true; } inner.Commit(previous, next, receipt, consumedDraftNoteId); }
    public void Dispose() { inner.AfterFilesWrittenForTest = null; }
}
