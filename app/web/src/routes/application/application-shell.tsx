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
      className="app-sidebar"
      data-collapsed={collapsed}
      aria-label="アプリケーションサイドバー"
    >
      <div className="sidebar-brand">
        <BrandLink application />
      </div>
      <button
        className="sidebar-collapse"
        type="button"
        aria-label={collapsed ? "サイドバーを展開" : "サイドバーを折り畳む"}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {collapsed ? <CaretRightIcon aria-hidden="true" /> : <CaretLeftIcon aria-hidden="true" />}
      </button>
      {isSettings && (
        <Link
          className="sidebar-back"
          to="/home"
          aria-label={collapsed ? "メインメニューへ戻る" : undefined}
        >
          <ArrowLeftIcon aria-hidden="true" />
          <span className="sidebar-label">メインメニューへ戻る</span>
        </Link>
      )}
      <nav
        className="sidebar-navigation"
        aria-label={isSettings ? "設定ナビゲーション" : "メインナビゲーション"}
      >
        {isSettings && <p className="sidebar-title">設定</p>}
        <div className="sidebar-links">
          {links.map(({ to, label, icon: Icon }) => {
            const isCurrent =
              pathname === to || (to === "/settings/profile" && pathname === "/settings");
            return (
              <Link
                key={to}
                className="sidebar-link"
                to={to}
                aria-current={isCurrent ? "page" : undefined}
                aria-label={collapsed ? label : undefined}
              >
                <Icon aria-hidden="true" />
                <span className="sidebar-label">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      <div className="sidebar-account">
        <Menu.Root modal={false}>
          <Menu.Trigger
            render={
              <Button
                className="account-menu-trigger"
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
              className="account-menu-positioner"
              side="bottom"
              align="end"
              sideOffset={10}
            >
              <Menu.Popup className="account-menu-popup">
                <Menu.LinkItem
                  closeOnClick
                  className="account-menu-item"
                  render={<Link to="/settings/profile" />}
                >
                  設定
                </Menu.LinkItem>
                <Menu.Separator className="account-menu-separator" />
                <Menu.Item className="account-menu-item account-menu-logout" onClick={onLogout}>
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
  const toggleSidebar = () => {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(sidebarStorageKey, String(next));
      return next;
    });
  };
  const logout = async () => {
    await controlPlaneAuth.signOut();
    window.location.assign("/");
  };
  return (
    <div className="app-shell">
      <div className="app-layout" data-sidebar-collapsed={sidebarCollapsed}>
        <SidebarNavigation
          pathname={pathname}
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          onLogout={() => void logout()}
        />
        <div className="app-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
