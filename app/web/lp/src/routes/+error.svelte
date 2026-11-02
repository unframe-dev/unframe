<script lang="ts">
  import { ArrowLeft, Home } from "@lucide/svelte";
  import { page } from "$app/state";
  import Footer from "$lib/components/layout/Footer.svelte";
  import Header from "$lib/components/layout/Header.svelte";
</script>

<svelte:head>
  <title>{page.status} | Unframe</title>
  <meta name="description" content="ページが見つかりません。" />
</svelte:head>

<div class="min-h-screen bg-background text-night">
  <Header />

  <main class="flex min-h-screen items-center px-6 py-40 sm:px-10 lg:px-14">
    <section class="mx-auto w-full max-w-[1100px]">
      <div class="eyebrow flex items-center gap-3 text-night/50">
        <span class="text-gradient">{page.status}</span>
        <span class="h-px w-8 bg-night/20"></span>
        <span>Not found</span>
      </div>
      <h1 class="display-heading mt-8 max-w-4xl text-[clamp(4rem,10vw,8.5rem)]">
        Page<br /><span class="text-gradient">not found.</span>
      </h1>
      <p class="mt-8 max-w-xl text-base leading-8 text-night/55 sm:text-lg">
        ページが見つかりません。
      </p>
      <a
        class="group mt-10 inline-flex items-center gap-3 rounded-full border border-night/20 px-5 py-3 text-sm transition hover:border-night hover:bg-night hover:text-white"
        href="/"
      >
        <Home size={15} strokeWidth={1.5} />
        ホームへ戻る
        <ArrowLeft size={15} strokeWidth={1.5} class="transition duration-300 group-hover:-translate-x-1" />
      </a>
    </section>
  </main>

  <Footer />
</div>
