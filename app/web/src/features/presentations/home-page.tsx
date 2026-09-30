import { Dialog } from "@/shared/ui/dialog";
import { ClockIcon, MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import moduleStyles from "./home-page.module.css";
const styles = {
  actions: moduleStyles["actions"]!,
  actionsDialog: moduleStyles["actionsDialog"]!,
  backdrop: moduleStyles["backdrop"]!,
  card: moduleStyles["card"]!,
  close: moduleStyles["close"]!,
  content: moduleStyles["content"]!,
  dialogHeading: moduleStyles["dialogHeading"]!,
  error: moduleStyles["error"]!,
  form: moduleStyles["form"]!,
  grid: moduleStyles["grid"]!,
  header: moduleStyles["header"]!,
  main: moduleStyles["main"]!,
  muted: moduleStyles["muted"]!,
  popup: moduleStyles["popup"]!,
  search: moduleStyles["search"]!,
  surface: moduleStyles["surface"]!,
  thumbnail: moduleStyles["thumbnail"]!,
  title: moduleStyles["title"]!,
  updated: moduleStyles["updated"]!,
  viewport: moduleStyles["viewport"]!,
};
import {
  createMockPresentation,
  listMockPresentations,
  type Presentation,
} from "@/features/presentations/mock-presentation-repository";

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
    queryFn: listMockPresentations,
    queryKey: ["presentations", "mock"],
  });
  const create = useMutation({
    mutationFn: () => createMockPresentation(title.trim(), description.trim()),
    onSuccess: (created) => {
      client.setQueryData<Array<Presentation>>(["presentations", "mock"], (old = []) => [
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
    <main className={styles.main} id="main-content">
      <section aria-label="プレゼンテーション" className={styles.surface}>
        <header className={styles.header}>
          <div className={styles.title}>
            <h1>Presentations.</h1>
          </div>
          <div className={styles.actions}>
            <Label className={styles.search}>
              <MagnifyingGlassIcon aria-hidden="true" />
              <span className="sr-only">タイトルを検索</span>
              <Input
                onChange={(e) => setSearch(e.target.value)}
                placeholder="タイトルを検索"
                value={search}
              />
            </Label>
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
              <p className={styles.error} role="alert">
                プレゼンテーションを読み込めませんでした。
              </p>
              <Button onClick={() => presentations.refetch()} variant="outline">
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
                <Button onClick={() => presentations.refetch()} variant="outline">
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
                      alt={`${presentation.definition.metadata.title}のサムネイル`}
                      loading="lazy"
                      src={presentation.thumbnailUrl}
                    />
                    <p
                      aria-label={`更新日時 ${formatUpdatedAt(presentation.updatedAt)}`}
                      className={styles.updated}
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
        onOpenChange={(open) => {
          if (!create.isPending) {
            setCreateOpen(open);
            if (!open) {
              create.reset();
            }
          }
        }}
        open={createOpen}
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
                  aria-label="閉じる"
                  className={styles.close}
                  disabled={create.isPending}
                >
                  <XIcon aria-hidden="true" />
                </Dialog.Close>
              </div>
              <form
                className={styles.form}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (title.trim() && !create.isPending) {
                    create.mutate();
                  }
                }}
              >
                <Label>
                  タイトル
                  <Input
                    autoFocus
                    maxLength={256}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Untitled presentation"
                    required
                    value={title}
                  />
                </Label>
                <Label>
                  説明（任意）
                  <Input
                    maxLength={4000}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="このプレゼンテーションについて"
                    value={description}
                  />
                </Label>
                {create.isError ? (
                  <p className={styles.error} role="alert">
                    {create.error.message}
                  </p>
                ) : null}
                <div className={styles.actionsDialog}>
                  <Dialog.Close
                    disabled={create.isPending}
                    render={<Button type="button" variant="ghost" />}
                  >
                    キャンセル
                  </Dialog.Close>
                  <Button disabled={!title.trim() || create.isPending} type="submit">
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
