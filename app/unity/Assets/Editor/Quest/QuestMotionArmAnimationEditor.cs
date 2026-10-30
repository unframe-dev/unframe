using System;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class QuestMotionArmAnimationEditor
{
    private const string Folder = "Assets/Resources/PresentationUi/MotionArms/Editable";

    [MenuItem("Unframe/Presentation/Open Arm Animation Editor")]
    public static void Open()
    {
        string selected = AssetDatabase.GetAssetPath(Selection.activeObject);
        OpenSide(selected.StartsWith(Folder + "/Right", StringComparison.Ordinal)
            || selected.StartsWith(Folder + "/Clips/Right", StringComparison.Ordinal));
    }

    [MenuItem("Unframe/Presentation/Open Right Arm Animation Editor")]
    public static void OpenRight() => OpenSide(true);

    private static void OpenSide(bool right)
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode)
            throw new InvalidOperationException("Stop Play mode before editing arm animations.");
        string path = Folder + "/" + (right ? "Right" : "Left") + "MotionArm.prefab";
        if (AssetDatabase.LoadAssetAtPath<GameObject>(path) == null)
            throw new InvalidOperationException("The editable arm prefab is missing: " + path);
        PrefabStage stage = PrefabStageUtility.OpenPrefab(path);
        Selection.activeGameObject = stage.prefabContentsRoot;
        EditorApplication.ExecuteMenuItem("Window/Animation/Animation");
    }
}
