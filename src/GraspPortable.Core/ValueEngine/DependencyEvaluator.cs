using System.Text;

namespace GraspPortable.Core.ValueEngine;

public static class DependencyEvaluator
{
    /// <summary>
    /// Evaluates a workspace snapshot without recursion. Literal order and repeated references are preserved.
    /// A caller supplying a previous snapshot must include changed/added/removed names and their transitive
    /// dependants in affectedNames. Unaffected valid values are reused; errors are reclassified against current spans.
    /// </summary>
    public static EvaluationResult Evaluate(IEnumerable<Definition> definitions,
        CancellationToken cancellationToken = default, int maxValueLength = 4_000_000,
        long maxTotalValueLength = 32_000_000,
        IReadOnlyDictionary<string, EvaluatedValue>? previousValues = null,
        IReadOnlySet<string>? affectedNames = null)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxValueLength);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxTotalValueLength);
        long totalValueLength = 0;
        var nodes = new Dictionary<string, Definition>(StringComparer.Ordinal);
        var values = new Dictionary<string, EvaluatedValue>(StringComparer.Ordinal);
        var diagnostics = new List<ParseDiagnostic>();
        foreach (var definition in definitions)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (nodes.TryAdd(definition.Name, definition)) continue;
            values[definition.Name] = new(null, EvaluationStatus.Duplicate);
            diagnostics.Add(new("duplicate", $"{definition.Name} 有多個 definition。", definition.NameSpan));
        }
        var dependencies = new Dictionary<string, string[]>(StringComparer.Ordinal);
        var dependants = nodes.Keys.ToDictionary(key => key, _ => new List<string>(), StringComparer.Ordinal);
        foreach (var (name, definition) in nodes)
        {
            var names = definition.Parts.Where(part => part.Kind == PartKind.Identifier)
                .Select(part => part.Text).Distinct(StringComparer.Ordinal).ToArray();
            dependencies[name] = names;
            foreach (var dependency in names)
                if (dependants.TryGetValue(dependency, out var targets)) targets.Add(name);
        }
        foreach (var cycle in FindCycleMembers(dependencies, dependants, cancellationToken))
        {
            if (values.ContainsKey(cycle)) continue;
            values[cycle] = new(null, EvaluationStatus.Cycle);
            diagnostics.Add(new("cycle", $"{cycle} 參與循環相依。", nodes[cycle].NameSpan));
        }
        var remaining = new Dictionary<string, int>(StringComparer.Ordinal);
        var queue = new Queue<string>();
        foreach (var name in nodes.Keys)
        {
            if (values.ContainsKey(name)) continue;
            remaining[name] = dependencies[name].Count(dependency => nodes.ContainsKey(dependency) && !values.ContainsKey(dependency));
            if (remaining[name] == 0) queue.Enqueue(name);
        }
        while (queue.TryDequeue(out var name))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var definition = nodes[name];
            EvaluatedValue? reused = null;
            if (previousValues is not null && affectedNames is not null && !affectedNames.Contains(name)
                && previousValues.TryGetValue(name, out var previous)
                && previous.Status == EvaluationStatus.Valid && previous.Value is not null
                && dependencies[name].All(dependency => values.TryGetValue(dependency, out var current) && current.Status == EvaluationStatus.Valid))
                reused = previous;
            var builder = reused is null ? new StringBuilder() : null;
            var status = EvaluationStatus.Valid;
            foreach (var part in reused is null ? definition.Parts : [])
            {
                cancellationToken.ThrowIfCancellationRequested();
                var text = part.Text;
                if (part.Kind == PartKind.Identifier)
                {
                    if (!values.TryGetValue(part.Text, out var dependency))
                    {
                        status = EvaluationStatus.Missing;
                        diagnostics.Add(new("missing", $"{part.Text} 尚未定義。", part.Span));
                        break;
                    }
                    if (dependency.Status != EvaluationStatus.Valid)
                    {
                        status = EvaluationStatus.DependencyError;
                        diagnostics.Add(new("dependency", $"{name} 的相依 {part.Text} 尚無有效值。", part.Span));
                        break;
                    }
                    text = dependency.Value!;
                }
                if (text.Length > maxValueLength - builder!.Length)
                {
                    status = EvaluationStatus.ResourceLimit;
                    diagnostics.Add(new("resource-limit", $"{name} 的展開值超過 {maxValueLength} 個 UTF-16 字元，未截斷為成功。", definition.ExpressionSpan));
                    break;
                }
                builder.Append(text);
            }
            var valueLength = reused?.Value!.Length ?? builder!.Length;
            if (status == EvaluationStatus.Valid && valueLength > maxValueLength)
            {
                status = EvaluationStatus.ResourceLimit;
                diagnostics.Add(new("resource-limit", $"{name} 的展開值超過 {maxValueLength} 個 UTF-16 字元，未截斷為成功。", definition.ExpressionSpan));
            }
            if (status == EvaluationStatus.Valid && valueLength > maxTotalValueLength - totalValueLength)
            {
                status = EvaluationStatus.ResourceLimit;
                diagnostics.Add(new("resource-limit", "本次計算展開值的總量超出資源上限，未發布截斷值。", definition.ExpressionSpan));
            }
            if (status == EvaluationStatus.Valid) totalValueLength += valueLength;
            values[name] = status == EvaluationStatus.Valid
                ? reused ?? new(builder!.ToString(), status)
                : new(null, status);
            foreach (var dependant in dependants[name])
                if (remaining.TryGetValue(dependant, out var count) && count > 0)
                {
                    remaining[dependant] = count - 1;
                    if (count == 1) queue.Enqueue(dependant);
                }
        }
        return new(values, diagnostics);
    }

    private static HashSet<string> FindCycleMembers(Dictionary<string, string[]> graph,
        Dictionary<string, List<string>> reverse, CancellationToken token)
    {
        var visited = new HashSet<string>(StringComparer.Ordinal);
        var finishOrder = new List<string>(graph.Count);
        foreach (var root in graph.Keys)
        {
            if (!visited.Add(root)) continue;
            var stack = new Stack<(string Name, int Child)>();
            stack.Push((root, 0));
            while (stack.TryPop(out var frame))
            {
                token.ThrowIfCancellationRequested();
                var children = graph[frame.Name];
                if (frame.Child >= children.Length) { finishOrder.Add(frame.Name); continue; }
                stack.Push((frame.Name, frame.Child + 1));
                var child = children[frame.Child];
                if (graph.ContainsKey(child) && visited.Add(child)) stack.Push((child, 0));
            }
        }
        visited.Clear();
        var cycles = new HashSet<string>(StringComparer.Ordinal);
        for (var index = finishOrder.Count - 1; index >= 0; index--)
        {
            var root = finishOrder[index];
            if (!visited.Add(root)) continue;
            var component = new List<string>();
            var stack = new Stack<string>();
            stack.Push(root);
            while (stack.TryPop(out var name))
            {
                token.ThrowIfCancellationRequested();
                component.Add(name);
                foreach (var parent in reverse[name]) if (visited.Add(parent)) stack.Push(parent);
            }
            if (component.Count > 1 || graph[root].Contains(root, StringComparer.Ordinal)) cycles.UnionWith(component);
        }
        return cycles;
    }
}
