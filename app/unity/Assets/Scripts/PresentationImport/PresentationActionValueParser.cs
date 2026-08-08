using System;
using System.Collections.Generic;
using UnityEngine;

public static class PresentationActionValueParser
{
    public static void Apply(string json, PresentationDocument document)
    {
        if (document?.presentation?.groups == null)
        {
            return;
        }

        List<string> actionObjects = ExtractActionObjects(json);
        int actionIndex = 0;
        foreach (PresentationGroup group in document.presentation.groups)
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
                    if (cue?.actions == null)
                    {
                        continue;
                    }

                    foreach (PresentationAction action in cue.actions)
                    {
                        if (actionIndex >= actionObjects.Count)
                        {
                            return;
                        }

                        ApplyValue(action, actionObjects[actionIndex]);
                        actionIndex++;
                    }
                }
            }
        }
    }

    private static List<string> ExtractActionObjects(string json)
    {
        List<string> objects = new List<string>();
        if (string.IsNullOrEmpty(json))
        {
            return objects;
        }

        int searchStart = 0;
        while (TryFindProperty(json, "actions", searchStart, out int keyEnd, out int valueStart))
        {
            if (valueStart >= json.Length || json[valueStart] != '[')
            {
                searchStart = keyEnd;
                continue;
            }

            int arrayEnd = FindMatching(json, valueStart, '[', ']');
            if (arrayEnd < 0)
            {
                break;
            }

            int cursor = valueStart + 1;
            while (cursor < arrayEnd)
            {
                cursor = SkipWhitespace(json, cursor);
                if (cursor >= arrayEnd)
                {
                    break;
                }

                if (json[cursor] == '{')
                {
                    int objectEnd = FindMatching(json, cursor, '{', '}');
                    if (objectEnd < 0 || objectEnd > arrayEnd)
                    {
                        break;
                    }

                    objects.Add(json.Substring(cursor, objectEnd - cursor + 1));
                    cursor = objectEnd + 1;
                }
                else
                {
                    cursor++;
                }
            }

            searchStart = arrayEnd + 1;
        }

        return objects;
    }

    private static void ApplyValue(PresentationAction action, string actionJson)
    {
        if (!TryFindProperty(actionJson, "value", 0, out _, out int valueStart))
        {
            return;
        }

        string rawValue = ReadValue(actionJson, valueStart);
        if (string.IsNullOrEmpty(rawValue))
        {
            return;
        }

        if (rawValue[0] == '[')
        {
            action.vectorValue = JsonUtility.FromJson<FloatArrayValue>(
                $"{{\"value\":{rawValue}}}"
            ).value;
            return;
        }

        if (rawValue == "true" || rawValue == "false")
        {
            action.boolValue = rawValue == "true";
            return;
        }

        if (float.TryParse(
                rawValue,
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture,
                out float floatValue
            ))
        {
            action.floatValue = floatValue;
        }
    }

    private static bool TryFindProperty(
        string json,
        string propertyName,
        int searchStart,
        out int keyEnd,
        out int valueStart
    )
    {
        string property = $"\"{propertyName}\"";
        int keyStart = json.IndexOf(property, searchStart, StringComparison.Ordinal);
        if (keyStart < 0)
        {
            keyEnd = -1;
            valueStart = -1;
            return false;
        }

        keyEnd = keyStart + property.Length;
        int colon = SkipWhitespace(json, keyEnd);
        if (colon >= json.Length || json[colon] != ':')
        {
            valueStart = -1;
            return false;
        }

        valueStart = SkipWhitespace(json, colon + 1);
        return valueStart < json.Length;
    }

    private static string ReadValue(string json, int valueStart)
    {
        char first = json[valueStart];
        if (first == '[')
        {
            int end = FindMatching(json, valueStart, '[', ']');
            return end < 0 ? null : json.Substring(valueStart, end - valueStart + 1);
        }

        int cursor = valueStart;
        while (cursor < json.Length && json[cursor] != ',' && json[cursor] != '}')
        {
            cursor++;
        }

        return json.Substring(valueStart, cursor - valueStart).Trim();
    }

    private static int SkipWhitespace(string json, int index)
    {
        while (index < json.Length && char.IsWhiteSpace(json[index]))
        {
            index++;
        }

        return index;
    }

    private static int FindMatching(string json, int start, char open, char close)
    {
        int depth = 0;
        bool inString = false;
        bool escaped = false;

        for (int index = start; index < json.Length; index++)
        {
            char current = json[index];
            if (inString)
            {
                if (escaped)
                {
                    escaped = false;
                }
                else if (current == '\\')
                {
                    escaped = true;
                }
                else if (current == '\"')
                {
                    inString = false;
                }

                continue;
            }

            if (current == '\"')
            {
                inString = true;
            }
            else if (current == open)
            {
                depth++;
            }
            else if (current == close && --depth == 0)
            {
                return index;
            }
        }

        return -1;
    }

    [Serializable]
    private sealed class FloatArrayValue
    {
        public float[] value;
    }
}
