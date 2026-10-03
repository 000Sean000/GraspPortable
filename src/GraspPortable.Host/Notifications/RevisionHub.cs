using System.Collections.Concurrent;
using System.Threading.Channels;
using GraspPortable.Core.Knowledge;

namespace GraspPortable.Host.Notifications;

public sealed class RevisionHub
{
    private readonly ConcurrentDictionary<Guid, Channel<ChangeNotice>> listeners = new();
    public void Publish(ChangeNotice notice) { foreach (var channel in listeners.Values) channel.Writer.TryWrite(notice); }
    public (Guid Id, ChannelReader<ChangeNotice> Reader) Subscribe()
    {
        var id = Guid.NewGuid();
        // Coalescing is safe: clients recover a revision gap by reading the current snapshot.
        var channel = Channel.CreateBounded<ChangeNotice>(new BoundedChannelOptions(16) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
        listeners[id] = channel; return (id, channel.Reader);
    }
    public void Unsubscribe(Guid id) { if (listeners.TryRemove(id, out var channel)) channel.Writer.TryComplete(); }
}
