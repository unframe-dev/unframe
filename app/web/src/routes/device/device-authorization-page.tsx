import Google from "@mui/icons-material/Google";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { createControlPlaneAuthClient } from "@unframe/api-client-typescript";
import { useEffect, useState } from "react";

const controlPlaneUrl = import.meta.env["VITE_CONTROL_PLANE_URL"] || "https://api.un-fra.me";
const auth = createControlPlaneAuthClient({ baseUrl: controlPlaneUrl, credentials: "include" });

type PageState = "entry" | "pending" | "approved" | "denied";

function errorMessage(error?: { code?: string | undefined; error?: string | undefined } | null) {
  switch (error?.error ?? error?.code) {
    case "expired_token":
      return "このコードの有効期限が切れています。";
    case "device_code_already_processed":
      return "このコードはすでに処理されています。";
    case "invalid_request":
      return "コードが正しくないか、すでに利用できません。";
    case "access_denied":
      return "このコードを処理する権限がありません。";
    case "unauthorized":
      return "この操作にはログインが必要です。";
    default:
      return "処理中に問題が発生しました。時間をおいてもう一度お試しください。";
  }
}

function deviceCallbackUrl(userCode: string) {
  const url = new URL("/editor/device", window.location.origin);
  if (userCode) url.searchParams.set("user_code", userCode);
  return url.toString();
}

export function DeviceAuthorizationPage({ initialUserCode }: { initialUserCode: string }) {
  const [userCode, setUserCode] = useState(initialUserCode);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionFailure, setSessionFailure] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [state, setState] = useState<PageState>("entry");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let active = true;
    void auth
      .getSession()
      .then((result) => {
        if (!active) return;
        setSignedIn(Boolean(result.data));
        setSessionFailure(false);
        setSessionReady(true);
      })
      .catch(() => {
        if (!active) return;
        setSignedIn(false);
        setSessionFailure(true);
        setMessage(errorMessage());
        setSessionReady(true);
      });
    return () => {
      active = false;
    };
  }, [sessionAttempt]);

  const retrySession = () => {
    setMessage(undefined);
    setSessionFailure(false);
    setSessionReady(false);
    setSessionAttempt((attempt) => attempt + 1);
  };

  const verify = async () => {
    const code = userCode.trim();
    if (!code) {
      setMessage("ユーザーコードを入力してください。");
      return;
    }
    if (!signedIn) {
      setMessage("コードを確認するにはログインしてください。");
      return;
    }

    setLoading(true);
    setMessage(undefined);
    try {
      const result = await auth.verifyDeviceAuthorization(code);
      if (result.error) {
        setMessage(errorMessage(result.error));
        return;
      }
      setState(result.data.status);
    } catch {
      setMessage(errorMessage());
    } finally {
      setLoading(false);
    }
  };

  const decide = async (decision: "approve" | "deny") => {
    if (loading) return;
    setLoading(true);
    setMessage(undefined);
    try {
      const result = await auth.device[decision]({ userCode: userCode.trim() });
      if (result.error) {
        setMessage(errorMessage(result.error));
        return;
      }
      setState(decision === "approve" ? "approved" : "denied");
    } catch {
      setMessage(errorMessage());
    } finally {
      setLoading(false);
    }
  };

  const signIn = async () => {
    setLoading(true);
    setMessage(undefined);
    try {
      const result = await auth.signIn.social({
        provider: "google",
        callbackURL: deviceCallbackUrl(userCode.trim()),
      });
      if (result.error) setMessage(errorMessage(result.error));
    } catch {
      setMessage(errorMessage());
    } finally {
      setLoading(false);
    }
  };

  const terminalMessage =
    state === "approved"
      ? "デバイスの接続を承認しました。"
      : state === "denied"
        ? "デバイスの接続を拒否しました。"
        : undefined;

  return (
    <Box component="main" id="main-content" sx={{ minHeight: "100dvh", py: { xs: 4, sm: 8 } }}>
      <Container maxWidth="sm">
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 } }}>
          <Stack spacing={3}>
            <Box>
              <Typography variant="overline" color="primary">
                UNFRAME DEVICE AUTHORIZATION
              </Typography>
              <Typography component="h1" variant="h4" sx={{ mt: 0.5 }}>
                デバイスを接続
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                デバイスに表示されたユーザーコードを確認し、接続を承認または拒否します。
              </Typography>
            </Box>

            {message ? <Alert severity="error">{message}</Alert> : null}
            {terminalMessage ? <Alert severity="success">{terminalMessage}</Alert> : null}

            {!sessionReady ? (
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <CircularProgress size={20} />
                <Typography color="text.secondary">ログイン状態を確認しています…</Typography>
              </Stack>
            ) : !signedIn ? (
              <Stack spacing={1.5}>
                <Alert severity="info">コードを確認するには Google でログインしてください。</Alert>
                {sessionFailure ? (
                  <Button variant="text" disabled={loading} onClick={retrySession}>
                    ログイン状態を再確認
                  </Button>
                ) : null}
                <Button
                  variant="contained"
                  startIcon={loading ? <CircularProgress color="inherit" size={18} /> : <Google />}
                  disabled={loading}
                  onClick={() => void signIn()}
                >
                  Google でログイン
                </Button>
              </Stack>
            ) : (
              <>
                <TextField
                  label="ユーザーコード"
                  value={userCode}
                  disabled={loading || state !== "entry"}
                  onChange={(event) => setUserCode(event.target.value.toUpperCase())}
                  placeholder="ABCD-EFGH"
                  autoComplete="one-time-code"
                  slotProps={{ htmlInput: { "aria-label": "ユーザーコード" } }}
                />

                {state === "entry" ? (
                  <Button
                    variant="contained"
                    disabled={loading}
                    onClick={() => void verify()}
                    startIcon={loading ? <CircularProgress color="inherit" size={18} /> : undefined}
                  >
                    コードを確認
                  </Button>
                ) : null}

                {state === "pending" ? (
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                    <Button
                      variant="contained"
                      disabled={loading}
                      onClick={() => void decide("approve")}
                      sx={{ flex: 1 }}
                    >
                      承認する
                    </Button>
                    <Button
                      variant="outlined"
                      color="error"
                      disabled={loading}
                      onClick={() => void decide("deny")}
                      sx={{ flex: 1 }}
                    >
                      拒否する
                    </Button>
                  </Stack>
                ) : null}
              </>
            )}
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
