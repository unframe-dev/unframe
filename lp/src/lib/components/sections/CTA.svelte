<script lang="ts">
  import { ArrowUpRight, Mail } from "@lucide/svelte";
  import GradientWave from "../brand/GradientWave.svelte";
  import SectionLabel from "../brand/SectionLabel.svelte";
</script>

<section id="contact" class="relative overflow-hidden bg-background px-6 py-32 text-night sm:px-10 sm:py-44 lg:px-14">
  <GradientWave id="cta-wave" class="inset-0 h-full opacity-55" flip />
  <div class="relative mx-auto max-w-[1440px]">
    <SectionLabel index="06">中へ</SectionLabel>
    <div class="mt-12 flex flex-col justify-between gap-16 lg:flex-row lg:items-end">
      <h2 class="display-heading max-w-5xl text-[clamp(4rem,10vw,10rem)]">Make room<br />for <span class="text-gradient">more.</span></h2>
      <div class="max-w-xs pb-3">
        <p class="text-base leading-8 text-night/50">これからの形を一緒につくる、少人数の仲間を募集しています。</p>
        <a class="group mt-8 inline-flex items-center gap-3 rounded-full border border-night/20 px-5 py-3 text-sm transition hover:border-night hover:bg-night hover:text-white" href="mailto:hello@unframe.dev">
          <Mail size={15} strokeWidth={1.5} />
          話しかける
          <ArrowUpRight size={15} strokeWidth={1.5} class="transition duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      </div>
    </div>
  </div>
</section>
