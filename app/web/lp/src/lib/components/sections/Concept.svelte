<script lang="ts">
  import { ArrowUpRight } from "@lucide/svelte";
  import GradientWave from "../brand/GradientWave.svelte";
  import SectionLabel from "../brand/SectionLabel.svelte";
</script>

<section id="concept" class="relative overflow-hidden bg-background px-6 py-32 sm:px-10 sm:py-44 lg:px-14">
  <GradientWave id="concept-wave" class="-bottom-24 left-0 h-80 opacity-35" flip />
  <div class="relative mx-auto max-w-[1440px]">
    <SectionLabel index="01">考え方を変える</SectionLabel>
    <div class="mt-12 grid gap-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-24">
      <h2 class="display-heading max-w-3xl text-[clamp(2.5rem,5.5vw,5.5rem)] [overflow-wrap:anywhere]">
        The space in front of you is <span class="text-gradient">your stage.</span>
      </h2>
      <div class="flex flex-col justify-end pb-2">
        <p class="max-w-md text-base leading-8 text-muted sm:text-lg">
          Unframeは、現実の空間に3Dモデルや画像、テキストを重ねるMRプレゼンテーションツールです。<br/>発表者が歩く、手を動かすといった動作をきっかけに、空間の中で発表を進められます。
        </p>
        <a class="group mt-9 inline-flex w-fit items-center gap-3 border-b border-night/20 pb-3 text-sm font-medium transition hover:border-brand-purple hover:text-brand-purple" href="#features">
          機能を見る
          <ArrowUpRight size={16} strokeWidth={1.5} class="transition duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      </div>
    </div>

    <div class="mt-28 grid border-y border-line sm:grid-cols-3">
      <div class="border-b border-line py-7 sm:border-b-0 sm:border-r sm:pr-8">
        <h3 class="text-lg font-medium tracking-[-0.03em]">空間に配置する</h3>
        <p class="mt-3 max-w-xs text-sm leading-6 text-muted">3Dモデルを目の前に置き、その横に写真や説明を並べられます。</p>
      </div>
      <div class="border-b border-line py-7 sm:border-b-0 sm:px-8 sm:border-r">
        <h3 class="text-lg font-medium tracking-[-0.03em]">動作で進める</h3>
        <p class="mt-3 max-w-xs text-sm leading-6 text-muted">指定した場所に立ったり、ジェスチャーをしたりすると、次の演出が始まります。</p>
      </div>
      <div class="py-7 sm:pl-8">
        <h3 class="text-lg font-medium tracking-[-0.03em]">説明に合わせて見せる</h3>
        <p class="mt-3 max-w-xs text-sm leading-6 text-muted">話す順序に合わせて、資料を表示したり、モデルを動かしたりできます。</p>
      </div>
    </div>
  </div>
</section>
