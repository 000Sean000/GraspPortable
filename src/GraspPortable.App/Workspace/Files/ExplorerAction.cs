using GraspPortable.Contracts;

namespace GraspPortable.App.Workspace.Files;

// New-note / new-folder target the destination directory (empty RelativePath means root).
// All other actions target the exact entry on which the menu was opened.
public record ExplorerAction(string Action, WorkspaceFileEntry Target);
