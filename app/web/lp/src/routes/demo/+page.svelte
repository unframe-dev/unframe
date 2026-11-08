<script lang="ts">
  import Header from "#lib/components/layout/Header.svelte";
  import DemoVideo from "#lib/components/ui/DemoVideo.svelte";
</script>

<svelte:head>
  <title>デモ | Unframe</title>
</svelte:head>

<Header />

<main>
  <div class="player">
    <DemoVideo />
  </div>
</main>

<style>
  main {
    display: grid;
    min-block-size: 100svh;
    place-items: center;
    padding: 6.5rem clamp(1rem, 4vw, 2.5rem) 0.75rem;
  }

  .player {
    inline-size: min(100%, 64rem, max(18rem, calc((100svh - 7.25rem) * 16 / 9)));
    aspect-ratio: 16 / 9;
    border-radius: 0.75rem;
    overflow: hidden;
    background: var(--color-night);
  }
</style>
