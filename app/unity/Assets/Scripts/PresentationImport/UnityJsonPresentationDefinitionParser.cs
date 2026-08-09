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

        if (!TryValidateCueIds(document.presentation, out error))
        {
            document = null;
            return false;
        }

        return true;
    }

    private static bool TryValidateCueIds(PresentationData presentation, out string error)
    {
        if (presentation.groups != null)
        {
            foreach (PresentationGroup group in presentation.groups)
            {
                if (group?.steps == null)
                {
                    continue;
                }

                foreach (PresentationStep step in group.steps)
                {
                    if (step?.cues == null)
                    {
                        continue;
                    }

                    foreach (PresentationCue cue in step.cues)
                    {
                        if (cue == null || string.IsNullOrWhiteSpace(cue.id))
                        {
                            error = "Every cue requires a non-empty id.";
                            return false;
                        }
                    }
                }
            }
        }

        error = null;
        return true;
    }
}
