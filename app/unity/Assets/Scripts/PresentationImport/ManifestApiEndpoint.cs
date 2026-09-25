using System;

public static class ManifestApiEndpoint
{
    public static bool TryBuildUrl(
        string baseUrl,
        string presentationId,
        out string manifestUrl,
        out string error
    )
    {
        manifestUrl = null;
        error = null;

        if (string.IsNullOrWhiteSpace(baseUrl))
        {
            error = "baseUrl is required.";
            return false;
        }

        string normalizedBaseUrl = baseUrl.Trim().TrimEnd('/') + "/";
        if (!Uri.TryCreate(normalizedBaseUrl, UriKind.Absolute, out Uri baseUri) ||
            (baseUri.Scheme != Uri.UriSchemeHttp && baseUri.Scheme != Uri.UriSchemeHttps))
        {
            error = "baseUrl must be an absolute HTTP(S) URL.";
            return false;
        }

        if (!Guid.TryParse(presentationId, out _))
        {
            error = "presentationId must be a UUID.";
            return false;
        }

        manifestUrl = new Uri(
            baseUri,
            $"presentations/{Uri.EscapeDataString(presentationId)}/manifest"
        ).AbsoluteUri;
        return true;
    }
}
