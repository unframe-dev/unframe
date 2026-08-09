using Newtonsoft.Json;

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
            document = JsonConvert.DeserializeObject<PresentationDocument>(
                json,
                new JsonSerializerSettings
                {
                    Converters = { new PresentationActionJsonConverter() }
                }
            );
        }
        catch (JsonException exception)
        {
            error = exception.Message;
            return false;
        }

        if (document == null || document.presentation == null)
        {
            error = "presentation is missing.";
            return false;
        }

        return true;
    }
}
