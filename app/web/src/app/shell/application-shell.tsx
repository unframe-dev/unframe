import { DropdownMenu } from "@/shared/ui/dropdown-menu";
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
import { controlPlaneAuth } from "@/features/auth/control-plane-auth";
import { BrandLink } from "@/shared/brand/brand-link";
import { Button } from "@/shared/ui/button";
import moduleStyles from "./application-shell.module.css";
const styles = {
  back: moduleStyles["back"]!,
  brand: moduleStyles["brand"]!,
  collapse: moduleStyles["collapse"]!,
  content: moduleStyles["content"]!,
  error: moduleStyles["error"]!,
  label: moduleStyles["label"]!,
  layout: moduleStyles["layout"]!,
  link: moduleStyles["link"]!,
  links: moduleStyles["links"]!,
  menuItem: moduleStyles["menuItem"]!,
  menuLogout: moduleStyles["menuLogout"]!,
  menuPopup: moduleStyles["menuPopup"]!,
  menuPositioner: moduleStyles["menuPositioner"]!,
  menuSeparator: moduleStyles["menuSeparator"]!,
  menuTrigger: moduleStyles["menuTrigger"]!,
  navigation: moduleStyles["navigation"]!,
  shell: moduleStyles["shell"]!,
  sidebar: moduleStyles["sidebar"]!,
  sidebarAccount: moduleStyles["sidebarAccount"]!,
  sidebarBrand: moduleStyles["sidebarBrand"]!,
  title: moduleStyles["title"]!,
};

type NavigationLink = {
  icon: Icon;
  label: string;
  to: "/home" | "/settings/profile" | "/settings/security" | "/devices" | "/rooms";
};

const mainLinks: Array<NavigationLink> = [
  { icon: HouseIcon, label: "ホーム", to: "/home" },
  { icon: GearSixIcon, label: "設定", to: "/settings/profile" },
  { icon: DeviceMobileIcon, label: "デバイス", to: "/devices" },
  { icon: CubeIcon, label: "ルーム", to: "/rooms" },
];

const settingsLinks: Array<NavigationLink> = [
  { icon: UserCircleIcon, label: "プロフィール", to: "/settings/profile" },
  { icon: ShieldCheckIcon, label: "セキュリティー", to: "/settings/security" },
];

const sidebarStorageKey = "unframe-sidebar-collapsed";

function SidebarNavigation({
  collapsed,
  onLogout,
  onToggle,
  pathname,
}: {
  collapsed: boolean;
  onLogout: () => void;
  onToggle: () => void;
  pathname: string;
}) {
  const isSettings = pathname.startsWith("/settings/");
  const links = isSettings ? settingsLinks : mainLinks;

  return (
    <aside
      aria-label="アプリケーションサイドバー"
      className={styles.sidebar}
      data-collapsed={collapsed}
    >
      <div className={styles.sidebarBrand}>
        <BrandLink application className={styles.brand} />
      </div>
      <Button
        aria-expanded={!collapsed}
        aria-label={collapsed ? "サイドバーを展開" : "サイドバーを折り畳む"}
        className={styles.collapse}
        onClick={onToggle}
        size="icon"
        type="button"
        variant="ghost"
      >
        {collapsed ? <CaretRightIcon aria-hidden="true" /> : <CaretLeftIcon aria-hidden="true" />}
      </Button>
      {isSettings && (
        <Link
          aria-label={collapsed ? "メインメニューへ戻る" : undefined}
          className={styles.back}
          to="/home"
        >
          <ArrowLeftIcon aria-hidden="true" />
          <span className={styles.label}>メインメニューへ戻る</span>
        </Link>
      )}
      <nav
        aria-label={isSettings ? "設定ナビゲーション" : "メインナビゲーション"}
        className={styles.navigation}
      >
        {isSettings && <p className={styles.title}>設定</p>}
        <div className={styles.links}>
          {links.map(({ icon: Icon, label, to }) => {
            const isCurrent =
              pathname === to || (to === "/settings/profile" && pathname === "/settings");
            return (
              <Link
                aria-current={isCurrent ? "page" : undefined}
                aria-label={collapsed ? label : undefined}
                className={styles.link}
                key={to}
                to={to}
              >
                <Icon aria-hidden="true" />
                <span className={styles.label}>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      <div className={styles.sidebarAccount}>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger
            render={
              <Button
                aria-label="アカウントメニュー"
                className={styles.menuTrigger}
                size="icon"
                variant="outline"
              />
            }
          >
            <UserCircleIcon aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Positioner
              align="end"
              className={styles.menuPositioner}
              side="bottom"
              sideOffset={10}
            >
              <DropdownMenu.Popup className={styles.menuPopup}>
                <DropdownMenu.LinkItem
                  className={styles.menuItem}
                  closeOnClick
                  render={<Link to="/settings/profile" />}
                >
                  設定
                </DropdownMenu.LinkItem>
                <DropdownMenu.Separator className={styles.menuSeparator} />
                <DropdownMenu.Item
                  className={`${styles.menuItem} ${styles.menuLogout}`}
                  onClick={onLogout}
                >
                  ログアウト
                  <ArrowUpRightIcon aria-hidden="true" />
                </DropdownMenu.Item>
              </DropdownMenu.Popup>
            </DropdownMenu.Positioner>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
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
          collapsed={sidebarCollapsed}
          onLogout={() => void logout()}
          onToggle={toggleSidebar}
          pathname={pathname}
        />
        <div className={styles.content}>
          {logoutError ? (
            <p className={styles.error} role="alert">
              {logoutError}
            </p>
          ) : null}
          <Outlet />
        </div>
      </div>
    </div>
  );
}
