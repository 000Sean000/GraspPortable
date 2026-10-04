try
{
    try
    {
        if (args.Contains("--fail", StringComparer.Ordinal))
            throw new InvalidOperationException("Controlled test-entry failure; expected exit code 1.");
        Console.WriteLine("PASS test entry normal exit.");
    }
    finally { Console.Error.WriteLine("TEST_ENTRY_FINALLY_EXECUTED"); }
}
catch (Exception error)
{
    return GraspPortable.TestSupport.ConsoleTestFailure.Report(error);
}
return 0;
