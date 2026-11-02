<script lang="ts">
  import { Globe } from "@lucide/svelte";
  import GradientWave from "$lib/components/brand/GradientWave.svelte";
  import iconUrl from "$lib/assets/brand/icon.svg?url";

  const visualSrc = "/brand/promo-mr-architecture-presenter-transparent.png";
</script>

<svelte:head>
  <title>Unframe — Promotional visual</title>
  <meta
    name="description"
    content="Unframeの空間的なプレゼンテーションを表現した宣伝ビジュアル。"
  />
</svelte:head>

<main class="poster" aria-labelledby="promo-title">
  <GradientWave id="promo-wave" class="wave" />
  <div class="visual">
    <img
      src={visualSrc}
      alt="MRグラスをかけた発表者が、空間に浮かぶ建築モデルを身振りで示すイメージ"
    />
  </div>

  <div class="copy">
    <div class="brand">
      <img src={iconUrl} alt="" />
      <h1 id="promo-title">Unframe</h1>
    </div>
    <p class="subtitle">
      <span class="promo-heading">
        <span class="mr">MR</span><span class="cross">✕</span><span>プレゼンテーション</span>
      </span>
      <span class="promo-desc">手を伸ばし、身体を動かし、プレゼンを進める。</span>
    </p>
  </div>

  <footer class="footer">
    <a href="https://un-fra.me/">
      <Globe size={25} strokeWidth={1.8} aria-hidden="true" />
      <span>un-fra.me</span>
    </a>
  </footer>
</main>

<style>
  .poster {
    position: relative;
    container-type: inline-size;
    width: min(100vw, 1920px);
    aspect-ratio: 16 / 9;
    overflow: hidden;
    isolation: isolate;
    background: #f7f7f5;
    color: #0b0e14;
    font-family: "Inter", "Noto Sans JP", "Helvetica Neue", Arial, sans-serif;
  }

  :global(.wave) {
    inset: 18% 0 0;
    height: 82%;
    opacity: 0.58;
  }

  .visual {
    position: absolute;
    top: 9%;
    right: -1%;
    width: 61%;
    height: 82%;
    z-index: -1;
  }

  .visual img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 2.4cqw;
  }

  .brand img {
    width: 6.2cqw;
    height: 6.2cqw;
    flex: none;
  }

  .copy {
    position: absolute;
    top: 19.5cqw;
    left: 4.7cqw;
    width: 51cqw;
  }

  h1 {
    margin: 0;
    font-size: 7.3cqw;
    font-weight: 300;
    letter-spacing: -0.02em;
    line-height: 0.98;
  }

  .subtitle {
    margin: 1.46cqw 0 0;
    letter-spacing: -0.045em;
  }

  .promo-heading {
    display: flex;
    align-items: baseline;
    gap: 0.73cqw;
    font-size: 2.76cqw;
    font-weight: 600;
    line-height: 1.18;
    white-space: nowrap;
  }

  .promo-heading .mr {
    font-size: 1.2em;
    font-weight: 700;
  }

  .promo-heading .cross {
    font-size: 0.68em;
    font-weight: 400;
  }

  .promo-desc {
    display: block;
    margin-top: 0.57cqw;
    font-size: 1.56cqw;
    font-weight: 400;
    line-height: 1.45;
    white-space: nowrap;
  }

  .footer {
    position: absolute;
    bottom: 4.1cqw;
    left: 4.7cqw;
    font-size: 1.25cqw;
    font-weight: 500;
    letter-spacing: 0.015em;
  }

  .footer a {
    display: inline-flex;
    align-items: center;
    gap: 0.55cqw;
    color: #1769d1;
  }

  .footer a span {
    text-decoration: underline;
    text-underline-offset: 0.17em;
  }

  .footer a:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 0.35cqw;
  }
</style>
