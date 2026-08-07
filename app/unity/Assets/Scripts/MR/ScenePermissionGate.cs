using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;

public sealed class ScenePermissionGate : MonoBehaviour
{
    private const string OculusUseScenePermission = "com.oculus.permission.USE_SCENE";
    private const string HorizonUseScenePermission = "horizonos.permission.USE_SCENE";

    [SerializeField] private ARSession arSession;
    [SerializeField] private ARCameraManager arCameraManager;
    [SerializeField] private bool disableSystemsUntilGranted = true;

#if UNITY_ANDROID && !UNITY_EDITOR
    private readonly Queue<string> pendingPermissions = new();
    private bool requestInFlight;
#endif

    private void Reset()
    {
        ResolveReferences();
    }

    private void Awake()
    {
        ResolveReferences();

        if (disableSystemsUntilGranted)
        {
            SetSystemsEnabled(false);
        }
    }

    private void Start()
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        if (AllPermissionsGranted())
        {
            SetSystemsEnabled(true);
            return;
        }

        RequestMissingPermissions();
#else
        SetSystemsEnabled(true);
#endif
    }

    private void OnApplicationFocus(bool hasFocus)
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        if (!hasFocus)
        {
            return;
        }

        if (AllPermissionsGranted())
        {
            SetSystemsEnabled(true);
            return;
        }

        if (!requestInFlight)
        {
            RequestMissingPermissions();
        }
#endif
    }

    private void ResolveReferences()
    {
        arSession ??= FindAnyObjectByType<ARSession>();
        arCameraManager ??= FindAnyObjectByType<ARCameraManager>();
    }

    private void SetSystemsEnabled(bool enabled)
    {
        if (arSession != null)
        {
            arSession.enabled = enabled;
        }

        if (arCameraManager != null)
        {
            arCameraManager.enabled = enabled;
        }
    }

#if UNITY_ANDROID && !UNITY_EDITOR
    private void RequestMissingPermissions()
    {
        pendingPermissions.Clear();

        EnqueuePermissionIfNeeded(OculusUseScenePermission);
        EnqueuePermissionIfNeeded(HorizonUseScenePermission);

        RequestNextPermission();
    }

    private void EnqueuePermissionIfNeeded(string permission)
    {
        if (!UnityEngine.Android.Permission.HasUserAuthorizedPermission(permission))
        {
            pendingPermissions.Enqueue(permission);
        }
    }

    private void RequestNextPermission()
    {
        if (pendingPermissions.Count == 0)
        {
            requestInFlight = false;
            SetSystemsEnabled(AllPermissionsGranted());
            return;
        }

        requestInFlight = true;
        string permission = pendingPermissions.Dequeue();
        var callbacks = new UnityEngine.Android.PermissionCallbacks();

        callbacks.PermissionGranted += _ => RequestNextPermission();
        callbacks.PermissionDenied += _ => DisableAfterPermissionFailure();
        callbacks.PermissionDeniedAndDontAskAgain += _ => DisableAfterPermissionFailure();

        UnityEngine.Android.Permission.RequestUserPermission(permission, callbacks);
    }

    private void DisableAfterPermissionFailure()
    {
        requestInFlight = false;
        SetSystemsEnabled(false);
    }

    private static bool AllPermissionsGranted()
    {
        return UnityEngine.Android.Permission.HasUserAuthorizedPermission(OculusUseScenePermission) &&
               UnityEngine.Android.Permission.HasUserAuthorizedPermission(HorizonUseScenePermission);
    }
#endif
}
