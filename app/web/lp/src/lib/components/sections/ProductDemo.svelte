<script lang="ts">
  import GradientWave from "../brand/GradientWave.svelte";
  import SectionLabel from "../brand/SectionLabel.svelte";
</script>

<section id="demo" class="relative overflow-hidden bg-[#ececf0] px-6 py-32 text-night sm:px-10 sm:py-44 lg:px-14">
  <GradientWave id="demo-wave" class="-right-32 top-0 h-full w-[120%] opacity-45" />
  <div class="relative mx-auto max-w-[1440px]">
    <div class="flex flex-col justify-between gap-10 sm:flex-row sm:items-end">
      <div>
        <SectionLabel index="03">デモ</SectionLabel>
        <h2 class="display-heading mt-10 max-w-2xl text-[clamp(3.2rem,7vw,7rem)]">A gesture <span class="text-gradient">sets the scene.</span></h2>
      </div>
      <p class="max-w-sm text-sm leading-7 text-night/55">
        たとえば、発表者が手を上にスワイプすると、空間に置いたオブジェクトが浮かび上がります。話すタイミングに合わせて、手の動きで演出を始められます。
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
