using System;
using Google.Protobuf;
using Unframe.Delivery.V2;
using Unframe.Realtime.V2;

namespace Unframe.Unity.PresentationRuntime
{
    /// <summary>
    /// Decodes local fixtures through the protobuf JSON mapping without introducing a Unity-specific schema.
    /// </summary>
    public static class PresentationContractJsonFixtureLoader
    {
        private static readonly JsonParser Parser = new JsonParser(JsonParser.Settings.Default.WithIgnoreUnknownFields(false));

        public static bool TryParseDelivery(string json, out DeliveryManifest manifest, out string error)
        {
            return TryParse(json, out manifest, out error);
        }

        public static bool TryParseControlItem(string json, out ControlServerItem item, out string error)
        {
            return TryParse(json, out item, out error);
        }

        public static bool TryParseStateItem(string json, out StateServerItem item, out string error)
        {
            return TryParse(json, out item, out error);
        }

        private static bool TryParse<T>(string json, out T value, out string error) where T : class, IMessage<T>, new()
        {
            value = null;
            if (String.IsNullOrWhiteSpace(json))
            {
                error = "fixture JSON is empty.";
                return false;
            }

            try
            {
                value = Parser.Parse<T>(json);
                error = null;
                return true;
            }
            catch (InvalidProtocolBufferException exception)
            {
                error = "fixture JSON is invalid: " + exception.Message;
                return false;
            }
        }
    }
}
