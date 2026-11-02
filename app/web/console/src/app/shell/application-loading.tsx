import { Skeleton } from "@/shared/ui/skeleton";
import shellStyles from "./application-shell.module.css";
import contentStyles from "./application-content.module.css";

export function ApplicationLoading() {
  return (
    <div className={shellStyles["shell"]}>
      <div className={shellStyles["layout"]}>
        <div className={shellStyles["sidebar"]} aria-hidden="true">
          <div className={shellStyles["sidebarBrand"]}>
            <Skeleton className="h-8 w-32" />
          </div>
          <div className={shellStyles["navigation"]}>
            <div className={shellStyles["links"]}>
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className={shellStyles["link"]}>
                  <Skeleton className="size-5 shrink-0" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          </div>
          <div className={shellStyles["sidebarAccount"]}>
            <Skeleton className="size-11 rounded-full" />
          </div>
        </div>
        <div className={shellStyles["content"]}>
          <ApplicationContentLoading id="main-content" />
        </div>
      </div>
    </div>
  );
}

export function ApplicationContentLoading({ id }: { id: string }) {
  return (
    <main id={id} className={contentStyles["main"]}>
      <div role="status" aria-label="ページを読み込んでいます…">
        <header className={contentStyles["heading"]}>
          <Skeleton className="h-12 w-3/4 max-w-lg" />
        </header>
        <div className="grid gap-5 py-8">
          <Skeleton className="h-11 w-40 rounded-full" />
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="grid gap-4 border-b py-6">
              <Skeleton className="h-6 w-1/2 max-w-sm" />
              <Skeleton className="h-4 w-1/3 max-w-56" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
