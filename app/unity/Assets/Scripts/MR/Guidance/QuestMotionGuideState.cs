using System.Collections.Generic;
using Unframe.Presentation;
using Unframe.Realtime;

namespace Unframe.Unity.PresentationRuntime
{
    public sealed class QuestMotionGuideState
    {
        private readonly List<GestureKind> candidates = new List<GestureKind>();
        public IReadOnlyList<GestureKind> Candidates => candidates;
        public bool ShowHint { get; private set; }
        public string Title { get; private set; } = "";
        public string Instruction { get; private set; } = "";

        public void Refresh(PresenterRecognitionCatalog catalog, ProgressionRuntimeState progression, bool presenter,
            bool calibrated, bool running, bool headTracked, bool leftTracked, bool rightTracked, bool menuVisible, bool inputReady)
        {
            candidates.Clear();
            ShowHint = presenter && !menuVisible;
            Title = Instruction = "";
            if (!ShowHint) return;
            if (!calibrated) { Hint("位置合わせを待っています", "会場のマーカーを見てください。Xで設定を開けます。"); return; }
            if (!running) { Hint("一時停止しています", "Xでメニューを開き、再生・再開を選んでください。"); return; }
            if (!headTracked) { Hint("頭の位置を確認しています", "前を向き、ヘッドセットの追跡が戻るまでお待ちください。"); return; }
            if (progression?.PhaseCase != ProgressionRuntimeState.PhaseOneofCase.Stable)
            { Hint("場面を切り替えています", "切り替えが終わるまで、次の操作をお待ちください。"); return; }
            if (!inputReady || catalog == null)
            { Hint("操作を同期しています", "接続と操作の準備が整うまでお待ちください。Xで設定を開けます。"); return; }
            bool hasGesture = false;
            bool needsBothHands = true;
            foreach (GestureKind gesture in catalog.Gestures)
            {
                if (gesture < GestureKind.SwipeLeft || gesture > GestureKind.CloseHands) continue;
                bool both = gesture == GestureKind.SpreadHands || gesture == GestureKind.CloseHands;
                hasGesture = true;
                needsBothHands &= both;
                if ((both ? leftTracked && rightTracked : leftTracked || rightTracked) && !candidates.Contains(gesture)) candidates.Add(gesture);
            }
            if (candidates.Count > 0)
            { Hint("操作候補", "前を見て、手を止めてから動かしてください。Xで設定を開けます。"); return; }
            if (hasGesture)
            { Hint(needsBothHands ? "両手の追跡を待っています" : "手の追跡を待っています", needsBothHands ? "両手をヘッドセットから見える位置に戻してください。" : "片手をヘッドセットから見える位置に戻してください。"); return; }
            if (catalog.Zones.Count > 0)
            { Hint("立ち位置を使う操作候補があります", "会場で案内された立ち位置を確認してください。Xで設定を開けます。"); return; }
            Hint("資料の進行を確認してください", "腕操作の候補はありません。資料の操作や自動進行を確認してください。Xで設定を開けます。");
        }

        private void Hint(string title, string instruction) { Title = title; Instruction = instruction; }

        public static string Description(GestureKind gesture)
        {
            switch (gesture)
            {
                case GestureKind.SwipeLeft: return "左へ動かす";
                case GestureKind.SwipeRight: return "右へ動かす";
                case GestureKind.SwipeDown: return "下へ動かす";
                case GestureKind.SwipeUp: return "上へ動かす";
                case GestureKind.PushForward: return "前へ押す";
                case GestureKind.PullBackward: return "手前へ引く";
                case GestureKind.SpreadHands: return "両手を広げる";
                case GestureKind.CloseHands: return "両手を寄せる";
                default: return "";
            }
        }

        public static string InstructionFor(GestureKind gesture, bool detailed)
        {
            if (gesture < GestureKind.SwipeLeft || gesture > GestureKind.CloseHands) return "";
            bool both = gesture == GestureKind.SpreadHands || gesture == GestureKind.CloseHands;
            if (!detailed) return both ? "前を見て、両手を止めてから動かします。" : "前を見て、片手を止めてから動かします。";
            return both
                ? "前を見て、両手を0.15秒止めてから、0.8秒以内に両手の間隔を25cm以上変えます。"
                : "前を見て、片手を0.15秒止めてから、0.8秒以内に18cm以上動かします。";
        }
    }
}
