import { Menu } from "@base-ui/react/menu";
import {
  ArrowLeftIcon,
  ArrowUpRightIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CubeIcon,
  DeviceMobileIcon,
  GearSixIcon,
  HouseIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { controlPlaneAuth } from "../../app/auth/control-plane-auth";
import { BrandLink } from "../../app/brand/brand-link";
import { Button } from "../../components/ui/button";
import moduleStyles from "./application-shell.module.css";
const styles = {
  sidebar: moduleStyles["sidebar"]!,
  sidebarBrand: moduleStyles["sidebarBrand"]!,
  brand: moduleStyles["brand"]!,
  collapse: moduleStyles["collapse"]!,
  back: moduleStyles["back"]!,
  label: moduleStyles["label"]!,
  navigation: moduleStyles["navigation"]!,
  title: moduleStyles["title"]!,
  links: moduleStyles["links"]!,
  link: moduleStyles["link"]!,
  sidebarAccount: moduleStyles["sidebarAccount"]!,
  menuTrigger: moduleStyles["menuTrigger"]!,
  menuPositioner: moduleStyles["menuPositioner"]!,
  menuPopup: moduleStyles["menuPopup"]!,
  menuItem: moduleStyles["menuItem"]!,
  menuSeparator: moduleStyles["menuSeparator"]!,
  menuLogout: moduleStyles["menuLogout"]!,
  shell: moduleStyles["shell"]!,
  layout: moduleStyles["layout"]!,
  content: moduleStyles["content"]!,
  error: moduleStyles["error"]!,
};

type NavigationLink = {
  to: "/home" | "/settings/profile" | "/settings/security" | "/devices" | "/rooms";
  label: string;
  icon: Icon;
};

const mainLinks: NavigationLink[] = [
  { to: "/home", label: "ホーム", icon: HouseIcon },
  { to: "/settings/profile", label: "設定", icon: GearSixIcon },
  { to: "/devices", label: "デバイス", icon: DeviceMobileIcon },
  { to: "/rooms", label: "ルーム", icon: CubeIcon },
];

const settingsLinks: NavigationLink[] = [
  { to: "/settings/profile", label: "プロフィール", icon: UserCircleIcon },
  { to: "/settings/security", label: "セキュリティー", icon: ShieldCheckIcon },
];

const sidebarStorageKey = "unframe-sidebar-collapsed";

function SidebarNavigation({
  pathname,
  collapsed,
  onToggle,
  onLogout,
}: {
  pathname: string;
  collapsed: boolean;
  onToggle: () => void;
  onLogout: () => void;
}) {
  const isSettings = pathname.startsWith("/settings/");
  const links = isSettings ? settingsLinks : mainLinks;

  return (
    <aside
      className={styles.sidebar}
      data-collapsed={collapsed}
      aria-label="アプリケーションサイドバー"
    >
      <div className={styles.sidebarBrand}>
        <BrandLink application className={styles.brand} />
      </div>
      <button
        className={styles.collapse}
        type="button"
        aria-label={collapsed ? "サイドバーを展開" : "サイドバーを折り畳む"}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {collapsed ? <CaretRightIcon aria-hidden="true" /> : <CaretLeftIcon aria-hidden="true" />}
      </button>
      {isSettings && (
        <Link
          className={styles.back}
          to="/home"
          aria-label={collapsed ? "メインメニューへ戻る" : undefined}
        >
          <ArrowLeftIcon aria-hidden="true" />
          <span className={styles.label}>メインメニューへ戻る</span>
        </Link>
      )}
      <nav
        className={styles.navigation}
        aria-label={isSettings ? "設定ナビゲーション" : "メインナビゲーション"}
      >
        {isSettings && <p className={styles.title}>設定</p>}
        <div className={styles.links}>
          {links.map(({ to, label, icon: Icon }) => {
            const isCurrent =
              pathname === to || (to === "/settings/profile" && pathname === "/settings");
            return (
              <Link
                key={to}
                className={styles.link}
                to={to}
                aria-current={isCurrent ? "page" : undefined}
                aria-label={collapsed ? label : undefined}
              >
                <Icon aria-hidden="true" />
                <span className={styles.label}>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      <div className={styles.sidebarAccount}>
        <Menu.Root modal={false}>
          <Menu.Trigger
            render={
              <Button
                className={styles.menuTrigger}
                variant="outline"
                size="icon"
                aria-label="アカウントメニュー"
              />
            }
          >
            <UserCircleIcon aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner
              className={styles.menuPositioner}
              side="bottom"
              align="end"
              sideOffset={10}
            >
              <Menu.Popup className={styles.menuPopup}>
                <Menu.LinkItem
                  closeOnClick
                  className={styles.menuItem}
                  render={<Link to="/settings/profile" />}
                >
                  設定
                </Menu.LinkItem>
                <Menu.Separator className={styles.menuSeparator} />
                <Menu.Item className={`${styles.menuItem} ${styles.menuLogout}`} onClick={onLogout}>
                  ログアウト
                  <ArrowUpRightIcon aria-hidden="true" />
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </aside>
  );
}

export function ApplicationShell() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem(sidebarStorageKey) === "true",
  );
  const [logoutError, setLogoutError] = useState("");
  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(sidebarStorageKey, String(next));
      return next;
    });
  };
  const logout = async () => {
    setLogoutError("");
    try {
      const result = await controlPlaneAuth.signOut();
      if (result.error) {
        setLogoutError("ログアウトできませんでした。もう一度お試しください。");
        return;
      }
      window.location.assign("/");
    } catch {
      setLogoutError("ログアウトできませんでした。もう一度お試しください。");
    }
  };
  return (
    <div className={styles.shell}>
      <div className={styles.layout} data-sidebar-collapsed={sidebarCollapsed}>
        <SidebarNavigation
          pathname={pathname}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          onLogout={() => void logout()}
        />
        <div className={styles.content}>
          {logoutError ? (
            <p role="alert" className={styles.error}>
              {logoutError}
            </p>
          ) : null}
          <Outlet />
        </div>
      </div>
    </div>
  );
}
