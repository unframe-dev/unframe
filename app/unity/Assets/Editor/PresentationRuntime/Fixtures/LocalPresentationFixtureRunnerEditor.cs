using Unframe.Unity.PresentationRuntime;
using UnityEditor;
using UnityEngine;

[CustomEditor(typeof(LocalPresentationFixtureRunner))]
public sealed class LocalPresentationFixtureRunnerEditor : Editor
{
    public override void OnInspectorGUI()
    {
        DrawDefaultInspector();
        EditorGUILayout.Space();

        LocalPresentationFixtureRunner runner = (LocalPresentationFixtureRunner)target;
        if (runner.HasLoadedFixture)
        {
            EditorGUILayout.LabelField("Progress", runner.AppliedEventCount + " / " + runner.ReliableEventCount);
            if (runner.IsAnimating)
            {
                EditorGUILayout.HelpBox("Timelineを再生中です。完了すると次の入力を受け付けます。", MessageType.Info);
            }
        }

        if (GUILayout.Button("Load Local Presentation"))
        {
            Run(runner.TryLoad);
        }

        using (new EditorGUI.DisabledScope(!runner.CanAdvance))
        {
            if (GUILayout.Button("Advance Local Presentation"))
            {
                Run(runner.TryAdvance);
            }
        }

        if (GUILayout.Button("Clear Local Presentation"))
        {
            runner.Clear();
        }

        EditorGUILayout.HelpBox(
            "空欄のままでは Resources/PresentationFixtures の契約JSONを使用します。35項目をSpace/EnterキーまたはAdvanceボタンで1項目ずつ進めます。仮テキスト・パネル・立方体の表示を確認できます。基本はフェード切替で、一部に上下左右・奥行き方向の移動や回転配置があります。アニメーション完了後に次の入力を行ってください。",
            MessageType.Info);
    }

    private static void Run(LocalPresentationOperation operation)
    {
        if (!operation(out string error))
        {
            Debug.LogError("[Presentation] " + error);
        }
    }

    private delegate bool LocalPresentationOperation(out string error);
}
