public interface IPresentationDefinitionParser
{
    bool TryParse(string json, out PresentationDocument document, out string error);
}
