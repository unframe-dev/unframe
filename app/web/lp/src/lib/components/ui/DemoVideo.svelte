<script lang="ts">
  import demoUrl from "#lib/assets/demo/unframe-demo.mp4?url";
  import posterUrl from "#lib/assets/demo/unframe-demo-poster.jpg?url";
</script>

<!-- svelte-ignore a11y_media_has_caption (提供された動画に字幕素材が含まれていないため) -->
<video
  class="block aspect-video h-full w-full bg-night object-contain"
  aria-label="Unframeのデモ動画"
  src={demoUrl}
  poster={posterUrl}
  controls
  playsinline
  preload="none"
>
  <a href={demoUrl}>デモ動画をダウンロード</a>
</video>
