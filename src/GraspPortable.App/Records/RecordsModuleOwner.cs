using Microsoft.JSInterop;

namespace GraspPortable.App.Records;

/// <summary>One panel owns one import; cell leases keep it alive through their JS cleanup.</summary>
public sealed class RecordsModuleOwner(IJSRuntime js) : IAsyncDisposable
{
    private readonly object gate = new();
    private Task<IJSObjectReference>? import;
    private Task? disposal;
    private int references = 1; // Parent ownership.
    private bool closed;

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
        internal Lease(RecordsModuleOwner owner) => this.owner = owner;

        public Task<IJSObjectReference> GetAsync()
        {
            lock (gate)
            {
                ObjectDisposedException.ThrowIf(release is not null, this);
                lock (owner.gate) return owner.GetModule();
            }
        }

        public ValueTask DisposeAsync()
        {
            lock (gate) return new(release ??= owner.Release());
        }
    }
}
