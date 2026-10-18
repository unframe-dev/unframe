using System;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.Build;

public sealed class PassthroughCameraDiagnosticBuildSettingsTests
{
    [TestCase(false)]
    [TestCase(true)]
    public void DiagnosticSettingsAreTemporaryEvenWhenBuildFails(bool failBuild)
    {
        var target = NamedBuildTarget.Android;
        string originalId = PlayerSettings.GetApplicationIdentifier(target);
        string originalName = PlayerSettings.productName;
        bool originalBundle = EditorUserBuildSettings.buildAppBundle;
        var originalGeneration = PlayerSettings.GetIl2CppCodeGeneration(target);
        var originalCompiler = PlayerSettings.GetIl2CppCompilerConfiguration(target);
        try
        {
            PlayerSettings.SetIl2CppCodeGeneration(target, Il2CppCodeGeneration.OptimizeSpeed);
            EditorUserBuildSettings.buildAppBundle = true;
            try
            {
                using (new PassthroughCameraDiagnosticBuildSettings("dev.unframe.pca.test"))
                {
                    Assert.That(PlayerSettings.GetApplicationIdentifier(target), Is.EqualTo("dev.unframe.pca.test"));
                    Assert.That(PlayerSettings.productName, Is.EqualTo("Unframe PCA Preview"));
                    Assert.That(EditorUserBuildSettings.buildAppBundle, Is.False);
                    Assert.That(PlayerSettings.GetIl2CppCodeGeneration(target), Is.EqualTo(Il2CppCodeGeneration.OptimizeSize));
                    Assert.That(PlayerSettings.GetIl2CppCompilerConfiguration(target), Is.EqualTo(originalCompiler));
                    if (failBuild) throw new InvalidOperationException("Simulated build failure");
                }
            }
            catch (InvalidOperationException) when (failBuild) { }
            Assert.That(PlayerSettings.GetApplicationIdentifier(target), Is.EqualTo(originalId));
            Assert.That(PlayerSettings.productName, Is.EqualTo(originalName));
            Assert.That(EditorUserBuildSettings.buildAppBundle, Is.True);
            Assert.That(PlayerSettings.GetIl2CppCodeGeneration(target), Is.EqualTo(Il2CppCodeGeneration.OptimizeSpeed));
            Assert.That(PlayerSettings.GetIl2CppCompilerConfiguration(target), Is.EqualTo(originalCompiler));
        }
        finally
        {
            PlayerSettings.SetApplicationIdentifier(target, originalId);
            PlayerSettings.productName = originalName;
            EditorUserBuildSettings.buildAppBundle = originalBundle;
            PlayerSettings.SetIl2CppCodeGeneration(target, originalGeneration);
        }
    }
}
