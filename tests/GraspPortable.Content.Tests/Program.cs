using System.Diagnostics;
using GraspPortable.Contracts;
using GraspPortable.Host.Workspace;

try
{
var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../workspaces", "ContentTests-" + Guid.NewGuid().ToString("N")));
Directory.CreateDirectory(root);
var known = new List<WorkspaceContentSource>();
void FileAt(string relative, byte[] content)
{ var path = Path.Combine(root, relative); Directory.CreateDirectory(Path.GetDirectoryName(path)!); File.WriteAllBytes(path, content); }
void Note(string id, string path) { FileAt(path, "body"u8.ToArray()); known.Add(new(id, path)); }
Note("origin", "Notes/Origin.md"); Note("unicode", "其他/含 空格與中文.md");
Note("same-a", "Notes/Shared.md"); Note("same-b", "Shared.md"); Note("unique", "Other/Unique.md");
Note("dotted", "Other/Person.Job.md");
FileAt("Files/manual.pdf", "%PDF-test"u8.ToArray());
var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=");
FileAt("Files/圖片.png", png);
var resolver = new WorkspaceContentResolver(root, () => known);
var passed = 0;
void Check(bool value, string message) { if (!value) throw new Exception(message); Console.WriteLine("PASS " + message); passed++; }
ContentLinkDto Link(string target, bool wiki = false, string origin = "origin") => resolver.ResolveLink(new(origin, target, wiki));
ContentImageDto Image(string target, bool wiki = false, string origin = "origin") => resolver.ReadImage(new(origin, target, wiki));

var unicode = Link("../其他/" + Uri.EscapeDataString("含 空格與中文.md") + "#" + Uri.EscapeDataString("中文 heading"));
Check(unicode.Status == "resolved" && unicode.NoteId == "unicode" && unicode.Anchor == "中文 heading", "relative Unicode and percent-encoded path/heading");
Check(Link("#Local heading") is { Status: "resolved", NoteId: "origin", Anchor: "Local heading" }, "local heading resolves the source note");
Check(Link("#%5Eblock").Status == "unsupported", "block anchor is explicit unsupported");
Check(Link("./Shared.md").NoteId == "same-a", "explicit Markdown path keeps origin-relative meaning");
Check(Link("Shared.md").Status == "ambiguous", "bare Markdown path reports root-relative ambiguity");
Check(Link("Other/Unique.md").NoteId == "unique", "ordinary Markdown vault-root path resolves when unique");
Check(Link("Shared", true).Status == "ambiguous", "wiki basename and root-relative ambiguity is not guessed");
Check(Link("Unique", true).NoteId == "unique", "unique wiki basename finds a nested Markdown file");
Check(Link("Person.Job", true).NoteId == "dotted", "wiki note names containing dots can omit .md");
Check(Link("Other/Unique", true).NoteId == "unique", "wiki root-relative nested extensionless path");
Check(Link("./Shared", true).NoteId == "same-a", "explicit wiki relative path disambiguates root basename");
Check(Link("NoSuchNote", true).Status == "missing", "missing note is explicit");
FileAt("Group.md","group"u8.ToArray());
known.Add(new("group-a","Group.md",true,"Member A",["Inside A"],true));
known.Add(new("group-b","Group.md",true,"Member B",["Inside B"]));
Check(Link("../Group.md") is {Status:"resolved",NoteId:"group-a",Anchor:null},"unanchored group opens its explicit primary member");
Check(Link("../Group.md#Member B") is {Status:"resolved",NoteId:"group-b",Anchor:null},"presentation anchor opens exact member and consumes carrier heading");
Check(Link("../Group.md#Inside B") is {Status:"resolved",NoteId:"group-b",Anchor:"Inside B"},"unique body heading opens owning member with heading retained");
Check(Link("../Group.md#Unknown").Status=="ambiguous","unknown group anchor never silently opens primary");
known.Add(new("duplicate-group","Group.md",true,"Member B",["Inside A"]));
Check(Link("../Group.md#Member B").Status=="ambiguous","duplicate presentation is not guessed");
Check(Link("../Group.md#Inside A").Status=="ambiguous","duplicate body heading is not guessed");
known.RemoveAt(known.Count-1);
Check(Link("../Files/manual.pdf") is { Status: "resolved", NoteId: null, RelativePath: "Files/manual.pdf" }, "attachment resolves to path without launching it");
Check(Link("../Files/manual.pdf?download=1").Status == "unsupported", "query is not silently treated as filename");
Check(Link("#heading", origin: "unknown").Status == "missing", "unknown origin cannot resolve content");
Check(Image("../Files/圖片.png", origin: "unknown").Status == "missing", "unknown origin cannot read image bytes");
foreach (var target in new[] { "../../outside.png", "..%2f..%2foutside.png", "https://example.invalid/a.png", "data:image/png;base64,AA==", "file:///C:/test.png", @"\\server\share\a.png", "C:/a.png", "%68ttps%3A//example.invalid/a.png" })
    Check(Image(target).Status == "unsupported", "reject external/escaping image " + target);
Check(Link("bad%ZZ.md").Status == "unsupported", "malformed percent escape is not guessed");
foreach (var folder in new[] { ".grasp", ".git", ".obsidian", "artifacts" })
{
    FileAt(folder + "/Private.md", "secret"u8.ToArray());
    Check(Link("../" + folder + "/Private.md").Status == "unsupported", "direct internal path excluded: " + folder);
}
Check(Link("Private", true).Status == "missing", "wiki search does not traverse internal folders");
FileAt("workspace.grasp.db", [1, 2]);
Check(Link("../workspace.grasp.db").Status == "unsupported", "database is not an attachment");
var image = Image("../Files/" + Uri.EscapeDataString("圖片.png"));
Check(image.Status == "resolved" && image.DataUrl == "data:image/png;base64," + Convert.ToBase64String(png), "valid image returns the exact stable bytes as data URL");
Check(Image("../Files/圖片.png#part").Status == "unsupported", "image fragments are explicit unsupported");
FileAt("Files/fake.png", "<script>not image</script>"u8.ToArray());
Check(Image("../Files/fake.png").Status == "unsupported", "extension without matching magic is refused");
FileAt("Files/active.svg", "<svg/>"u8.ToArray());
Check(Image("../Files/active.svg").Status == "unsupported", "SVG is outside the raster allowlist");
foreach (var pair in new Dictionary<string, byte[]> { ["jpg"] = [255,216,255,224], ["gif"] = "GIF89a"u8.ToArray(), ["webp"] = "RIFF1234WEBP"u8.ToArray(), ["bmp"] = "BM1234"u8.ToArray() })
{
    FileAt("Files/magic." + pair.Key, pair.Value);
    Check(Image("../Files/magic." + pair.Key).Status == "resolved", "allowlisted raster magic: " + pair.Key);
}
var large = new byte[8 * 1024 * 1024 + 1]; png.CopyTo(large, 0); FileAt("Files/large.png", large);
Check(Image("../Files/large.png").Status == "unsupported", "8 MiB image cap enforced before base64 allocation");
using (var writer = new FileStream(Path.Combine(root, "Files/圖片.png"), FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
    Check(Image("../Files/圖片.png").Status == "unsupported", "concurrent writer cannot produce a mixed image snapshot");

var outside = root + "-outside"; Directory.CreateDirectory(outside); File.WriteAllBytes(Path.Combine(outside, "outside.png"), png);
var link = Path.Combine(root, "Linked");
try { Directory.CreateSymbolicLink(link, outside); }
catch (Exception error) when (OperatingSystem.IsWindows() && error is IOException or UnauthorizedAccessException)
{
    var start = new ProcessStartInfo("cmd.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
    foreach (var argument in new[] { "/d", "/c", "mklink", "/J", link, outside }) start.ArgumentList.Add(argument);
    using var process = Process.Start(start)!; process.WaitForExit();
    if (process.ExitCode != 0) throw new IOException(process.StandardError.ReadToEnd());
}
Check(Image("../Linked/outside.png").Status == "unsupported", "direct reparse path cannot read outside content");
Check(Image("outside.png", true).Status == "missing", "wiki discovery does not follow reparse folders");
Check(File.ReadAllBytes(Path.Combine(outside, "outside.png")).SequenceEqual(png), "outside file remains unchanged");
Console.WriteLine($"PASS: {passed} content assertions. Evidence: {root}");
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
return 0;
