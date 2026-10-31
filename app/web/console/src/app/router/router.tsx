import {
  Outlet,
  redirect,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { requireSession } from "@/features/auth/require-session";
import { PresentationPage } from "@/features/presentations/presentation-page";
import { RoomPage, RoomsPage } from "@/features/rooms/rooms-page";
import { DeviceAuthorizationPage } from "@/features/device/device-authorization-page";
import { HomePage } from "@/features/presentations/home-page";
import { ApplicationShell } from "@/app/shell/application-shell";
import { ApplicationLoading } from "@/app/shell/application-loading";
import { DevicesPage } from "@/features/device/devices-page";
import { LoginPage } from "@/features/auth/login-page";
import { RecoverPage } from "@/features/auth/recover-page";
import { ResetPage } from "@/features/auth/reset-page";
import { SignupPage } from "@/features/auth/signup-page";
import { ProfilePage, SecurityPage } from "@/features/settings/settings-pages";
import publicModuleStyles from "@/shared/layouts/public-pages.module.css";
import routerModuleStyles from "./router.module.css";
import { NotFoundPage } from "./not-found-page";
import { PublicationPage } from "@/features/publication/publication-page";
const publicStyles = { main: publicModuleStyles["main"]!, panel: publicModuleStyles["panel"]! };
const styles = { skipLink: routerModuleStyles["skipLink"]! };
function Root() {
  return (
    <>
      <a href="#main-content" className={styles.skipLink}>
        本文へ移動
      </a>
      <Outlet />
    </>
  );
}
function ErrorPage() {
  return (
    <main id="main-content" className={publicStyles.main}>
      <section className={publicStyles.panel}>
        <h1>ページを開けません</h1>
        <p role="alert">読み込みに失敗しました。時間をおいてもう一度お試しください。</p>
        <a href="/">トップへ戻る</a>
      </section>
    </main>
  );
}
const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
  errorComponent: ErrorPage,
  notFoundComponent: NotFoundPage,
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "login",
  validateSearch: z.object({
    verified: z.boolean().optional().catch(undefined),
    error: z.string().optional().catch(undefined),
    provider: z.literal("google").optional().catch(undefined),
  }),
  component: () => {
    const { verified, error, provider } = loginRoute.useSearch();
    return (
      <LoginPage
        verified={verified === true}
        error={error ? (provider === "google" ? "oauth" : "verification") : ""}
      />
    );
  },
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
  component: () => <DeviceAuthorizationPage initialUserCode={deviceRoute.useSearch().user_code} />,
});
const applicationRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "application",
  beforeLoad: ({ context }) => requireSession(context.queryClient),
  pendingComponent: ApplicationLoading,
  pendingMs: 150,
  pendingMinMs: 0,
  component: ApplicationShell,
});
const homeRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: "home",
  component: HomePage,
});
const publicationRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: "publish",
  component: PublicationPage,
});
const devicesRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: "devices",
  component: DevicesPage,
});
const roomsRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: "rooms",
  validateSearch: z.object({ presentationId: z.string().catch("") }),
  component: () => {
    const { presentationId } = roomsRoute.useSearch();
    return <RoomsPage key={presentationId} presentationId={presentationId} />;
  },
});
const presentationRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: "presentations/$presentationId",
  component: () => (
    <PresentationPage presentationId={presentationRoute.useParams().presentationId} />
  ),
});
const roomRoute = createRoute({
  getParentRoute: () => applicationRoute,
  path: "rooms/$sessionId",
  component: () => <RoomPage sessionId={roomRoute.useParams().sessionId} />,
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
  path: "editor",
  beforeLoad: () => {
    throw redirect({ to: "/home" });
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
    publicationRoute,
    devicesRoute,
    roomsRoute,
    presentationRoute,
    roomRoute,
    profileRoute,
    securityRoute,
  ]),
]);
export function createAppRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient: undefined! },
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
