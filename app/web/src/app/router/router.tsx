import { Alert, Box, Button, Stack, Typography } from "@mui/material";
import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { z } from "zod";
import { loadPresentationSnapshot } from "../runtime/document-runtime";
import { EditorPage } from "../../routes/editor/editor-page";
import { HomePage } from "../../routes/home/home-page";
import { ViewerPage } from "../../routes/viewer/viewer-page";

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
  return <EditorPage document={document} panel={panel} />;
}

const viewerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "presentations/$presentationId/view",
  loader: ({ params }) => loadPresentationSnapshot(params.presentationId),
  component: ViewerRouteComponent,
});

function ViewerRouteComponent() {
  return <ViewerPage document={viewerRoute.useLoaderData()} />;
}

const routeTree = rootRoute.addChildren([indexRoute, editorRoute, viewerRoute]);

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
