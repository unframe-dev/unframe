import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { z } from "zod";
import { loadPresentationSnapshot } from "../runtime/document-runtime";
import { DeviceAuthorizationPage } from "../../routes/device/device-authorization-page";
import { HomePage } from "../../routes/home/home-page";
import { ApplicationShell } from "../../routes/application/application-shell";
import {
  DevicesPage,
  RoomsPage,
} from "../../routes/application/application-placeholder-pages";
import {
  LoginPage,
  RecoverPage,
  ResetPage,
  SignupPage,
} from "../../routes/auth/auth-pages";
import {
  ProfilePage,
  SecurityPage,
} from "../../routes/settings/settings-pages";
const EditorPage = lazy(() =>
  import("../../routes/editor/editor-page").then((module) => ({
    default: module.EditorPage,
  })),
);
function Root() {
  return (
    <>
      <a href="#main-content" className="skip-link">
        本文へ移動
      </a>
      <Outlet />
    </>
  );
}
function ErrorPage() {
  return (
    <main id="main-content" className="auth-main">
      <section className="auth-panel">
        <h1>ページを開けません</h1>
        <p role="alert">
          読み込みに失敗しました。時間をおいてもう一度お試しください。
        </p>
        <a href="/">トップへ戻る</a>
      </section>
    </main>
  );
}
function NotFound() {
  return (
    <main id="main-content" className="auth-main">
      <section className="auth-panel">
        <h1>ページが見つかりません</h1>
        <a href="/">トップへ戻る</a>
      </section>
    </main>
  );
}
const rootRoute = createRootRoute({
  component: Root,
  errorComponent: ErrorPage,
  notFoundComponent: NotFound,
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "login",
  component: LoginPage,
});
const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "signup",
  component: SignupPage,
});
const recoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "recover",
  component: RecoverPage,
});
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "recover/reset",
  validateSearch: z.object({ token: z.string().catch("") }),
  component: () => <ResetPage token={resetRoute.useSearch().token} />,
});
const deviceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "device",
  validateSearch: z.object({ user_code: z.string().catch("") }),
  component: () => (
    <DeviceAuthorizationPage
      initialUserCode={deviceRoute.useSearch().user_code}
    />
  ),
});
const applicationRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "application", // Local session setup is still in progress; restore beforeLoad when it is available.
  // beforeLoad: requireSession,
  component: ApplicationShell,
});
const homeRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: "home",
  component: HomePage,
});
const devicesRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: "devices",
  component: DevicesPage,
});
const roomsRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: "rooms",
  component: RoomsPage,
});
const profileRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: "settings/profile",
  component: ProfilePage,
});
const securityRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: "settings/security",
  component: SecurityPage,
});
const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "editor/$presentationId",
  validateSearch: z.object({
    panel: z.enum(["properties", "assets", "none"]).catch("properties"),
  }),
  loader: ({ params }) => loadPresentationSnapshot(params.presentationId),
  component: () => {
    const document = editorRoute.useLoaderData();
    const { panel } = editorRoute.useSearch();
    return (
      <Suspense fallback={<main>準備中…</main>}>
        <EditorPage document={document} panel={panel} />
      </Suspense>
    );
  },
});
const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  recoverRoute,
  resetRoute,
  deviceRoute,
  editorRoute,
  applicationRoute.addChildren([
    homeRoute,
    devicesRoute,
    roomsRoute,
    profileRoute,
    securityRoute,
  ]),
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
