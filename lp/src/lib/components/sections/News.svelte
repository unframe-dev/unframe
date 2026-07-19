<script lang="ts">
  import { ArrowUpRight, CalendarDays } from "@lucide/svelte";
  import { newsEntries } from "$lib/content";
  import SectionLabel from "../brand/SectionLabel.svelte";

  const latestEntries = [...newsEntries]
    .sort((a, b) => {
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return b.publishedAt.localeCompare(a.publishedAt);
    })
    .slice(0, 3);
</script>

<section id="news" class="border-y border-line bg-[#ececf0] px-6 py-12 sm:px-10 sm:py-16 lg:px-14">
  <div class="mx-auto max-w-[1440px]">
    <div class="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
      <div class="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-8">
        <h2 class="display-heading text-[clamp(2.2rem,4vw,3.8rem)]">
          <span class="text-gradient">News.</span>
        </h2>
      </div>
      <a class="group inline-flex items-center gap-3 text-sm text-night/55 transition hover:text-night" href="/news/">
        Newsをすべて見る
        <ArrowUpRight size={16} strokeWidth={1.5} class="transition duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </a>
    </div>

    {#if latestEntries.length > 0}
      <div class="mt-8 border-t border-line">
        {#each latestEntries as entry}
          <a
            class="group grid gap-3 border-b border-line py-5 transition hover:border-brand-purple/45 sm:grid-cols-[8rem_1fr_auto] sm:items-center sm:gap-8"
            href={`/news/${entry.slug}/?from=home`}
          >
            <div class="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.16em] text-night/40 sm:flex-col sm:items-start sm:gap-1">
              <span class="inline-flex items-center gap-2">
                <CalendarDays size={13} strokeWidth={1.5} />
                News
              </span>
              {#if entry.publishedAt}
                <time datetime={entry.publishedAt}>{entry.publishedAt.replaceAll("-", ".")}</time>
              {/if}
            </div>
            <div>
              <h3 class="text-lg font-medium tracking-[-0.04em] transition group-hover:text-brand-purple sm:text-xl">
                {entry.title}
              </h3>
              <p class="mt-1 max-w-2xl text-xs leading-6 text-night/50 sm:text-sm">{entry.description}</p>
            </div>
            <ArrowUpRight size={18} strokeWidth={1.5} class="text-night/35 transition duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-night" />
          </a>
        {/each}
      </div>
    {:else}
      <p class="mt-8 border-t border-line pt-5 text-sm text-night/50">最新情報を準備中です。</p>
    {/if}
  </div>
</section>
