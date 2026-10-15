using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Build;

internal sealed class PassthroughCameraDiagnosticBuildSettings : IDisposable
{
    private readonly NamedBuildTarget target = NamedBuildTarget.Android;
    private readonly string originalId;
    private readonly string originalName;
    private readonly bool originalBundle;
    private readonly Il2CppCodeGeneration originalGeneration;
    private bool disposed;

    public PassthroughCameraDiagnosticBuildSettings(string applicationId)
    {
        originalId = PlayerSettings.GetApplicationIdentifier(target);
        originalName = PlayerSettings.productName;
        originalBundle = EditorUserBuildSettings.buildAppBundle;
        originalGeneration = PlayerSettings.GetIl2CppCodeGeneration(target);
        try
        {
            PlayerSettings.SetApplicationIdentifier(target, applicationId);
            PlayerSettings.productName = "Unframe PCA Preview";
            EditorUserBuildSettings.buildAppBundle = false;
            PlayerSettings.SetIl2CppCodeGeneration(target, Il2CppCodeGeneration.OptimizeSize);
        }
        catch (Exception applyError)
        {
            try { Dispose(); }
            catch (Exception restoreError)
            {
                throw new AggregateException("Diagnostic build settings could not be applied or restored.", applyError, restoreError);
            }
            throw;
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        var errors = new List<Exception>();
        Restore(() => PlayerSettings.SetApplicationIdentifier(target, originalId), errors);
        Restore(() => PlayerSettings.productName = originalName, errors);
        Restore(() => EditorUserBuildSettings.buildAppBundle = originalBundle, errors);
        Restore(() => PlayerSettings.SetIl2CppCodeGeneration(target, originalGeneration), errors);
        if (errors.Count != 0)
            throw new AggregateException("Diagnostic build settings could not be fully restored.", errors);
    }

    private static void Restore(Action restore, List<Exception> errors)
    {
        try { restore(); }
        catch (Exception error) { errors.Add(error); }
    }
}
