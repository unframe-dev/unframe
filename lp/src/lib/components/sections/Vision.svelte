<script lang="ts">
  import { ArrowUpRight, MoveRight } from "@lucide/svelte";
  import GradientWave from "../brand/GradientWave.svelte";
  import SectionLabel from "../brand/SectionLabel.svelte";
</script>

<section id="vision" class="relative overflow-hidden bg-[#ececf0] px-6 pb-16 pt-32 sm:px-10 sm:pb-24 sm:pt-44 lg:px-14">
  <GradientWave id="vision-wave" class="-bottom-16 left-0 h-96 opacity-25" />
  <div class="relative mx-auto max-w-[1440px]">
    <div class="grid gap-16 lg:grid-cols-[0.7fr_1.3fr] lg:gap-24">
      <div>
        <SectionLabel index="05">向かう先</SectionLabel>
        <p class="mt-7 max-w-xs text-sm leading-7 text-muted">次のコミュニケーションの層をつくる。平坦でも、騒がしくもない。ただ、もっとそこにあるものを。</p>
      </div>
      <div>
        <h2 class="display-heading max-w-4xl text-[clamp(3.5rem,8vw,8rem)]">From slides<br />to <span class="text-gradient">spaces.</span></h2>
        <div class="mt-12 flex flex-col gap-7 border-t border-night/15 pt-7 sm:flex-row sm:items-start sm:justify-between">
          <p class="max-w-md text-base leading-8 text-muted">私たちの思考は立体的だ。道具もそうあるべきだ。Unframeは、フレームを取り払ったときプレゼンテーションが何になれるのかを探り続ける。</p>
          <a class="group inline-flex shrink-0 items-center gap-3 text-sm font-medium transition hover:text-brand-purple" href="https://github.com/unframe-dev">
            開発を追う
            <MoveRight size={16} strokeWidth={1.5} class="transition duration-300 group-hover:translate-x-1" />
          </a>
        </div>
      </div>
    </div>
  </div>
</section>
