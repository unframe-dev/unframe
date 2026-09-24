<script lang="ts">
  // import CTA from "$lib/components/sections/CTA.svelte";
  import Concept from "$lib/components/sections/Concept.svelte";
  import Features from "$lib/components/sections/Features.svelte";
  import Hero from "$lib/components/sections/Hero.svelte";
  import News from "$lib/components/sections/News.svelte";
  import ProductDemo from "$lib/components/sections/ProductDemo.svelte";
  import UseCases from "$lib/components/sections/UseCases.svelte";
  import Vision from "$lib/components/sections/Vision.svelte";
  import Footer from "$lib/components/layout/Footer.svelte";
  import lightHeaderUrl from "$lib/assets/brand/light-header.png?url";
</script>

<svelte:head>
  <title>Unframe — Present beyond the frame</title>
  <meta name="description" content="Unframeはアイデアを空間的な体験へ変える。奥行きと方向性、動く余白を持ったプレゼンテーションをつくる。" />
  <meta property="og:title" content="Unframe — Present beyond the frame" />
  <meta property="og:description" content="動く余白を必要とするアイデアのための、新しい表現手段。" />
  <meta property="og:image" content={lightHeaderUrl} />
  <meta name="theme-color" content="#f7f7f5" />
</svelte:head>

<main>
  <Hero />
  <News />
  <Concept />
  <Features />
  <ProductDemo />
  <UseCases />
  <Vision />
  <!-- <CTA /> -->
</main>

<Footer />
