using System.IO;
using UnityEditor;
using UnityEngine;

public static class PresentationTestFixtures
{
    private const string DirectoryPath = "Assets/Tests/EditMode/Editor/FixturesData/";

    public static TextAsset Load(string name)
    {
        TextAsset fixture = AssetDatabase.LoadAssetAtPath<TextAsset>(DirectoryPath + name + ".json");
        if (fixture == null) fixture = AssetDatabase.LoadAssetAtPath<TextAsset>(DirectoryPath + name + ".bytes");
        if (fixture == null) throw new FileNotFoundException("Presentation test fixture was not found.", name);
        return fixture;
    }
}
