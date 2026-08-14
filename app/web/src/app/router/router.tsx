import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { z } from "zod";
import { requireSession } from "../auth/require-session";
import { loadPresentationSnapshot } from "../runtime/document-runtime";
import { buttonVariants } from "../../components/ui/button";
import { DeviceAuthorizationPage } from "../../routes/device/device-authorization-page";
import { HomePage } from "../../routes/home/home-page";

const EditorPage = lazy(() =>
  import("../../routes/editor/editor-page").then((module) => ({
    default: module.EditorPage,
  })),
);

function RoutePending() {
  return (
    <main className="grid min-h-dvh place-items-center">
      <p className="text-sm text-[var(--muted)]">プレゼンテーションを準備中…</p>
    </main>
  );
}

function RootLayout() {
  return (
    <>
      <a href="#main-content" className="skip-link">
        本文へ移動
      </a>
      <Outlet />
    </>
  );
}

function LandingPageLink() {
  return (
    <a href="/" className={buttonVariants()}>
      トップへ戻る
    </a>
  );
}

function RouteError() {
  return (
    <main id="main-content" className="grid min-h-dvh place-items-center p-6">
      <div className="grid max-w-xl gap-4">
        <h1 className="text-2xl font-semibold">プレゼンテーションを開けません</h1>
        <p role="alert" className="rounded-md border border-[var(--destructive)] p-3 text-sm">
          読み込みに失敗しました。時間をおいてもう一度お試しください。
        </p>
        <LandingPageLink />
      </div>
    </main>
  );
}

function NotFound() {
  return (
    <main id="main-content" className="grid min-h-dvh place-items-center p-6">
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold">ページが見つかりません</h1>
        <LandingPageLink />
      </div>
    </main>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RouteError,
  notFoundComponent: NotFound,
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

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  beforeLoad: requireSession,
  component: Outlet,
});

const homeRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "home",
  component: HomePage,
});

const editorSearchSchema = z.object({
  panel: z.enum(["properties", "assets", "none"]).catch("properties").default("properties"),
});

const editorRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "editor/$presentationId",
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

const routeTree = rootRoute.addChildren([
  deviceRoute,
  authenticatedRoute.addChildren([homeRoute, editorRoute]),
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
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
