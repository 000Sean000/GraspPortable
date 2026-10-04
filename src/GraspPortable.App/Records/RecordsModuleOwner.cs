using Microsoft.JSInterop;
using Microsoft.AspNetCore.Components;
using GraspPortable.Contracts;

namespace GraspPortable.App.Records;

/// <summary>One panel owns one import; cell leases keep it alive through their JS cleanup.</summary>
public sealed class RecordsModuleOwner(IJSRuntime js) : IAsyncDisposable
{
    private readonly object gate = new();
    private Task<IJSObjectReference>? import;
    private Task? disposal;
    private int references = 1; // Parent ownership.
    private bool closed;
    private readonly Dictionary<Lease, PendingCommand> pending = [];
    private bool pumping;
    private sealed record MarkdownCommand(string Operation, ElementReference Element, string? Markdown = null,
        string? Origin = null, object? Receiver = null, long Generation = 0, ReferenceDto[]? References = null, RegionDto[]? Regions = null);
    private sealed record PendingCommand(Lease Lease, MarkdownCommand Command, TaskCompletionSource Completion);

    private Task Enqueue(Lease lease, MarkdownCommand command)
    {
        lock (gate)
        {
            // A newer generation or cleanup replaces only this cell's undispatched work.
            if (pending.Remove(lease, out var previous)) previous.Completion.TrySetResult();
            var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            pending[lease] = new(lease, command, completion);
            if (!pumping) { pumping = true; _ = PumpAsync(); }
            return completion.Task;
        }
    }

    private async Task PumpAsync()
    {
        // Collect sibling OnAfterRender callbacks before crossing the WebView boundary.
        await Task.Yield();
        PendingCommand[] batch = [];
        try
        {
            IJSObjectReference module;
            Task<IJSObjectReference> loading;
            lock (gate) loading = GetModule();
            module = await loading;
            while (true)
            {
                lock (gate)
                {
                    batch = pending.Values.ToArray(); pending.Clear();
                    if (batch.Length == 0) { pumping = false; return; }
                }
                var active = batch.Where(item => item.Command.Operation == "dispose" || !item.Lease.Closing).ToArray();
                foreach (var canceled in batch.Except(active)) canceled.Completion.TrySetResult();
                if (active.Length != 0)
                {
                    var results = await module.InvokeAsync<bool[]>("applyMarkdownBatch", new object?[] { active.Select(item => item.Command).ToArray() });
                    for (var index = 0; index < active.Length; index++)
                        if (index < results.Length && results[index]) active[index].Completion.TrySetResult();
                        else active[index].Completion.TrySetException(new JSException("Records Markdown batch command failed."));
                }
                batch = [];
            }
        }
        catch (Exception error)
        {
            lock (gate)
            {
                foreach (var item in batch.Concat(pending.Values)) item.Completion.TrySetException(error);
                pending.Clear(); pumping = false;
            }
        }
    }

    public Lease Acquire()
    {
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(closed, this);
            references++;
            return new(this);
        }
    }

    public Task<IJSObjectReference> GetAsync()
    {
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(closed, this);
            return GetModule();
        }
    }

    // Called under gate; a live lease can still finish cleanup after the parent closes.
    private Task<IJSObjectReference> GetModule() => import ??= ImportAsync();
    private async Task<IJSObjectReference> ImportAsync()
        => await js.InvokeAsync<IJSObjectReference>("import", "./Records/RecordsPanel.razor.js");

    private Task Release()
    {
        lock (gate)
        {
            references--;
            if (references != 0) return Task.CompletedTask;
            return disposal ??= DisposeModuleAsync(import);
        }
    }

    private static async Task DisposeModuleAsync(Task<IJSObjectReference>? pending)
    {
        if (pending is null) return;
        IJSObjectReference module;
        try { module = await pending; }
        catch (Exception) { return; } // Faulted import produced no reference to release.
        try { await module.DisposeAsync(); }
        catch (JSDisconnectedException) { }
    }

    public ValueTask DisposeAsync()
    {
        lock (gate)
        {
            if (closed) return new(disposal ?? Task.CompletedTask);
            closed = true;
            // Do not wait for live cells: Blazor may dispose them after their parent.
            return new(Release());
        }
    }

    public sealed class Lease : IAsyncDisposable
    {
        private readonly RecordsModuleOwner owner;
        private readonly object gate = new();
        private Task? release;
        private Task? latest;
        private bool cleaning;
        private volatile bool closing;
        internal bool Closing => closing;
        internal Lease(RecordsModuleOwner owner) => this.owner = owner;

        public Task<IJSObjectReference> GetAsync()
        {
            lock (gate)
            {
                ObjectDisposedException.ThrowIf(release is not null, this);
                lock (owner.gate) return owner.GetModule();
            }
        }

        public Task RenderAsync(ElementReference element, string markdown, string origin, object receiver, long generation,
            ReferenceDto[] references, RegionDto[] regions)
        {
            lock (gate)
            {
                ObjectDisposedException.ThrowIf(closing || cleaning, this);
                return latest = owner.Enqueue(this, new("render", element, markdown, origin, receiver, generation, references, regions));
            }
        }

        public Task DisposeMarkdownAsync(ElementReference element)
        {
            lock (gate)
            {
                ObjectDisposedException.ThrowIf(closing, this);
                if (cleaning) return latest!;
                cleaning = true;
                return latest = owner.Enqueue(this, new("dispose", element));
            }
        }

        public ValueTask DisposeAsync()
        {
            lock (gate)
            {
                if (release is not null) return new(release);
                closing = true;
                return new(release = ReleaseAfterWorkAsync());
            }
        }

        private async Task ReleaseAfterWorkAsync()
        {
            try { if (latest is not null) await latest; }
            catch (Exception) { } // The command's own caller observes its failure; release must still finish.
            finally { await owner.Release(); }
        }
    }
}
