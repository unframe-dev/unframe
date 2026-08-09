import { Alert, Box, Button, CircularProgress, Stack, Typography } from "@mui/material";
import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { z } from "zod";
import { lazy, Suspense } from "react";
import { loadPresentationSnapshot } from "../runtime/document-runtime";
import { HomePage } from "../../routes/home/home-page";
import { DeviceAuthorizationPage } from "../../routes/device/device-authorization-page";

const EditorPage = lazy(() =>
  import("../../routes/editor/editor-page").then((module) => ({
    default: module.EditorPage,
  })),
);
const ViewerPage = lazy(() =>
  import("../../routes/viewer/viewer-page").then((module) => ({
    default: module.ViewerPage,
  })),
);

function RoutePending() {
  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center" }}>
      <Stack spacing={1.5} sx={{ alignItems: "center" }}>
        <CircularProgress size={28} />
        <Typography color="text.secondary">プレゼンテーションを準備中…</Typography>
      </Stack>
    </Box>
  );
}

function RootLayout() {
  return (
    <>
      <Box component="a" href="#main-content" className="skip-link">
        本文へ移動
      </Box>
      <Outlet />
    </>
  );
}

function RouteError({ error }: { error: Error }) {
  return (
    <Box
      component="main"
      id="main-content"
      sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", p: 3 }}
    >
      <Stack spacing={2} sx={{ maxWidth: 560 }}>
        <Typography component="h1" variant="h4">
          プレゼンテーションを開けません
        </Typography>
        <Alert severity="error">{error.message}</Alert>
        <Button component={Link} to="/" variant="contained">
          ホームへ戻る
        </Button>
      </Stack>
    </Box>
  );
}

function NotFound() {
  return (
    <Box
      component="main"
      id="main-content"
      sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", p: 3 }}
    >
      <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
        <Typography component="h1" variant="h4">
          ページが見つかりません
        </Typography>
        <Button component={Link} to="/" variant="contained">
          ホームへ戻る
        </Button>
      </Stack>
    </Box>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: ({ error }) => <RouteError error={error} />,
  notFoundComponent: NotFound,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const editorSearchSchema = z.object({
  panel: z.enum(["properties", "assets", "none"]).catch("properties").default("properties"),
});

const deviceSearchSchema = z.object({
  user_code: z.string().catch("").default(""),
});

const deviceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "device",
  validateSearch: deviceSearchSchema,
  component: DeviceRouteComponent,
});

function DeviceRouteComponent() {
  const { user_code: userCode } = deviceRoute.useSearch();
  return <DeviceAuthorizationPage initialUserCode={userCode} />;
}

const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "presentations/$presentationId/edit",
  validateSearch: editorSearchSchema,
  loader: ({ params }) => loadPresentationSnapshot(params.presentationId),
  component: EditorRouteComponent,
});

function EditorRouteComponent() {
  const document = editorRoute.useLoaderData();
  const { panel } = editorRoute.useSearch();
  return (
    <Suspense fallback={<RoutePending />}>
      <EditorPage document={document} panel={panel} />
    </Suspense>
  );
}

const viewerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "presentations/$presentationId/view",
  loader: ({ params }) => loadPresentationSnapshot(params.presentationId),
  component: ViewerRouteComponent,
});

function ViewerRouteComponent() {
  return (
    <Suspense fallback={<RoutePending />}>
      <ViewerPage document={viewerRoute.useLoaderData()} />
    </Suspense>
  );
}

const routeTree = rootRoute.addChildren([indexRoute, deviceRoute, editorRoute, viewerRoute]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    basepath: "/editor",
    ...(history ? { history } : {}),
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });
}

export const appRouter = createAppRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof appRouter;
  }
}
