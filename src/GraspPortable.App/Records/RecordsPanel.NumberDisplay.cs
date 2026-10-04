using System.Globalization;

namespace GraspPortable.App.Records;

public partial class RecordsPanel
{
    // Presentation only: coefficient * 10^-scale, without floating-point conversion.
    // Bound inserted zeros; scientific notation retains every significant digit.
    internal static string FormatNumber(string coefficient, int scale)
    {
        const int maximumPlainLength = 64;
        var negative = coefficient.StartsWith('-');
        var start = coefficient.StartsWith('+') || negative ? 1 : 0;
        if (start == coefficient.Length || coefficient.AsSpan(start).ContainsAnyExceptInRange('0', '9'))
            return coefficient + "e" + (-(long)scale).ToString(CultureInfo.InvariantCulture);
        while (start < coefficient.Length && coefficient[start] == '0') start++;
        if (start == coefficient.Length) return "0";
        var end = coefficient.Length;
        while (end > start + 1 && coefficient[end - 1] == '0') end--;
        var effectiveScale = (long)scale - (coefficient.Length - end);
        var digits = coefficient[start..end];
        var sign = negative ? "-" : "";
        var integerLength = digits.Length - effectiveScale;
        var plainLength = sign.Length + (effectiveScale <= 0 ? integerLength
            : integerLength > 0 ? digits.Length + 1L : 2L + effectiveScale);
        if (plainLength <= maximumPlainLength)
        {
            if (effectiveScale <= 0) return sign + digits + new string('0', (int)-effectiveScale);
            if (integerLength > 0) return sign + digits.Insert((int)integerLength, ".");
            return sign + "0." + new string('0', (int)-integerLength) + digits;
        }
        var mantissa = digits.Length == 1 ? digits : digits.Insert(1, ".");
        return sign + mantissa + "e" + (integerLength - 1).ToString(CultureInfo.InvariantCulture);
    }
}
