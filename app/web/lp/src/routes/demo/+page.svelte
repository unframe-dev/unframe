<script lang="ts">
  import Header from "#lib/components/layout/Header.svelte";
</script>

<svelte:head>
  <title>デモ | Unframe</title>
</svelte:head>

<Header />

<main>
  <!-- svelte-ignore a11y_media_has_caption (動画素材と字幕は未掲載) -->
  <video
    aria-label="Unframeのデモ動画"
    controls
    playsinline
  ></video>
</main>

<style>
  main {
    display: grid;
    min-block-size: 100svh;
    place-items: center;
    padding: 6.5rem clamp(1rem, 4vw, 2.5rem) 0.75rem;
  }

  video {
    inline-size: min(100%, 64rem, max(18rem, calc((100svh - 7.25rem) * 16 / 9)));
    aspect-ratio: 16 / 9;
    border-radius: 0.75rem;
    background: var(--color-night);
  }
</style>
