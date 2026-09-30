import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { z } from "zod";
import { requireSession } from "@/features/auth/require-session";
import { loadPresentationSnapshot } from "@/features/editor/infra/document-runtime";
import { DeviceAuthorizationPage } from "@/features/device/device-authorization-page";
import { HomePage } from "@/features/presentations/home-page";
import { ApplicationShell } from "@/app/shell/application-shell";
import { DevicesPage, RoomsPage } from "@/app/shell/application-placeholder-pages";
import { LoginPage, RecoverPage, ResetPage, SignupPage } from "@/features/auth/auth-pages";
import { ProfilePage, SecurityPage } from "@/features/settings/settings-pages";
import publicModuleStyles from "@/shared/layouts/public-pages.module.css";
import routerModuleStyles from "./router.module.css";
const publicStyles = { main: publicModuleStyles["main"]!, panel: publicModuleStyles["panel"]! };
const styles = { skipLink: routerModuleStyles["skipLink"]! };
const EditorPage = lazy(() =>
  import("@/features/editor/ui/editor-page").then((module) => ({
    default: module.EditorPage,
  })),
);
function Root() {
  return (
    <>
      <a className={styles.skipLink} href="#main-content">
        本文へ移動
      </a>
      <Outlet />
    </>
  );
}
function ErrorPage() {
  return (
    <main className={publicStyles.main} id="main-content">
      <section className={publicStyles.panel}>
        <h1>ページを開けません</h1>
        <p role="alert">読み込みに失敗しました。時間をおいてもう一度お試しください。</p>
        <a href="/">トップへ戻る</a>
      </section>
    </main>
  );
}
function NotFound() {
  return (
    <main className={publicStyles.main} id="main-content">
      <section className={publicStyles.panel}>
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
  component: LoginPage,
  getParentRoute: () => rootRoute,
  path: "login",
});
const signupRoute = createRoute({
  component: SignupPage,
  getParentRoute: () => rootRoute,
  path: "signup",
});
const recoverRoute = createRoute({
  component: RecoverPage,
  getParentRoute: () => rootRoute,
  path: "recover",
});
const resetRoute = createRoute({
  component: () => <ResetPage token={resetRoute.useSearch().token} />,
  getParentRoute: () => rootRoute,
  path: "recover/reset",
  validateSearch: z.object({ token: z.string().catch("") }),
});
const deviceRoute = createRoute({
  component: () => <DeviceAuthorizationPage initialUserCode={deviceRoute.useSearch().user_code} />,
  getParentRoute: () => rootRoute,
  path: "device",
  validateSearch: z.object({ user_code: z.string().catch("") }),
});
const applicationRoute = createRoute({
  beforeLoad: requireSession,
  component: ApplicationShell,
  getParentRoute: () => rootRoute,
  id: "application",
});
const homeRoute = createRoute({
  component: HomePage,
  getParentRoute: () => applicationRoute,
  path: "home",
});
const devicesRoute = createRoute({
  component: DevicesPage,
  getParentRoute: () => applicationRoute,
  path: "devices",
});
const roomsRoute = createRoute({
  component: RoomsPage,
  getParentRoute: () => applicationRoute,
  path: "rooms",
});
const profileRoute = createRoute({
  component: ProfilePage,
  getParentRoute: () => applicationRoute,
  path: "settings/profile",
});
const securityRoute = createRoute({
  component: SecurityPage,
  getParentRoute: () => applicationRoute,
  path: "settings/security",
});
const editorRoute = createRoute({
  component: () => {
    const document = editorRoute.useLoaderData();
    const { panel } = editorRoute.useSearch();
    return (
      <Suspense fallback={<main>準備中…</main>}>
        <EditorPage document={document} panel={panel} />
      </Suspense>
    );
  },
  getParentRoute: () => applicationRoute,
  loader: ({ params }) => loadPresentationSnapshot(params.presentationId),
  path: "editor/$presentationId",
  validateSearch: z.object({
    panel: z.enum(["properties", "assets", "none"]).catch("properties"),
  }),
});
const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  recoverRoute,
  resetRoute,
  deviceRoute,
  applicationRoute.addChildren([
    homeRoute,
    devicesRoute,
    roomsRoute,
    profileRoute,
    securityRoute,
    editorRoute,
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
