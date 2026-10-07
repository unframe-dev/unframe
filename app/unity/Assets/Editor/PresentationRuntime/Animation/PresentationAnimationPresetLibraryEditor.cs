using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEngine;

[CustomEditor(typeof(PresentationAnimationPresetLibrary))]
public sealed class PresentationAnimationPresetLibraryEditor : Editor
{
    public override void OnInspectorGUI()
    {
        DrawDefaultInspector();
        EditorGUILayout.Space();
        EditorGUILayout.LabelField("Built-in timeline IDs", EditorStyles.boldLabel);
        foreach (string timelineId in PresentationAnimationPresetIds.All)
        {
            EditorGUILayout.SelectableLabel(timelineId, EditorStyles.textField, GUILayout.Height(EditorGUIUtility.singleLineHeight));
        }

        EditorGUILayout.HelpBox(
            "追加する項目の Timeline Id を Delivery の runtimeCatalog.timelines[].timelineId と同じ値にします。",
            MessageType.Info);
    }
}
