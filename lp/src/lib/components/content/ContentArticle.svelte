<script lang="ts">
  import { ArrowLeft, ArrowUpRight, CalendarDays } from "@lucide/svelte";
  import type { Component } from "svelte";
  import type { ContentEntry } from "$lib/content-registry";
  import Header from "../layout/Header.svelte";
  import Footer from "../layout/Footer.svelte";

  type ContentKind = "News" | "Docs";

  let { entry, kind } = $props<{
    entry: ContentEntry<Component>;
    kind: ContentKind;
  }>();

  const Content = $derived(entry.component);
  const basePath = $derived(kind.toLowerCase());
</script>

<svelte:head>
  <title>{entry.title} | {kind} | Unframe</title>
  <meta name="description" content={entry.description} />
</svelte:head>

<Header />

<main class="min-h-screen bg-background px-6 pb-32 pt-36 text-night sm:px-10 sm:pt-44 lg:px-14">
  <article class="mx-auto max-w-[820px]">
    <a class="inline-flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-night/45 transition hover:text-night" href={`/${basePath}/`}>
      <ArrowLeft size={14} strokeWidth={1.5} />
      {kind} index
    </a>
    <header class="mt-14 border-b border-night/10 pb-12">
      <div class="eyebrow flex items-center gap-3 text-night/50">
        <span class="text-gradient">{kind === "News" ? "01" : "00"}</span>
        <span class="h-px w-8 bg-night/20"></span>
        <span>{kind}</span>
      </div>
      <h1 class="display-heading mt-8 max-w-4xl text-[clamp(3.5rem,8vw,7rem)]">{entry.title}</h1>
      <div class="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-night/45">
        {#if entry.publishedAt}
          <span class="inline-flex items-center gap-2">
            <CalendarDays size={14} strokeWidth={1.5} />
            <time datetime={entry.publishedAt}>{entry.publishedAt.replaceAll("-", ".")}</time>
          </span>
        {/if}
        <span>{entry.description}</span>
      </div>
    </header>

    <div class="article-prose pt-12">
      <Content />
    </div>

    <a class="group mt-16 inline-flex items-center gap-3 border-b border-night/20 pb-3 text-sm text-night/60 transition hover:border-night hover:text-night" href={`/${basePath}/`}>
      <ArrowLeft size={15} strokeWidth={1.5} />
      一覧に戻る
      <ArrowUpRight size={14} strokeWidth={1.5} class="ml-2 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </a>
  </article>
</main>

<Footer />
