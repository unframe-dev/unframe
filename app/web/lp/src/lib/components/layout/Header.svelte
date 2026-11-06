<script lang="ts">
  import Icon from "@iconify/svelte";
  import { ArrowUpRight, Menu, Star, X } from "@lucide/svelte";
  import AnimatedIcon from "../AnimatedIcon.svelte";
  import Wordmark from "../brand/Wordmark.svelte";
  import Button from "../ui/Button.svelte";

  let menuOpen = $state(false);

  const links = [
    { label: "コンセプト", href: "/#concept" },
    { label: "特徴", href: "/#features" },
    { label: "ビジョン", href: "/#vision" },
    { label: "News", href: "/news/" },
  ];
</script>

<header class="absolute inset-x-0 top-0 z-30">
  <div class="mx-auto flex max-w-[1440px] items-center justify-between py-6 pl-6 pr-24 sm:pl-10 sm:pr-28 lg:pl-14">
    <a
      class="group inline-flex items-center gap-[0.17em] text-[1.75rem] leading-none"
      href="/"
      aria-label="Unframe home"
    >
      <AnimatedIcon class="shrink-0" size="0.78em" duration="700ms" />
      <Wordmark />
    </a>

    <div class="flex min-h-11 items-center">
      <nav class="hidden items-center gap-5 md:flex" aria-label="Main navigation">
        {#each links as link}
          <a class="text-xs font-medium tracking-[0.08em] text-night/60 transition hover:text-night" href={link.href}>
            {link.label}
          </a>
        {/each}
        <div class="flex items-center gap-4">
          <Button href="/signup" rel="external" size="sm" variant="primary">
            試してみる
            <ArrowUpRight size={14} strokeWidth={1.8} />
          </Button>
          <a class="text-xs font-medium tracking-[0.08em] text-night/60 transition hover:text-night" href="/login" rel="external">
            ログイン
          </a>
        </div>
      </nav>

      <button
        class="inline-flex h-11 w-11 items-center justify-center rounded-full border border-night/15 text-night md:hidden"
        type="button"
        aria-label={menuOpen ? "Close menu" : "Open menu"}
        aria-expanded={menuOpen}
        onclick={() => (menuOpen = !menuOpen)}
      >
        {#if menuOpen}
          <X size={19} strokeWidth={1.5} />
        {:else}
          <Menu size={19} strokeWidth={1.5} />
        {/if}
      </button>
    </div>
    <a
      class="group absolute right-2 top-6 inline-flex h-11 items-center gap-2 rounded-full border border-night/15 px-3 text-xs font-medium text-night sm:right-4"
      href="https://github.com/unframe-dev/unframe"
      aria-label="GitHubでUnframeにスターを付ける"
    >
      <Star size={18} strokeWidth={1.5} class="text-yellow-500 group-hover:fill-current" aria-hidden="true" />
      <Icon icon="simple-icons:github" width={24} height={24} aria-hidden="true" />
    </a>
  </div>

  {#if menuOpen}
    <nav class="mx-4 rounded-2xl border border-night/10 bg-background/95 p-3 shadow-2xl backdrop-blur-xl md:hidden" aria-label="Mobile navigation">
      {#each links as link}
        <a
          class="block rounded-xl px-4 py-3 text-sm text-night/70 transition hover:bg-night/5 hover:text-night"
          href={link.href}
          onclick={() => (menuOpen = false)}
        >{link.label}</a>
      {/each}
      <div class="mt-2 flex items-center gap-4">
        <Button href="/signup" rel="external" size="sm" variant="accent" class="flex-1">
          試してみる
          <ArrowUpRight size={14} strokeWidth={1.8} />
        </Button>
        <a
          class="shrink-0 rounded-xl px-4 py-3 text-sm text-night/70 transition hover:bg-night/5 hover:text-night"
          href="/login"
          rel="external"
          onclick={() => (menuOpen = false)}
        >ログイン</a>
      </div>
    </nav>
  {/if}
</header>
