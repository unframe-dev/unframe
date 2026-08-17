import { Dialog } from "@base-ui/react/dialog";
import { MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  createMockPresentation,
  listMockPresentations,
  type Presentation,
} from "../../features/presentations/mock-presentation-repository";

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(
    new Date(value),
  );
}
export function HomePage() {
  const client = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const presentations = useQuery({
    queryKey: ["presentations", "mock"],
    queryFn: listMockPresentations,
  });
  const create = useMutation({
    mutationFn: () => createMockPresentation(title.trim(), description.trim()),
    onSuccess: (created) => {
      client.setQueryData<Presentation[]>(["presentations", "mock"], (old = []) => [
        created,
        ...old,
      ]);
      setTitle("");
      setDescription("");
      setCreateOpen(false);
    },
  });
  const items = (presentations.data ?? [])
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((item) =>
      item.definition.metadata.title
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    );
  return (
    <main id="main-content" className="app-main workspace-main">
      <section className="workspace-surface" aria-label="プレゼンテーション">
        <header className="workspace-header">
          <div className="workspace-title">
            <h1>Presentations.</h1>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon aria-hidden="true" />
            新規作成
          </Button>
        </header>
        <div className="workspace-toolbar">
          <p className="resource-count">
            {items.length.toString().padStart(2, "0")} items
          </p>
          <label className="search">
            <MagnifyingGlassIcon aria-hidden="true" />
            <span className="sr-only">タイトルを検索</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="タイトルを検索"
            />
          </label>
        </div>
        <div className="workspace-content">
          {presentations.isPending ? (
            <p role="status">プレゼンテーションを読み込み中…</p>
          ) : presentations.isError ? (
            <div>
              <p role="alert" className="status-error">
                プレゼンテーションを読み込めませんでした。
              </p>
              <Button variant="outline" onClick={() => presentations.refetch()}>
                再試行
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div>
              <p className="muted">
                {search
                  ? "一致するプレゼンテーションはありません。"
                  : "プレゼンテーションはまだありません。"}
              </p>
              {!search ? (
                <Button variant="outline" onClick={() => presentations.refetch()}>
                  再読み込み
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="resource-list">
              {items.map((presentation) => (
                <li key={presentation.id}>
                  <h2>{presentation.definition.metadata.title}</h2>
                  <p>
                    更新 {formatUpdatedAt(presentation.updatedAt)} · Revision{" "}
                    {presentation.revision}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <Dialog.Root
        open={createOpen}
        onOpenChange={(open) => {
          if (!create.isPending) {
            setCreateOpen(open);
            if (!open) create.reset();
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Viewport className="dialog-viewport">
            <Dialog.Popup className="dialog-popup">
              <div className="dialog-heading">
                <div>
                  <Dialog.Title>プレゼンテーションを作成</Dialog.Title>
                  <Dialog.Description>
                    タイトルを決めて、空間プレゼンテーションを始めます。
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  className="dialog-close"
                  aria-label="閉じる"
                  disabled={create.isPending}
                >
                  <XIcon aria-hidden="true" />
                </Dialog.Close>
              </div>
              <form
                className="dialog-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (title.trim() && !create.isPending) create.mutate();
                }}
              >
                <label>
                  タイトル
                  <input
                    required
                    autoFocus
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={256}
                    placeholder="Untitled presentation"
                  />
                </label>
                <label>
                  説明（任意）
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={4000}
                    placeholder="このプレゼンテーションについて"
                  />
                </label>
                {create.isError ? (
                  <p role="alert" className="status-error">
                    {create.error.message}
                  </p>
                ) : null}
                <div className="dialog-actions">
                  <Dialog.Close
                    render={<Button type="button" variant="ghost" />}
                    disabled={create.isPending}
                  >
                    キャンセル
                  </Dialog.Close>
                  <Button type="submit" disabled={!title.trim() || create.isPending}>
                    <PlusIcon aria-hidden="true" />
                    {create.isPending ? "作成中…" : "作成する"}
                  </Button>
                </div>
              </form>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
