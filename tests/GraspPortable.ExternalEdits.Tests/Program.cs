using GraspPortable.Core.Knowledge;
using GraspPortable.Core.ValueEngine;

var checks = 0;
var cases = new (string Name, string Accepted, string Observed, ExternalReferenceEditStatus Status, string? Value)[]
{
    ("pure multiline in enabled grasp fence", "```grasp\n[apple](:ref:Fruit)\n```", "```grasp\n[banana\n\nsecond paragraph](:ref:Fruit)\n```", ExternalReferenceEditStatus.Proposed, "banana\n\nsecond paragraph"),
    ("wiki multiline escapes", "😀 [@not-a-carrier]\r\n[[@Fruit|old]]", "😀 [@not-a-carrier]\r\n[[@Fruit|first\\]\r\n\r\nsecond\\|last]]", ExternalReferenceEditStatus.Proposed, "first]\r\n\r\nsecond|last"),
    ("both forms coherent", "[old](:ref:Fruit) / [[@Fruit|old]]", "[new](:ref:Fruit) / [[@Fruit|new]]", ExternalReferenceEditStatus.Proposed, "new"),
    ("old cache unchanged regardless of newer computed/transitive values", "[apple](:ref:Fruit)", "[apple](:ref:Fruit)", ExternalReferenceEditStatus.NoIntent, null),
    ("ordinary source only", "Before [old](:ref:Fruit)", "Edited before [old](:ref:Fruit)", ExternalReferenceEditStatus.NoIntent, null),
    ("mixed prose/value", "Before [old](:ref:Fruit)", "Edited before [new](:ref:Fruit)", ExternalReferenceEditStatus.NeedsReview, null),
    ("mixed definition/value", "@code{ @Fruit = {old} }\n\n[old](:ref:Fruit)", "@code{ @Fruit = {different} }\n\n[new](:ref:Fruit)", ExternalReferenceEditStatus.NeedsReview, null),
    ("target changed", "[old](:ref:Fruit)", "[new](:ref:Other)", ExternalReferenceEditStatus.Ambiguous, null),
    ("added occurrence", "[old](:ref:Fruit)", "[new](:ref:Fruit) [[@Fruit|new]]", ExternalReferenceEditStatus.Ambiguous, null),
    ("deleted occurrence", "[old](:ref:Fruit) [[@Fruit|old]]", "[new](:ref:Fruit)", ExternalReferenceEditStatus.Ambiguous, null),
    ("changed duplicates disagree", "[old](:ref:Fruit) [[@Fruit|old]]", "[one](:ref:Fruit) [[@Fruit|two]]", ExternalReferenceEditStatus.Ambiguous, null),
    ("unchanged duplicate old cache is not competing intent", "[old](:ref:Fruit) [[@Fruit|old]]", "[new](:ref:Fruit) [[@Fruit|old]]", ExternalReferenceEditStatus.Proposed, "new"),
    ("disabled fences remain examples", "```json\n[old](:ref:Fruit)\n```\n```grasp-demo\n[[@Fruit|old]]\n```", "```json\n[new](:ref:Fruit)\n```\n```grasp-demo\n[[@Fruit|new]]\n```", ExternalReferenceEditStatus.NoIntent, null),
    ("invalid observed retains parser diagnostic", "[[@Fruit|old]]", "[[@Fruit|bad\\q]]", ExternalReferenceEditStatus.Ambiguous, null),
    ("carrier kind changed", "[old](:ref:Fruit)", "[[@Fruit|new]]", ExternalReferenceEditStatus.Ambiguous, null)
};

foreach (var fixture in cases)
{
    var result = ExternalReferenceEdits.Classify(fixture.Accepted, fixture.Observed, ["", "grasp"]);
    Check(result.Status == fixture.Status, fixture.Name + ": status");
    Check(result.AcceptedSource == fixture.Accepted && result.ObservedSource == fixture.Observed, fixture.Name + ": exact source binding");
    if (fixture.Status == ExternalReferenceEditStatus.Proposed)
    {
        Check(result.Proposals.Count == 1 && result.Proposals[0].TargetName == "Fruit" && result.Proposals[0].ProposedValue == fixture.Value, fixture.Name + ": unique proposed logical value");
        foreach (var occurrence in result.Proposals[0].ChangedOccurrences)
        {
            var before = result.AcceptedSource.Substring(occurrence.AcceptedValueSpan.Start, occurrence.AcceptedValueSpan.Length);
            var after = result.ObservedSource.Substring(occurrence.ObservedValueSpan.Start, occurrence.ObservedValueSpan.Length);
            Check(before == ReferenceCodec.Encode(occurrence.AcceptedCachedValue), fixture.Name + ": accepted raw range");
            Check(after == ReferenceCodec.Encode(fixture.Value!), fixture.Name + ": observed UTF-16/raw range");
        }
        var expectedChanges = fixture.Name == "both forms coherent" ? 2 : 1;
        Check(result.Proposals[0].ChangedOccurrences.Count == expectedChanges, fixture.Name + ": occurrence pairing");
    }
    else Check(result.Proposals.Count == 0, fixture.Name + ": no actionable proposal on blocked/no-intent result");
    if (fixture.Status is ExternalReferenceEditStatus.Ambiguous or ExternalReferenceEditStatus.NeedsReview)
        Check(result.Diagnostics.Count > 0, fixture.Name + ": explicit reason");
    if (fixture.Name == "invalid observed retains parser diagnostic")
        Check(result.Diagnostics.Any(d => d.Code == "reference-value" && d.ObservedSpan is not null && d.AcceptedSpan is null), "observed diagnostic keeps parser code and source side");
}
Console.WriteLine($"External reference edits: {cases.Length} bounded fixtures, {checks} assertions passed.");
void Check(bool success, string message) { checks++; if (!success) throw new Exception(message); }
