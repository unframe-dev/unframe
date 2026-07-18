<script lang="ts">
  import { ArrowUpRight, BookOpen, CalendarDays, FileText } from "@lucide/svelte";
  import type { Component } from "svelte";
  import Header from "../layout/Header.svelte";
  import Footer from "../layout/Footer.svelte";
  import type { ContentEntry } from "$lib/content-registry";

  type ContentKind = "News" | "Docs";

  let {
    entries,
    kind,
    title,
    description,
  } = $props<{
    entries: ContentEntry<Component>[];
    kind: ContentKind;
    title: string;
    description: string;
  }>();

  const basePath = $derived(kind.toLowerCase());
  const sourceQuery = $derived(kind === "News" ? "?from=news" : "");
</script>

<svelte:head>
  <title>{kind} | Unframe</title>
  <meta name="description" content={description} />
</svelte:head>

<Header />

<main class="min-h-screen bg-background text-night">
  <section class="relative overflow-hidden px-6 pb-20 pt-40 sm:px-10 sm:pb-28 lg:px-14">
    <div class="absolute -right-24 top-20 h-72 w-72 rounded-full bg-brand-purple/10 blur-3xl"></div>
    <div class="relative mx-auto max-w-[1100px]">
      <div class="eyebrow flex items-center gap-3 text-night/50">
        <span class="text-gradient">00</span>
        <span class="h-px w-8 bg-night/20"></span>
        <span>{kind}</span>
      </div>
      <h1 class="display-heading mt-8 max-w-4xl text-[clamp(4rem,10vw,8.5rem)]">{title}</h1>
      <p class="mt-8 max-w-xl text-base leading-8 text-night/55 sm:text-lg">{description}</p>
    </div>
  </section>

  <section class="px-6 pb-32 sm:px-10 lg:px-14">
    <div class="mx-auto max-w-[1100px]">
      {#if entries.length > 0}
        <div class="grid gap-4 md:grid-cols-2">
          {#each entries as entry}
            <a
              class="group flex min-h-64 flex-col justify-between rounded-3xl border border-night/10 bg-white/45 p-7 transition duration-300 hover:-translate-y-1 hover:border-brand-purple/45 hover:bg-white sm:p-9"
              href={`/${basePath}/${entry.slug}/${sourceQuery}`}
            >
              <div>
                <div class="flex items-center justify-between text-[0.65rem] uppercase tracking-[0.16em] text-night/40">
                  <span class="inline-flex items-center gap-2">
                    {#if kind === "News"}
                      <CalendarDays size={13} strokeWidth={1.5} />
                    {:else}
                      <BookOpen size={13} strokeWidth={1.5} />
                    {/if}
                    {kind}
                  </span>
                  {#if entry.publishedAt}
                    <time datetime={entry.publishedAt}>{entry.publishedAt.replaceAll("-", ".")}</time>
                  {/if}
                </div>
                <h2 class="mt-12 max-w-md text-2xl font-medium tracking-[-0.04em] sm:text-3xl">{entry.title}</h2>
                <p class="mt-4 max-w-md text-sm leading-7 text-night/50">{entry.description}</p>
              </div>
              <div class="mt-10 flex items-center justify-between border-t border-night/10 pt-4 text-sm text-night/45 transition group-hover:text-night">
                <span>{kind === "News" ? "記事を読む" : "ドキュメントを読む"}</span>
                <ArrowUpRight size={17} strokeWidth={1.5} class="transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>
            </a>
          {/each}
        </div>
      {:else}
        <div class="rounded-3xl border border-dashed border-night/15 p-10 text-center text-sm text-night/50">
          <FileText size={22} strokeWidth={1.4} class="mx-auto" />
          <p class="mt-4">コンテンツを準備中です。</p>
        </div>
      {/if}
    </div>
  </section>
</main>

<Footer />
