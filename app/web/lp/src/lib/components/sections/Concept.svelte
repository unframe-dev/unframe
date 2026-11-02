<script lang="ts">
  import { ArrowUpRight, Orbit } from "@lucide/svelte";
  import GradientWave from "../brand/GradientWave.svelte";
  import SectionLabel from "../brand/SectionLabel.svelte";
</script>

<section id="concept" class="relative overflow-hidden bg-background px-6 py-32 sm:px-10 sm:py-44 lg:px-14">
  <GradientWave id="concept-wave" class="-bottom-24 left-0 h-80 opacity-35" flip />
  <div class="relative mx-auto max-w-[1440px]">
    <SectionLabel index="01">異なるキャンバス</SectionLabel>
    <div class="mt-12 grid gap-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-24">
      <h2 class="display-heading max-w-3xl text-[clamp(3.2rem,7vw,7.2rem)]">
        The space around an idea is part of the <span class="text-gradient">idea.</span>
      </h2>
      <div class="flex flex-col justify-end pb-2">
        <p class="max-w-md text-base leading-8 text-muted sm:text-lg">
          スライドはいつも、思考を覗くための窓だった。Unframeはその窓を開く。空間を移動するように、文脈とスケール、ストーリーの間を行き来できる。
        </p>
        <a class="group mt-9 inline-flex w-fit items-center gap-3 border-b border-night/20 pb-3 text-sm font-medium transition hover:border-brand-purple hover:text-brand-purple" href="#features">
          空間が加わると、何が変わるのか？
          <ArrowUpRight size={16} strokeWidth={1.5} class="transition duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      </div>
    </div>

    <div class="mt-28 grid border-y border-line sm:grid-cols-3">
      <div class="border-b border-line py-7 sm:border-b-0 sm:border-r sm:pr-8">
        <Orbit size={21} strokeWidth={1.2} class="text-brand-blue" />
        <h3 class="mt-6 text-lg font-medium tracking-[-0.03em]">空間的</h3>
        <p class="mt-3 max-w-xs text-sm leading-6 text-muted">アイデアに、ただのスライドではなく座標系を与える。</p>
      </div>
      <div class="border-b border-line py-7 sm:border-b-0 sm:px-8 sm:border-r">
        <span class="text-gradient text-xl font-light">02</span>
        <h3 class="mt-6 text-lg font-medium tracking-[-0.03em]">流動的</h3>
        <p class="mt-3 max-w-xs text-sm leading-6 text-muted">流れを失わずに、細部と全体を行き来する。</p>
      </div>
      <div class="py-7 sm:pl-8">
        <span class="text-gradient text-xl font-light">03</span>
        <h3 class="mt-6 text-lg font-medium tracking-[-0.03em]">直感的</h3>
        <p class="mt-3 max-w-xs text-sm leading-6 text-muted">インターフェースが消え、物語だけがそこに残る。</p>
      </div>
    </div>
  </div>
</section>
