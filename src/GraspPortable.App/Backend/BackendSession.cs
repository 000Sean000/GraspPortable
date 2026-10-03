using System.Diagnostics;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using GraspPortable.Contracts;

namespace GraspPortable.App.Backend;

public sealed class BackendSession : IAsyncDisposable
{
    private Process? process;
    private HttpClient? http;
    private CancellationTokenSource? feedStop;
    private Task? feedTask;
    private readonly Queue<string> errors = new();
    private readonly SemaphoreSlim lifecycle = new(1, 1);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public WorkspaceInfo? Workspace { get; private set; }
    public string Status { get; private set; } = "尚未開啟工作區";
    public string WorkspacePath { get; private set; } = InitialWorkspace();
    private static string MigrationKey(string path) => "migration-"+Convert.ToHexStringLower(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(Path.GetFullPath(path).ToUpperInvariant())));
    private static string InitialWorkspace()
    {
        var selected=Environment.GetEnvironmentVariable("GRASP_WORKSPACE")
            ?? Microsoft.Maui.Storage.Preferences.Default.Get("last-workspace",Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "GraspPortable", "FirstUI"));
        return Microsoft.Maui.Storage.Preferences.Default.Get(MigrationKey(selected),selected);
    }
    public bool Connected => http is not null && process is { HasExited: false };
    public event Action? Changed;
    public event Action<RevisionEvent>? RevisionReceived;
    public Func<Task<bool>>? BeforeClose { get; set; }
    public bool AllowNativeClose { get; set; }
    public bool Closing { get; set; }

    public async Task OpenAsync(string path)
    {
        await lifecycle.WaitAsync();
        try
        {
            await StopInternalAsync();
            WorkspacePath = Path.GetFullPath(path);
            var hostPath = Environment.GetEnvironmentVariable("GRASP_HOST_PATH");
            if (string.IsNullOrWhiteSpace(hostPath))
            {
                var sibling = Path.Combine(AppContext.BaseDirectory, "Host", "GraspPortable.Host.exe");
                if (File.Exists(sibling)) hostPath = sibling;
                else throw new InvalidOperationException("找不到本機後端。請使用 repository 提供的啟動入口，或設定 GRASP_HOST_PATH。");
            }
            if (!File.Exists(hostPath)) throw new FileNotFoundException("本機後端尚未建置。", hostPath);
            var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            var start = new ProcessStartInfo
            {
                FileName = hostPath.EndsWith(".dll", StringComparison.OrdinalIgnoreCase) ? "dotnet" : hostPath,
                UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true,
                RedirectStandardError = true, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(hostPath)!
            };
            if (hostPath.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)) start.ArgumentList.Add(hostPath);
            start.ArgumentList.Add("--workspace"); start.ArgumentList.Add(WorkspacePath);
            start.ArgumentList.Add("--parent-pid"); start.ArgumentList.Add(Environment.ProcessId.ToString());
            Status = "正在開啟工作區…"; Changed?.Invoke();
            process = Process.Start(start) ?? throw new InvalidOperationException("無法啟動本機後端。");
            var started = process;
            _ = Task.Run(async () =>
            {
                while (await started.StandardError.ReadLineAsync() is { } line)
                {
                    lock(errors) { errors.Enqueue(line); while(errors.Count > 12) errors.Dequeue(); }
                }
            });
            await process.StandardInput.WriteLineAsync(token);
            await process.StandardInput.FlushAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var line = await process.StandardOutput.ReadLineAsync(timeout.Token);
            if(line is null)
            {
                lock(errors) throw new InvalidOperationException("本機後端啟動失敗。\n" + string.Join("\n", errors));
            }
            var hello = JsonSerializer.Deserialize<HostHello>(line, Json) ?? throw new InvalidOperationException("無效的本機後端握手。");
            if(hello.ProtocolVersion != Protocol.Version) throw new InvalidOperationException("App 與 Host 版本不一致，請使用同一批建置。");
            http = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{hello.Port}/"), Timeout = TimeSpan.FromSeconds(30) };
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            Workspace = await GetAsync<WorkspaceInfo>("api/workspace");
            if (Workspace.WorkspaceId != hello.WorkspaceId) throw new InvalidOperationException("工作區握手不一致。");
            WorkspacePath = Workspace.Path;
            Microsoft.Maui.Storage.Preferences.Default.Set("last-workspace",WorkspacePath);
            if(Workspace.MigratedFrom is { } source) Microsoft.Maui.Storage.Preferences.Default.Set(MigrationKey(source),WorkspacePath);
            Status = "本機後端已連線";
            feedStop = new CancellationTokenSource();
            feedTask = ListenAsync(http, feedStop.Token);
            Changed?.Invoke();
        }
        catch
        {
            Status = "工作區未開啟"; await StopInternalAsync(); Changed?.Invoke(); throw;
        }
        finally { lifecycle.Release(); }
    }

    public Task<T> GetAsync<T>(string url, CancellationToken cancellationToken = default) =>
        SendAsync<T>(HttpMethod.Get, url, null, cancellationToken);

    public async Task<T> SendAsync<T>(HttpMethod method, string url, object? body, CancellationToken cancellationToken = default)
    {
        var client = http ?? throw new InvalidOperationException("本機後端未連線。");
        using var request = new HttpRequestMessage(method, url);
        if(body is not null) request.Content = JsonContent.Create(body, options: Json);
        using var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken);
            try { text = JsonSerializer.Deserialize<ApiError>(text, Json)?.Message ?? text; } catch(JsonException) { }
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(text) ? $"操作失敗：{response.StatusCode}" : text);
        }
        return (await response.Content.ReadFromJsonAsync<T>(Json, cancellationToken))
            ?? throw new InvalidOperationException("後端回覆沒有資料。");
    }

    public async Task<OperationResult> CommandAsync(string url, object body, string operationId)
    {
        try { return await SendAsync<OperationResult>(HttpMethod.Post, url, body); }
        catch(HttpRequestException) { return await ResolveReceiptAsync(operationId); }
        catch(TaskCanceledException) { return await ResolveReceiptAsync(operationId); }
    }

    private async Task<OperationResult> ResolveReceiptAsync(string operationId)
    {
        try { return await GetAsync<OperationResult>("api/receipts/" + Uri.EscapeDataString(operationId)); }
        catch(Exception error) { throw new InvalidOperationException($"提交結果未明，操作 {operationId}。保留草稿並重新連線後查核，不能視為已取消。{error.Message}", error); }
    }

    public async Task RefreshWorkspaceAsync() { Workspace = await GetAsync<WorkspaceInfo>("api/workspace"); Changed?.Invoke(); }

    private async Task ListenAsync(HttpClient client, CancellationToken cancellationToken)
    {
        while(!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, "api/events");
                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                response.EnsureSuccessStatusCode();
                await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                using var reader = new StreamReader(stream);
                Status = "本機後端已連線"; Changed?.Invoke();
                while(await reader.ReadLineAsync(cancellationToken) is { } line)
                {
                    if(!line.StartsWith("data:", StringComparison.Ordinal)) continue;
                    var change = JsonSerializer.Deserialize<RevisionEvent>(line[5..].Trim(), Json);
                    if(change is not null) RevisionReceived?.Invoke(change);
                }
            }
            catch(OperationCanceledException) when(cancellationToken.IsCancellationRequested) { break; }
            catch(Exception error) { Status = "通知中斷，重連中：" + error.Message; Changed?.Invoke(); }
            try
            {
                await Task.Delay(1500, cancellationToken);
                var current = await GetAsync<WorkspaceInfo>("api/workspace", cancellationToken);
                Workspace = current;
                RevisionReceived?.Invoke(new RevisionEvent(current.Revision, [], current.PolicyRevision));
            }
            catch(OperationCanceledException) when(cancellationToken.IsCancellationRequested) { break; }
            catch(Exception) { }
        }
    }

    public async Task StopAsync()
    {
        await lifecycle.WaitAsync();
        try { await StopInternalAsync(); }
        finally { lifecycle.Release(); }
    }
    private async Task StopInternalAsync()
    {
        feedStop?.Cancel();
        if(http is not null)
        {
            try { Status="正在完成工作區備份…"; Changed?.Invoke(); using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30)); await http.PostAsync("api/shutdown", null, deadline.Token); }
            catch(Exception) { }
        }
        if(process is { HasExited: false })
        {
            using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try { await process.WaitForExitAsync(deadline.Token); }
            catch(OperationCanceledException) { /* Parent exit is also observed by Host; do not terminate an accepted transaction. */ }
        }
        if(feedTask is not null) { try { await feedTask; } catch(OperationCanceledException) { } }
        feedStop?.Dispose(); feedStop=null; feedTask=null; http?.Dispose(); http=null;
        process?.Dispose(); process=null; Workspace=null;
    }
    public async ValueTask DisposeAsync() { await StopAsync(); lifecycle.Dispose(); }
    private sealed record HostHello(int Port, string WorkspaceId, int ProtocolVersion);
}
