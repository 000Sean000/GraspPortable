namespace GraspPortable.TestSupport;

/// <summary>
/// Called by the outer test-entry catch after normal stack unwinding. A failed assertion still
/// prints the complete exception and exits unsuccessfully, without becoming an unhandled CLR crash.
/// This is not linked into product executables and does not intercept their crashes or FailFast.
/// </summary>
internal static class ConsoleTestFailure
{
    public static int Report(Exception error)
    {
        Console.Error.WriteLine($"FAIL {AppDomain.CurrentDomain.FriendlyName}: {error}");
        return 1;
    }
}
