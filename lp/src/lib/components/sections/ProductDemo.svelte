<script lang="ts">
  import { ArrowUpRight } from "@lucide/svelte";
  import GradientWave from "../brand/GradientWave.svelte";
  import SectionLabel from "../brand/SectionLabel.svelte";
</script>

<section id="demo" class="relative overflow-hidden bg-[#ececf0] px-6 py-32 text-night sm:px-10 sm:py-44 lg:px-14">
  <GradientWave id="demo-wave" class="-right-32 top-0 h-full w-[120%] opacity-45" />
  <div class="relative mx-auto max-w-[1440px]">
    <div class="flex flex-col justify-between gap-10 sm:flex-row sm:items-end">
      <div>
      <SectionLabel index="03">動きの中で</SectionLabel>
        <h2 class="display-heading mt-10 max-w-2xl text-[clamp(3.2rem,7vw,7rem)]">A presentation you can <span class="text-gradient">enter.</span></h2>
      </div>
      <p class="group inline-flex items-center gap-3 text-sm text-night/55 transition hover:text-night">
          現在開発中のためデモ動画がありません。
        <ArrowUpRight size={16} strokeWidth={1.5} class="transition duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </p>
    </div>

    <div class="relative mt-16 aspect-[16/9] overflow-hidden rounded-[1.25rem] border border-night/15 bg-white/65 shadow-xl sm:mt-24">
      <!-- <iframe
        class="absolute inset-0 h-full w-full"
        src="https://www.youtube-nocookie.com/embed/Jj1_mfUzjOs?list=RDJj1_mfUzjOs&rel=0"
        title="プレゼンテーションのデモ動画"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
      ></iframe> -->
    </div>
  </div>
</section>
