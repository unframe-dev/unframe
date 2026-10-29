using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.UI;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestOnboardingView : MonoBehaviour
    {
        private QuestPresentationSession session;
        private QuestPresentationEntry entry;
        private AprilTagPresentationCalibration calibration;
        private Transform head;
        private QuestOnboardingApi api;
        private readonly QuestOnboardingFlow flow = new QuestOnboardingFlow();
        private readonly List<Button> buttons = new List<Button>();
        private GameObject panel;
        private Image leftAim, rightAim;
        private QuestOnboardingAuthorization authorization;
        private QuestOnboardingPresentation[] presentations = Array.Empty<QuestOnboardingPresentation>();
        private QuestOnboardingPresentation selected;
        private QuestOnboardingRoom room;
        private CancellationTokenSource cancellation = new CancellationTokenSource();
        private bool busy;
        private int revision, listPage;
        private bool sessionStarted, ownsConnection, lastCalibrationValid;
        private Task stopTask = Task.CompletedTask;
        private string message = "", roomCode = "";
        private Text inputText;
        public bool IsComplete { get; private set; }
        public QuestOnboardingFlow Flow => flow;
        public GameObject Panel => panel;
        public string SharedRoomCode => room?.JoinCode?.Replace("-", "") ?? String.Empty;
        public Button FindButton(string name) => buttons.Find(button => button != null && button.name == name);
        public void Refresh() => Draw();
        public event Action Completed;
        public bool NeedsReauthentication => api != null && room != null && !flow.IsDebugPreview
            && (!api.IsAuthenticated || entry?.LastErrorCode == "authentication-required");

        public async Task RetryConnectionAsync()
        {
            if (!NeedsReauthentication) { if (session != null) await session.RetryAsync(); return; }
            CancelOperation(false);
            IsComplete = false; authorization = null; ownsConnection = false;
            flow.RequireAuthentication();
            message = "認証をもう一度承認すると、同じルームへ接続します。";
            Draw();
            if (session != null) stopTask = session.ExitAsync();
            await stopTask;
        }

        public void Configure(QuestPresentationSession controller, QuestPresentationEntry sessionEntry,
            AprilTagPresentationCalibration source, Transform headTransform, QuestOnboardingApi service)
        {
            if (api != null && !ReferenceEquals(api, service)) api.Dispose();
            session = controller; entry = sessionEntry; calibration = source; head = headTransform; api = service;
            Draw();
        }

        public void CompleteExternalConnection()
        {
            CancelOperation(false);
            IsComplete = true;
            if (panel != null) panel.SetActive(false);
            Completed?.Invoke();
        }

        public void ResetFlow()
        {
            ResetFlowState();
            Draw();
        }

        private void ResetFlowState()
        {
            CancelOperation(); flow.Reset(); IsComplete = false; authorization = null;
            selected = null; room = null; sessionStarted = false; roomCode = ""; message = "";
        }

        private void CancelOperation(bool disconnect = true)
        {
            revision++; cancellation.Cancel(); cancellation.Dispose(); cancellation = new CancellationTokenSource(); busy = false;
            if (disconnect && ownsConnection && session != null) { ownsConnection = false; stopTask = session.ExitAsync(); }
        }

        private void Back()
        {
            if (flow.IsReturningToRoom) { ResetFlow(); return; }
            CancelOperation(flow.Page != QuestOnboardingPage.Ready); message = "";
            flow.Back();
            Draw();
        }

        private void Draw()
        {
            if (head == null || IsComplete) return;
            Vector3 position = Vector3.zero; Quaternion rotation = Quaternion.identity;
            bool hadPanel = panel != null;
            if (hadPanel) { position = panel.transform.position; rotation = panel.transform.rotation; panel.SetActive(false); if (Application.isPlaying) Destroy(panel); else DestroyImmediate(panel); }
            buttons.Clear(); inputText = null;
            panel = new GameObject("Unframe • Welcome", typeof(RectTransform), typeof(Canvas), typeof(Image));
            panel.transform.SetParent(transform, false); panel.transform.localScale = Vector3.one * 0.001f;
            panel.GetComponent<RectTransform>().sizeDelta = new Vector2(1060, 860);
            var canvas = panel.GetComponent<Canvas>(); canvas.renderMode = RenderMode.WorldSpace; canvas.worldCamera = head.GetComponent<Camera>();
            QuestUiTheme.ApplySurface(panel.GetComponent<Image>());
            if (hadPanel) panel.transform.SetPositionAndRotation(position, rotation);
            else
            {
                Vector3 forward = Vector3.ProjectOnPlane(head.forward, Vector3.up);
                Quaternion yaw = Quaternion.LookRotation(forward.sqrMagnitude > 0.001f ? forward : Vector3.forward);
                panel.transform.SetPositionAndRotation(head.position + yaw * new Vector3(0, -0.08f, 1.5f), yaw);
            }
            Label("Brand", "unframe", new Vector2(0, 365), new Vector2(920, 60), 28, QuestUiTheme.Primary);
            DrawPage();
            Label("Message", busy ? "処理しています…" : message, new Vector2(0, -260), new Vector2(920, 80), 24, QuestUiTheme.Muted);
            if (flow.Page != QuestOnboardingPage.Role)
                Button("Back", "戻る", -350, -350, 220, Back, false);
            if ((Application.isEditor || Debug.isDebugBuild) && flow.Role == QuestOnboardingRole.Presenter)
                Button("DebugNext", "デバッグ：次の画面", 230, -350, 440, () => { CancelOperation(); flow.DebugNext(); message = "画面プレビュー：認証・接続・再生は実行されません"; Draw(); }, false);
            leftAim = Aim("Left aim"); rightAim = Aim("Right aim");
        }

        private void DrawPage()
        {
            switch (flow.Page)
            {
                case QuestOnboardingPage.Role:
                    Title("今日は、どのように使いますか？", "役割を選んで始めましょう");
                    Button("Presenter", "発表する", 0, 100, 820, () => Choose(QuestOnboardingRole.Presenter));
                    Button("Audience", "プレゼンを見る", 0, -10, 820, () => Choose(QuestOnboardingRole.Audience), false);
                    break;
                case QuestOnboardingPage.Authentication:
                    Title("アカウントを確認", "スマホまたは PC のブラウザーで承認してください");
                    if (api == null)
                    {
                        Label("Setup", "このアプリの接続先が未設定です。\n設定済みのアプリをご利用ください。", new Vector2(0, 60), new Vector2(920, 100), 30, QuestUiTheme.Text);
                    }
                    else if (authorization == null || authorization.ExpiresAt <= DateTimeOffset.UtcNow)
                        Button("Authorize", "認証コードを表示", 0, 30, 820, () => Run(async token => { var result = await api.BeginAuthorizationAsync(token); token.ThrowIfCancellationRequested(); authorization = result; }));
                    else
                    {
                        Label("Code", authorization.UserCode, new Vector2(0, 100), new Vector2(920, 90), 44, QuestUiTheme.Primary);
                        Label("Verification", authorization.VerificationUrl.ToString(), new Vector2(0, 0), new Vector2(920, 100), 25, QuestUiTheme.Muted);
                        Button("CheckApproval", "承認したので次へ", 0, -95, 820, () => Run(async token =>
                        {
                            if (!await api.PollAuthorizationAsync(token)) { message = "承認を待っています。ブラウザーでコードを入力してください。"; return; }
                            token.ThrowIfCancellationRequested(); await AfterAuthentication(token);
                        }));
                        Button("NewCode", "コードを再発行", 0, -190, 460, () => { authorization = null; Draw(); }, false, 60, 24);
                    }
                    break;
                case QuestOnboardingPage.RoomCode:
                    Title("ルームに参加", "発表者から共有された 8 桁のコードを入力");
                    inputText = Label("Room code", FormatRoomCode(), new Vector2(0, 145), new Vector2(920, 70), 38, QuestUiTheme.Primary);
                    Keyboard("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 60, c => { if (roomCode.Length < 8) roomCode += c; inputText.text = FormatRoomCode(); }, () => { if (roomCode.Length > 0) roomCode = roomCode.Substring(0, roomCode.Length - 1); inputText.text = FormatRoomCode(); });
                    Button("Continue", "このルームに進む", 0, -190, 820, () =>
                    {
                        if (roomCode.Length != 8) { message = "8 桁のルームコードを入力してください"; Draw(); return; }
                        flow.GoTo(api?.IsAuthenticated == true ? QuestOnboardingPage.Join : QuestOnboardingPage.Authentication); Draw();
                    });
                    break;
                case QuestOnboardingPage.Presentations:
                    Title("資料を選ぶ", "発表するプレゼンテーションを選択してください");
                    int first = listPage * 3;
                    for (int i = first; i < Math.Min(first + 3, presentations.Length); i++)
                    {
                        QuestOnboardingPresentation item = presentations[i];
                        Button("Presentation " + i, item.Title, 0, 120 - (i - first) * 95, 900,
                            () => { if (selected?.Id != item.Id) { CancelOperation(); room = null; sessionStarted = false; } selected = item; flow.GoTo(QuestOnboardingPage.Preparation); Draw(); }, false);
                    }
                    if (presentations.Length == 0)
                        Label("Empty", flow.IsDebugPreview ? "画面プレビュー：資料は取得していません" : "資料がありません。Web で公開してから更新してください。", new Vector2(0, 70), new Vector2(920, 130), 28, QuestUiTheme.Muted);
                    Button("Refresh", "更新", 0, -185, 240, () => Run(LoadPresentations), false);
                    if (first > 0) Button("Previous", "前のページ", -300, -185, 300, () => { listPage--; Draw(); }, false);
                    if (first + 3 < presentations.Length) Button("More", "次のページ", 300, -185, 300, () => { listPage++; Draw(); }, false);
                    break;
                case QuestOnboardingPage.Preparation:
                    Title("発表の準備", selected?.Title ?? "画面プレビュー");
                    Label("Room", room == null ? "準備ができたらルームを作成します" : "共有するルームコード\n" + SharedRoomCode, new Vector2(0, 70), new Vector2(920, 150), 32, QuestUiTheme.Primary);
                    Button("Prepare", room == null ? "ルームを作成して接続" : "準備を再試行", 0, -110, 820, () => Run(Prepare));
                    break;
                case QuestOnboardingPage.Join:
                    Title("このルームに参加しますか？", FormatRoomCode());
                    Label("JoinInfo", "発表者の資料を受信し、位置を合わせます", new Vector2(0, 60), new Vector2(920, 120), 30, QuestUiTheme.Muted);
                    Button("Join", "参加する", 0, -100, 820, () => Run(Join));
                    break;
                case QuestOnboardingPage.Calibration:
                    Title("空間に位置を合わせる", "会場のマーカーを正面から見てください");
                    int markerSize = calibration?.MarkerSizeMillimeters ?? 150;
                    Label("Marker size", "マーカーの黒枠の一辺（余白を除く）", new Vector2(0, 142), new Vector2(920, 42), 23, QuestUiTheme.Muted);
                    int[] markerSizes = { 500, 400, 250, 150 };
                    for (int i = 0; i < markerSizes.Length; i++)
                    {
                        int size = markerSizes[i];
                        Button("MarkerSize" + size, size + " mm", -330 + i * 220, 85, 205,
                            () => { calibration?.SelectMarkerSize(size); message = "同じサイズを閲覧側でも選択してください"; Draw(); }, size == markerSize, 62, 25);
                    }
                    bool valid = calibration?.Calibration?.IsValid == true;
                    Label("Alignment", valid ? "位置合わせが完了しました" : "マーカーを見ながら、頭をゆっくり動かします", new Vector2(0, 5), new Vector2(920, 70), 28, QuestUiTheme.Text);
                    Button("Permission", "カメラを許可 / 再確認", 0, -80, 820, () => { calibration?.CameraPreview?.RetryCameraPermission(); Draw(); }, false);
                    Button("Aligned", "位置合わせを確認して次へ", 0, -175, 820, () =>
                    {
                        if (!QuestOnboardingStart.CanAdvance(flow.Role, calibration?.Calibration?.IsValid == true,
                            entry?.ControlReady == true, entry?.SessionReady == true))
                        { message = "位置合わせとサーバーの準備完了を待っています"; Draw(); return; }
                        flow.GoTo(QuestOnboardingPage.Ready); Draw();
                    });
                    break;
                case QuestOnboardingPage.Ready:
                    Title(flow.IsDebugPreview ? "画面プレビュー" : flow.Role == QuestOnboardingRole.Presenter ? "発表を始めましょう" : "鑑賞の準備ができました",
                        flow.IsDebugPreview ? "接続や再生は実行されていません" : "メニューは X ボタンで開けます");
                    Button("Begin", flow.IsDebugPreview ? "最初の画面に戻る" : flow.Role == QuestOnboardingRole.Presenter ? "発表を開始" : "資料を見る", 0, 20, 820, () =>
                    {
                        if (flow.IsDebugPreview) { ResetFlow(); return; }
                        Run(async token =>
                        {
                            if (!QuestOnboardingStart.CanAdvance(flow.Role, calibration?.Calibration?.IsValid == true,
                                entry?.ControlReady == true, entry?.SessionReady == true)) throw new InvalidOperationException("not-ready");
                            if (flow.Role == QuestOnboardingRole.Presenter)
                            {
                                await QuestOnboardingStart.BeginPresenterAsync(async () =>
                                {
                                    if (!sessionStarted) { await api.StartSessionAsync(room.SessionId, token); sessionStarted = true; }
                                }, () => entry.SessionReady, () => entry.ControlReady,
                                    () => entry.ConnectionStage == PresentationConnectionStage.Failed,
                                    () => entry.PlaybackStatus, () => entry.ControlConfirmedAsync(Unframe.Realtime.RuntimeControlKind.Resume, token), TimeSpan.FromSeconds(30), token);
                            }
                            token.ThrowIfCancellationRequested(); IsComplete = true; panel.SetActive(false); Completed?.Invoke();
                        });
                    });
                    break;
            }
        }

        private void Choose(QuestOnboardingRole role)
        {
            flow.SelectRole(role); message = "";
            if (role == QuestOnboardingRole.Presenter && api?.IsAuthenticated == true) Run(AfterAuthentication); else Draw();
        }

        private async Task AfterAuthentication(CancellationToken token)
        {
            if (flow.IsReturningToRoom) { await Connect(token); token.ThrowIfCancellationRequested(); return; }
            if (flow.Role == QuestOnboardingRole.Presenter) { await LoadPresentations(token); token.ThrowIfCancellationRequested(); flow.GoTo(QuestOnboardingPage.Presentations); }
            else flow.GoTo(QuestOnboardingPage.Join);
        }
        private async Task LoadPresentations(CancellationToken token)
        {
            if (api == null || flow.IsDebugPreview) return;
            var result = await api.ListPresentationsAsync(token); token.ThrowIfCancellationRequested(); presentations = result; listPage = 0;
        }
        private async Task Prepare(CancellationToken token)
        {
            if (flow.IsDebugPreview || selected == null || api == null) return;
            if (room == null) { var created = await api.CreateSessionAsync(selected.Id, token); token.ThrowIfCancellationRequested(); room = created; }
            await api.PrepareRuntimeAsync(room.SessionId, token);
            await Connect(token);
        }
        private async Task Join(CancellationToken token)
        {
            if (api == null) return;
            var joined = await api.JoinSessionAsync(FormatRoomCode(), token); token.ThrowIfCancellationRequested(); room = joined;
            await Connect(token);
        }
        private async Task Connect(CancellationToken token)
        {
            await stopTask; token.ThrowIfCancellationRequested();
            if (!ownsConnection || !entry.IsRunning || entry.ConnectionStage == PresentationConnectionStage.Failed)
            {
                session.ConfigureConnection(api.Origin, room.SessionId, api.CredentialAsync, managedByOnboarding: true);
                ownsConnection = true;
                await session.ConnectAsync(); token.ThrowIfCancellationRequested();
            }
            DateTime deadline = DateTime.UtcNow.AddSeconds(30);
            while (!entry.ControlReady && entry.ConnectionStage != PresentationConnectionStage.Failed && DateTime.UtcNow < deadline)
                await Task.Delay(100, token);
            token.ThrowIfCancellationRequested();
            if (!entry.ControlReady && NeedsReauthentication) throw new QuestOnboardingApiException("authentication-required");
            if (!entry.ControlReady) { message = "ルームの準備を待っています。しばらくして接続を確認してください。"; return; }
            if ((flow.Role == QuestOnboardingRole.Presenter) != entry.IsPresenter) throw new InvalidOperationException("role-mismatch");
            flow.ConnectionReady();
        }
        private async void Run(Func<CancellationToken, Task> action)
        {
            if (busy || flow.IsDebugPreview) return;
            int current = revision; CancellationToken token = cancellation.Token; busy = true; message = ""; Draw();
            try { await action(token); }
            catch (OperationCanceledException) { }
            catch (QuestOnboardingApiException exception)
            {
                if (current == revision)
                {
                    if (exception.Code == "authentication-required" || exception.Code == "authorization-expired" || exception.Code == "authorization-denied")
                    {
                        authorization = null;
                        if (room != null) flow.RequireAuthentication(); else flow.GoTo(QuestOnboardingPage.Authentication);
                    }
                    message = "承認またはルームの状態を確認して、もう一度お試しください。";
                }
            }
            catch (Exception) { if (current == revision) message = "処理が完了しませんでした。接続先・承認状態・ルームの準備を確認して再試行してください。"; }
            finally { if (current == revision && this != null) { busy = false; Draw(); } }
        }
        private string FormatRoomCode() => roomCode.Length <= 4 ? roomCode : roomCode.Substring(0, 4) + "-" + roomCode.Substring(4);

        private void Keyboard(string characters, float top, Action<char> append, Action remove)
        {
            for (int i = 0; i < characters.Length; i++)
            {
                char c = characters[i]; Button("Key " + c, c.ToString(), (i % 12 - 5.5f) * 74, top - (i / 12) * 57, 68, () => append(c), false, 50, 25);
            }
            Button("Delete", "削除", 370, top - 171, 142, () => remove(), false, 50, 23);
        }
        private void Title(string title, string subtitle)
        {
            Label("Heading", title, new Vector2(0, 285), new Vector2(920, 95), 38, QuestUiTheme.Text);
            Label("Subtitle", subtitle, new Vector2(0, 205), new Vector2(920, 70), 25, QuestUiTheme.Muted);
        }
        private Text Label(string name, string value, Vector2 position, Vector2 size, int fontSize, Color color)
        {
            var obj = new GameObject(name, typeof(RectTransform), typeof(Text)); obj.transform.SetParent(panel.transform, false);
            var text = obj.GetComponent<Text>(); text.rectTransform.anchoredPosition = position; text.rectTransform.sizeDelta = size;
            text.font = QuestPresentationUiFont.Load(); text.text = value; text.fontSize = fontSize; text.color = color;
            text.alignment = TextAnchor.MiddleCenter; text.supportRichText = false; text.raycastTarget = false; return text;
        }
        private void Button(string name, string title, float x, float y, float width, Action action, bool primary = true, float height = 78, int fontSize = 29)
        {
            var obj = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button)); obj.transform.SetParent(panel.transform, false);
            var rect = obj.GetComponent<RectTransform>(); rect.sizeDelta = new Vector2(width, height); rect.anchoredPosition = new Vector2(x, y);
            var image = obj.GetComponent<Image>(); QuestUiTheme.ApplyButton(image, primary);
            var button = obj.GetComponent<Button>(); button.targetGraphic = image; button.interactable = !busy || name == "Back" || name == "DebugNext"; button.onClick.AddListener(() => action()); buttons.Add(button);
            Text label = Label(name + " label", title, Vector2.zero, new Vector2(width - 32, height - 4), fontSize, primary ? Color.white : QuestUiTheme.Text);
            label.transform.SetParent(obj.transform, false);
            label.resizeTextForBestFit = true; label.resizeTextMinSize = 20; label.resizeTextMaxSize = fontSize;
        }
        private Image Aim(string name)
        {
            var obj = new GameObject(name, typeof(RectTransform), typeof(Image)); obj.transform.SetParent(panel.transform, false);
            var image = obj.GetComponent<Image>(); image.rectTransform.sizeDelta = Vector2.one * 14;
            QuestUiTheme.ApplyButton(image); image.enabled = false; return image;
        }
        public bool HandleRay(Ray ray)
        {
            if (!Hit(ray, out Vector3 world, out _)) return false;
            foreach (Button button in buttons)
            {
                if (button == null || !button.IsInteractable()) continue;
                var rect = button.GetComponent<RectTransform>(); Vector3 local = rect.InverseTransformPoint(world);
                if (rect.rect.Contains(new Vector2(local.x, local.y))) { button.onClick.Invoke(); break; }
            }
            return true;
        }
        public bool ShowAim(Ray ray, bool rightHand)
        {
            Image aim = rightHand ? rightAim : leftAim; if (aim == null) return false;
            bool hit = Hit(ray, out _, out Vector3 local); aim.enabled = hit;
            if (hit) aim.rectTransform.anchoredPosition = new Vector2(local.x, local.y); return hit;
        }
        private bool Hit(Ray ray, out Vector3 world, out Vector3 local)
        {
            world = local = Vector3.zero;
            if (!isActiveAndEnabled || IsComplete || panel == null || !panel.activeInHierarchy) return false;
            var rect = panel.GetComponent<RectTransform>(); var plane = new Plane(rect.forward, rect.position);
            if (!plane.Raycast(ray, out float distance) || distance < 0) return false;
            world = ray.GetPoint(distance); local = rect.InverseTransformPoint(world); return rect.rect.Contains(new Vector2(local.x, local.y));
        }
        private void Update()
        {
            if (IsComplete && !busy && NeedsReauthentication) { _ = RetryConnectionAsync(); return; }
            bool valid = calibration?.Calibration?.IsValid == true;
            if (valid != lastCalibrationValid && flow.Page == QuestOnboardingPage.Calibration && !busy) Draw();
            lastCalibrationValid = valid;
        }
        private void OnDisable() { ResetFlowState(); if (panel != null) panel.SetActive(false); }
        private void OnEnable() { if (head != null && !IsComplete) Draw(); }
        private void OnDestroy() { cancellation.Cancel(); cancellation.Dispose(); api?.Dispose(); if (panel != null) { if (Application.isPlaying) Destroy(panel); else DestroyImmediate(panel); } }
    }
}
