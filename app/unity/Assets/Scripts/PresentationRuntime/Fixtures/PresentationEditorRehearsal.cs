#if UNITY_EDITOR
using System;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Unframe.Unity.PresentationRuntime
{
    [RequireComponent(typeof(LocalPresentationFixtureRunner))]
    public sealed class PresentationEditorRehearsal : MonoBehaviour
    {
        [SerializeField] private Camera previewCamera;
        private LocalPresentationFixtureRunner Runner => GetComponent<LocalPresentationFixtureRunner>();
        private string errorMessage;
        private Vector3 focus = new Vector3(0, 0.35f, 0);
        private float distance = 3;
        private float yaw;
        private float pitch;

        public void Configure(Camera camera) => previewCamera = camera;

        private void Start() => Restart(out errorMessage);

        public bool Restart(out string error)
        {
            var runner = Runner;
            runner.KeyboardAdvanceEnabled = false;
            runner.SetDeliveryFixture(Resources.Load<TextAsset>("MotionPresentation/LocalDelivery"));
            runner.SetSnapshotFixture(Resources.Load<TextAsset>("MotionPresentation/LocalSnapshot"));
            TextAsset[] events = Resources.LoadAll<TextAsset>("MotionPresentation/Control");
            Array.Sort(events, (left, right) => String.CompareOrdinal(left.name, right.name));
            runner.SetReliableEventFixtures(events);
            ResetView(false);
            return runner.TryLoad(out error) && runner.TryAdvance(out error);
        }

        public bool Advance(out string error) => Runner.TryAdvance(out error);

        private void Update()
        {
            Keyboard keyboard = Keyboard.current;
            if (keyboard != null)
            {
                if (keyboard.rKey.wasPressedThisFrame) Restart(out errorMessage);
                else if (Runner.CanAdvance && (keyboard.spaceKey.wasPressedThisFrame
                    || keyboard.enterKey.wasPressedThisFrame || keyboard.rightArrowKey.wasPressedThisFrame))
                    Advance(out errorMessage);
                if (keyboard.fKey.wasPressedThisFrame) ResetView(false);
                if (keyboard.oKey.wasPressedThisFrame) ResetView(true);
            }
            Mouse mouse = Mouse.current;
            if (mouse != null && previewCamera != null)
            {
                Vector2 delta = mouse.delta.ReadValue();
                if (mouse.rightButton.isPressed)
                {
                    yaw += delta.x * 0.2f;
                    pitch = Mathf.Clamp(pitch - delta.y * 0.2f, -80, 80);
                }
                if (mouse.middleButton.isPressed)
                    focus -= (previewCamera.transform.right * delta.x + previewCamera.transform.up * delta.y) * distance * 0.001f;
                distance = Mathf.Clamp(distance * Mathf.Exp(-mouse.scroll.ReadValue().y * 0.001f), 0.4f, 12);
                ApplyCamera();
            }
        }

        private void ResetView(bool overview)
        {
            focus = new Vector3(0, 0.35f, 0);
            distance = overview ? 6 : 3;
            yaw = pitch = 0;
            if (previewCamera != null) previewCamera.fieldOfView = overview ? 75 : 42;
            ApplyCamera();
        }

        private void ApplyCamera()
        {
            if (previewCamera == null) return;
            previewCamera.transform.rotation = Quaternion.Euler(pitch, yaw, 0);
            previewCamera.transform.position = focus - previewCamera.transform.forward * distance;
        }

        private void OnGUI()
        {
            float width = Mathf.Min(620, Screen.width - 24);
            GUILayout.BeginArea(new Rect((Screen.width - width) / 2, Screen.height - 112, width, 104), GUI.skin.box);
            string status = Runner.IsAnimating ? "Playing…" : Runner.CanAdvance ? "Ready" : "Complete";
            GUILayout.Label("EDITOR REHEARSAL    " + Runner.AppliedEventCount + " / " + Runner.ReliableEventCount + "    " + status);
            GUILayout.BeginHorizontal();
            GUI.enabled = Runner.CanAdvance;
            if (GUILayout.Button("Next  [Space / Enter / →]", GUILayout.Height(30))) Advance(out errorMessage);
            GUI.enabled = true;
            if (GUILayout.Button("Restart  [R]", GUILayout.Height(30))) Restart(out errorMessage);
            if (GUILayout.Button("Front  [F]", GUILayout.Height(30))) ResetView(false);
            if (GUILayout.Button("Overview  [O]", GUILayout.Height(30))) ResetView(true);
            GUILayout.EndHorizontal();
            GUILayout.Label(String.IsNullOrEmpty(errorMessage)
                ? "Right drag: orbit  ·  Middle drag: pan  ·  Scroll: zoom"
                : errorMessage);
            GUILayout.EndArea();
        }
    }
}
#endif
