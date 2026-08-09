using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

public sealed class PresentationActionJsonConverter : JsonConverter
{
    public override bool CanConvert(Type objectType)
    {
        return objectType == typeof(PresentationAction);
    }

    public override bool CanWrite => false;

    public override object ReadJson(
        JsonReader reader,
        Type objectType,
        object existingValue,
        JsonSerializer serializer
    )
    {
        JObject actionObject = JObject.Load(reader);
        PresentationAction action = new PresentationAction
        {
            targetId = (string)actionObject["targetId"],
            type = (string)actionObject["type"],
            transition = actionObject["transition"]?.ToObject<PresentationTransition>(serializer)
        };

        JToken value = actionObject["value"];
        if (value == null)
        {
            return action;
        }

        switch (value.Type)
        {
            case JTokenType.Boolean:
                action.boolValue = value.Value<bool>();
                break;
            case JTokenType.Float:
            case JTokenType.Integer:
                action.floatValue = value.Value<float>();
                break;
            case JTokenType.Array:
                action.vectorValue = value.ToObject<float[]>(serializer);
                break;
            case JTokenType.String:
                action.stringValue = value.Value<string>();
                break;
        }

        return action;
    }

    public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer)
    {
        throw new NotSupportedException();
    }
}
