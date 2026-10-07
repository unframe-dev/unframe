using System;
using System.Runtime.InteropServices;
using System.Threading;
using AOT;
using UnityEngine;
using UnityEngine.XR.OpenXR;
using UnityEngine.XR.OpenXR.Features;

#if UNITY_EDITOR
using UnityEditor;
using UnityEditor.XR.OpenXR.Features;
#endif

namespace Unframe.Unity.PresentationRuntime
{
#if UNITY_EDITOR
    [OpenXRFeature(
        UiName = "Unframe Quest Body Tracking",
        Desc = "Uses the OpenXR body hip joint as the presenter body pose.",
        Company = "Unframe",
        Version = "1.0.0",
        FeatureId = FeatureId,
        OpenxrExtensionStrings = ExtensionName,
        BuildTargetGroups = new[] { BuildTargetGroup.Android },
        Category = FeatureCategory.Feature)]
#endif
    public sealed class QuestBodyTrackingFeature : OpenXRFeature
    {
        public const string FeatureId = "dev.unframe.openxr.quest-body-tracking";
        public const string ExtensionName = "XR_FB_body_tracking";

        internal const int JointCount = 70;
        internal const int HipsJoint = 1;
        internal const ulong OrientationValid = 1;
        internal const ulong PositionValid = 2;

        private const int BodyTrackerCreateInfoType = 1000076001;
        private const int BodyJointsLocateInfoType = 1000076002;
        private const int SystemBodyTrackingPropertiesType = 1000076004;
        private const int BodyJointLocationsType = 1000076005;
        private const int SystemPropertiesType = 5;

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int GetInstanceProcAddrDelegate(ulong instance, [MarshalAs(UnmanagedType.LPStr)] string name, out IntPtr function);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int WaitFrameDelegate(ulong session, ref FrameWaitInfo waitInfo, ref FrameState frameState);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int GetSystemPropertiesDelegate(ulong instance, ulong systemId, ref SystemProperties properties);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int CreateBodyTrackerDelegate(ulong session, ref BodyTrackerCreateInfo createInfo, out ulong tracker);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int DestroyBodyTrackerDelegate(ulong tracker);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
        private delegate int LocateBodyJointsDelegate(ulong tracker, ref BodyJointsLocateInfo info, ref BodyJointLocations locations);

        [StructLayout(LayoutKind.Sequential)]
        private struct FrameWaitInfo { public int Type; public IntPtr Next; }

        [StructLayout(LayoutKind.Sequential)]
        private struct FrameState
        {
            public int Type;
            public IntPtr Next;
            public long PredictedDisplayTime;
            public long PredictedDisplayPeriod;
            public uint ShouldRender;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SystemBodyTrackingProperties
        {
            public int Type;
            public IntPtr Next;
            public uint SupportsBodyTracking;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SystemProperties
        {
            public int Type;
            public IntPtr Next;
            public ulong SystemId;
            public uint VendorId;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 256)] public byte[] SystemName;
            public uint MaxSwapchainImageHeight;
            public uint MaxSwapchainImageWidth;
            public uint MaxLayerCount;
            public uint OrientationTracking;
            public uint PositionTracking;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct BodyTrackerCreateInfo { public int Type; public IntPtr Next; public int BodyJointSet; }

        [StructLayout(LayoutKind.Sequential)]
        private struct BodyJointsLocateInfo { public int Type; public IntPtr Next; public ulong BaseSpace; public long Time; }

        [StructLayout(LayoutKind.Sequential)]
        private struct BodyJointLocations
        {
            public int Type;
            public IntPtr Next;
            public uint IsActive;
            public float Confidence;
            public uint JointCount;
            public IntPtr JointLocations;
            public uint SkeletonChangedCount;
            public long Time;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Vector3f { public float X, Y, Z; }

        [StructLayout(LayoutKind.Sequential)]
        private struct Quaternionf { public float X, Y, Z, W; }

        [StructLayout(LayoutKind.Sequential)]
        private struct Posef { public Quaternionf Orientation; public Vector3f Position; }

        [StructLayout(LayoutKind.Sequential)]
        private struct BodyJointLocation { public ulong LocationFlags; public Posef Pose; }

        private static readonly GetInstanceProcAddrDelegate HookDelegate = HookedGetInstanceProcAddr;
        private static readonly WaitFrameDelegate WaitDelegate = HookedWaitFrame;
        private static GetInstanceProcAddrDelegate upstreamGetProc;
        private static WaitFrameDelegate upstreamWaitFrame;
        private static volatile QuestBodyTrackingFeature activeFeature;

        private GetSystemPropertiesDelegate getSystemProperties;
        private CreateBodyTrackerDelegate createBodyTracker;
        private DestroyBodyTrackerDelegate destroyBodyTracker;
        private LocateBodyJointsDelegate locateBodyJoints;
        private ulong instance;
        private ulong tracker;
        private IntPtr jointBuffer;
        private long currentSession;
        private long predictedDisplayTime;
        private bool supported;
        private bool sessionRunning;

        protected override IntPtr HookGetInstanceProcAddr(IntPtr function)
        {
            upstreamGetProc = Marshal.GetDelegateForFunctionPointer<GetInstanceProcAddrDelegate>(function);
            activeFeature = this;
            return Marshal.GetFunctionPointerForDelegate(HookDelegate);
        }

        [MonoPInvokeCallback(typeof(GetInstanceProcAddrDelegate))]
        private static int HookedGetInstanceProcAddr(ulong instance, string name, out IntPtr function)
        {
            int result = upstreamGetProc(instance, name, out function);
            if (result == 0 && name == "xrWaitFrame" && function != IntPtr.Zero)
            {
                upstreamWaitFrame = Marshal.GetDelegateForFunctionPointer<WaitFrameDelegate>(function);
                function = Marshal.GetFunctionPointerForDelegate(WaitDelegate);
            }
            return result;
        }

        [MonoPInvokeCallback(typeof(WaitFrameDelegate))]
        private static int HookedWaitFrame(ulong session, ref FrameWaitInfo waitInfo, ref FrameState frameState)
        {
            int result = upstreamWaitFrame(session, ref waitInfo, ref frameState);
            QuestBodyTrackingFeature feature = activeFeature;
            if (feature != null && result == 0 && unchecked((ulong)Interlocked.Read(ref feature.currentSession)) == session)
                Interlocked.Exchange(ref feature.predictedDisplayTime, frameState.PredictedDisplayTime);
            return result;
        }

        protected override bool OnInstanceCreate(ulong xrInstance)
        {
            if (!OpenXRRuntime.IsExtensionEnabled(ExtensionName) || upstreamGetProc == null) return false;
            instance = xrInstance;
            return Resolve("xrGetSystemProperties", out getSystemProperties)
                && Resolve("xrCreateBodyTrackerFB", out createBodyTracker)
                && Resolve("xrDestroyBodyTrackerFB", out destroyBodyTracker)
                && Resolve("xrLocateBodyJointsFB", out locateBodyJoints);
        }

        private bool Resolve<T>(string name, out T function) where T : Delegate
        {
            function = null;
            if (upstreamGetProc(instance, name, out IntPtr pointer) != 0 || pointer == IntPtr.Zero) return false;
            function = Marshal.GetDelegateForFunctionPointer<T>(pointer);
            return true;
        }

        protected override void OnSystemChange(ulong systemId)
        {
            supported = false;
            if (systemId == 0 || getSystemProperties == null) return;
            var body = new SystemBodyTrackingProperties { Type = SystemBodyTrackingPropertiesType };
            IntPtr bodyPointer = Marshal.AllocHGlobal(Marshal.SizeOf<SystemBodyTrackingProperties>());
            try
            {
                Marshal.StructureToPtr(body, bodyPointer, false);
                var properties = new SystemProperties
                {
                    Type = SystemPropertiesType,
                    Next = bodyPointer,
                    SystemName = new byte[256]
                };
                if (getSystemProperties(instance, systemId, ref properties) == 0)
                    supported = Marshal.PtrToStructure<SystemBodyTrackingProperties>(bodyPointer).SupportsBodyTracking != 0;
            }
            finally { Marshal.FreeHGlobal(bodyPointer); }
        }

        protected override void OnSessionCreate(ulong session)
        {
            if (!supported || createBodyTracker == null) return;
            var info = new BodyTrackerCreateInfo { Type = BodyTrackerCreateInfoType, BodyJointSet = 0 };
            if (createBodyTracker(session, ref info, out ulong created) == 0 && created != 0)
            {
                try
                {
                    jointBuffer = Marshal.AllocHGlobal(Marshal.SizeOf<BodyJointLocation>() * JointCount);
                    tracker = created;
                    Interlocked.Exchange(ref currentSession, unchecked((long)session));
                }
                catch
                {
                    destroyBodyTracker?.Invoke(created);
                    throw;
                }
            }
        }

        protected override void OnSessionBegin(ulong session)
        {
            sessionRunning = tracker != 0 && unchecked((ulong)Interlocked.Read(ref currentSession)) == session;
            Interlocked.Exchange(ref predictedDisplayTime, 0);
        }

        protected override void OnSessionEnd(ulong session)
        {
            sessionRunning = false;
            Interlocked.Exchange(ref predictedDisplayTime, 0);
        }

        protected override void OnSessionLossPending(ulong session)
        {
            sessionRunning = false;
            Interlocked.Exchange(ref predictedDisplayTime, 0);
        }

        protected override void OnInstanceLossPending(ulong xrInstance)
        {
            sessionRunning = false;
            Interlocked.Exchange(ref predictedDisplayTime, 0);
        }

        protected override void OnAppSpaceChange(ulong space)
        {
            Interlocked.Exchange(ref predictedDisplayTime, 0);
        }

        protected override void OnSessionDestroy(ulong session)
        {
            sessionRunning = false;
            Interlocked.Exchange(ref predictedDisplayTime, 0);
            ReleaseTracker();
            Interlocked.Exchange(ref currentSession, 0);
        }

        protected override void OnInstanceDestroy(ulong xrInstance)
        {
            supported = false;
            sessionRunning = false;
            Interlocked.Exchange(ref predictedDisplayTime, 0);
            Interlocked.Exchange(ref currentSession, 0);
            ReleaseTracker();
            instance = 0;
            if (ReferenceEquals(activeFeature, this)) activeFeature = null;
        }

        private void ReleaseTracker()
        {
            if (tracker != 0)
            {
                destroyBodyTracker?.Invoke(tracker);
                tracker = 0;
            }
            if (jointBuffer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(jointBuffer);
                jointBuffer = IntPtr.Zero;
            }
        }

        public bool TryGetHipPose(out Vector3 position, out Quaternion rotation)
        {
            position = default;
            rotation = default;
            long time = Interlocked.Read(ref predictedDisplayTime);
            if (!enabled || !supported || !sessionRunning || tracker == 0 || jointBuffer == IntPtr.Zero || time <= 0 || locateBodyJoints == null)
                return false;
            ulong space = GetCurrentAppSpace();
            if (space == 0) return false;

            int stride = Marshal.SizeOf<BodyJointLocation>();
            var info = new BodyJointsLocateInfo { Type = BodyJointsLocateInfoType, BaseSpace = space, Time = time };
            var locations = new BodyJointLocations { Type = BodyJointLocationsType, JointCount = JointCount, JointLocations = jointBuffer };
            if (locateBodyJoints(tracker, ref info, ref locations) != 0 || locations.IsActive == 0 || locations.JointCount != JointCount)
                return false;
            BodyJointLocation hip = Marshal.PtrToStructure<BodyJointLocation>(IntPtr.Add(jointBuffer, stride * HipsJoint));
            return TryConvertTrackedJoint(hip, out position, out rotation);
        }

        private static bool TryConvertTrackedJoint(BodyJointLocation joint, out Vector3 position, out Quaternion rotation)
        {
            position = default;
            rotation = default;
            // The runtime can infer a valid hip pose without setting the joint's TRACKED bits.
            const ulong required = PositionValid | OrientationValid;
            if ((joint.LocationFlags & required) != required) return false;
            Posef pose = joint.Pose;
            if (!Finite(pose.Position.X) || !Finite(pose.Position.Y) || !Finite(pose.Position.Z)
                || !Finite(pose.Orientation.X) || !Finite(pose.Orientation.Y) || !Finite(pose.Orientation.Z) || !Finite(pose.Orientation.W))
                return false;
            position = new Vector3(pose.Position.X, pose.Position.Y, -pose.Position.Z);
            rotation = new Quaternion(-pose.Orientation.X, -pose.Orientation.Y, pose.Orientation.Z, pose.Orientation.W);
            return true;
        }

        private static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
    }
}
