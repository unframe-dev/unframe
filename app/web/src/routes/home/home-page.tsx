import { Dialog } from "@base-ui/react/dialog";
import { ClockIcon, MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import moduleStyles from "./home-page.module.css";
const styles = {
  main: moduleStyles["main"]!,
  surface: moduleStyles["surface"]!,
  header: moduleStyles["header"]!,
  title: moduleStyles["title"]!,
  actions: moduleStyles["actions"]!,
  search: moduleStyles["search"]!,
  content: moduleStyles["content"]!,
  error: moduleStyles["error"]!,
  muted: moduleStyles["muted"]!,
  grid: moduleStyles["grid"]!,
  card: moduleStyles["card"]!,
  thumbnail: moduleStyles["thumbnail"]!,
  updated: moduleStyles["updated"]!,
  backdrop: moduleStyles["backdrop"]!,
  viewport: moduleStyles["viewport"]!,
  popup: moduleStyles["popup"]!,
  dialogHeading: moduleStyles["dialogHeading"]!,
  close: moduleStyles["close"]!,
  form: moduleStyles["form"]!,
  actionsDialog: moduleStyles["actionsDialog"]!,
};
import {
  createMockPresentation,
  listMockPresentations,
  type Presentation,
} from "../../features/presentations/mock-presentation-repository";

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(new Date(value));
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
      item.definition.metadata.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    );
  return (
    <main id="main-content" className={styles.main}>
      <section className={styles.surface} aria-label="プレゼンテーション">
        <header className={styles.header}>
          <div className={styles.title}>
            <h1>Presentations.</h1>
          </div>
          <div className={styles.actions}>
            <label className={styles.search}>
              <MagnifyingGlassIcon aria-hidden="true" />
              <span className="sr-only">タイトルを検索</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="タイトルを検索"
              />
            </label>
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon aria-hidden="true" />
              新規作成
            </Button>
          </div>
        </header>
        <div className={styles.content}>
          {presentations.isPending ? (
            <p role="status">プレゼンテーションを読み込み中…</p>
          ) : presentations.isError ? (
            <div>
              <p role="alert" className={styles.error}>
                プレゼンテーションを読み込めませんでした。
              </p>
              <Button variant="outline" onClick={() => presentations.refetch()}>
                再試行
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div>
              <p className={styles.muted}>
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
            <ul className={styles.grid}>
              {items.map((presentation) => (
                <li className={styles.card} key={presentation.id}>
                  <div className={styles.thumbnail}>
                    <img
                      src={presentation.thumbnailUrl}
                      alt={`${presentation.definition.metadata.title}のサムネイル`}
                      loading="lazy"
                    />
                    <p
                      className={styles.updated}
                      aria-label={`更新日時 ${formatUpdatedAt(presentation.updatedAt)}`}
                    >
                      <ClockIcon aria-hidden="true" />
                      <time dateTime={presentation.updatedAt}>
                        {formatUpdatedAt(presentation.updatedAt)}
                      </time>
                    </p>
                    <h2>{presentation.definition.metadata.title}</h2>
                  </div>
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
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Viewport className={styles.viewport}>
            <Dialog.Popup className={styles.popup}>
              <div className={styles.dialogHeading}>
                <div>
                  <Dialog.Title>プレゼンテーションを作成</Dialog.Title>
                  <Dialog.Description>
                    タイトルを決めて、空間プレゼンテーションを始めます。
                  </Dialog.Description>
                </div>
                <Dialog.Close
                  className={styles.close}
                  aria-label="閉じる"
                  disabled={create.isPending}
                >
                  <XIcon aria-hidden="true" />
                </Dialog.Close>
              </div>
              <form
                className={styles.form}
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
                  <p role="alert" className={styles.error}>
                    {create.error.message}
                  </p>
                ) : null}
                <div className={styles.actionsDialog}>
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
