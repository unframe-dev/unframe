<script lang="ts">
  import { ArrowUpRight, Menu, X } from "@lucide/svelte";
  import AnimatedIcon from "../AnimatedIcon.svelte";
  import Button from "../ui/Button.svelte";

  let menuOpen = $state(false);

  const links = [
    { label: "コンセプト", href: "/#concept" },
    { label: "特徴", href: "/#features" },
    { label: "ビジョン", href: "/#vision" },
    { label: "Blog", href: "/blog/" },
    { label: "Docs", href: "/docs/" },
  ];
</script>

<header class="absolute inset-x-0 top-0 z-30">
  <div class="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-6 sm:px-10 lg:px-14">
    <Logo />

    <nav class="hidden items-center gap-8 md:flex" aria-label="Main navigation">
      {#each links as link}
        <a class="text-xs font-medium tracking-[0.08em] text-night/60 transition hover:text-night" href={link.href}>
          {link.label}
        </a>
      {/each}
      <Button href="/#contact" size="sm" variant="primary">
        話してみる
        <ArrowUpRight size={14} strokeWidth={1.8} />
      </Button>
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

  {#if menuOpen}
    <nav class="mx-4 rounded-2xl border border-night/10 bg-background/95 p-3 shadow-2xl backdrop-blur-xl md:hidden" aria-label="Mobile navigation">
      {#each links as link}
        <a
          class="block rounded-xl px-4 py-3 text-sm text-night/70 transition hover:bg-night/5 hover:text-night"
          href={link.href}
          onclick={() => (menuOpen = false)}
        >{link.label}</a>
      {/each}
      <Button href="/#contact" size="sm" class="mt-2 w-full">
        話してみる
        <ArrowUpRight size={14} strokeWidth={1.8} />
      </Button>
    </nav>
  {/if}
</header>
