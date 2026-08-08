using UnityEngine;

public sealed class UnityJsonPresentationDefinitionParser : IPresentationDefinitionParser
{
    public bool TryParse(string json, out PresentationDocument document, out string error)
    {
        document = null;
        error = null;

        if (string.IsNullOrWhiteSpace(json))
        {
            error = "JSON is empty.";
            return false;
        }

        try
        {
            document = JsonUtility.FromJson<PresentationDocument>(json);
        }
        catch (System.ArgumentException exception)
        {
            error = exception.Message;
            return false;
        }

        if (document == null || document.presentation == null)
        {
            error = "presentation is missing.";
            return false;
        }

        PresentationActionValueParser.Apply(json, document);
        return true;
    }
}
