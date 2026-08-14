import { ArrowRightIcon, CubeIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { BrandMark } from "../../app/brand/brand-mark";
import { buttonVariants } from "../../components/ui/button";

export function HomePage() {
  return (
    <main id="main-content" className="min-h-dvh bg-[var(--background)]">
      <header className="flex min-h-16 items-center justify-between border-b bg-white px-5 md:px-10">
        <div className="flex items-center gap-3">
          <BrandMark size={28} />
          <span className="text-xl font-semibold tracking-tight">Unframe</span>
        </div>
        <span className="rounded-md border px-2 py-1 text-xs font-semibold">Preview</span>
      </header>
      <section className="mx-auto max-w-6xl px-5 py-16 md:px-10">
        <p className="text-xs font-bold tracking-[.12em] text-[#9a80d0]">WORKSPACE / HOME</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight md:text-5xl">
          空間を、プレゼンテーションに。
        </h1>
        <p className="mt-5 max-w-xl leading-7 text-[var(--muted)]">
          作業中のプレゼンテーションを開き、3Dモデルとメッセージをひとつの資料として編集します。
        </p>
        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_300px]">
          <section className="overflow-hidden rounded-xl border bg-white">
            <div className="flex gap-4 p-6">
              <div className="grid size-11 place-items-center rounded-lg bg-[#7187f51f] text-[#7187f5]">
                <CubeIcon size={24} />
              </div>
              <div>
                <h2 className="font-semibold">最近のプレゼンテーション</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">1件のローカルプレビュー</p>
              </div>
            </div>
            <div className="border-t" />
            <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
              <div className="flex-1">
                <h2 className="font-semibold">Spatial story</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  2 slides · GLB model · Revision 0
                </p>
              </div>
              <Link
                to="/editor/$presentationId"
                params={{ presentationId: "demo" }}
                search={{ panel: "properties" }}
                className={buttonVariants()}
              >
                デモを編集 <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </div>
          </section>
          <aside className="rounded-xl border bg-white p-6">
            <p className="text-xs font-bold tracking-[.12em] text-[#9a80d0]">WORKSPACE STATUS</p>
            <dl className="mt-5 grid gap-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted)]">同期</dt>
                <dd>ブラウザ内共有</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted)]">編集対象</dt>
                <dd>2 slides</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--muted)]">状態</dt>
                <dd className="text-emerald-700">待機中</dd>
              </div>
            </dl>
          </aside>
        </div>
      </section>
    </main>
  );
}
