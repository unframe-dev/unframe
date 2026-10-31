<script lang="ts">
    import { ArrowDown, ArrowUpRight, MoveRight } from "@lucide/svelte";
    import Button from "../ui/Button.svelte";
    import GradientWave from "../brand/GradientWave.svelte";
    import SectionLabel from "../brand/SectionLabel.svelte";
    import Header from "../layout/Header.svelte";
</script>

<section
    class="relative isolate min-h-[760px] overflow-hidden bg-background text-night sm:min-h-screen"
>
    <div class="noise absolute inset-0"></div>
    <GradientWave
        id="hero-wave"
        class="inset-x-0 top-[18%] h-[74%] opacity-75"
    />
    <div
        class="absolute -right-32 top-24 h-80 w-80 rounded-full bg-brand-purple/8 blur-3xl"
    ></div>
    <img
        src="/brand/hero.png"
        alt=""
        aria-hidden="true"
        class="pointer-events-none absolute right-0 top-[14%] hidden w-[min(78vw,960px)] opacity-70 mix-blend-multiply lg:block"
    />

    <Header />

    <div
        class="relative mx-auto flex min-h-[760px] max-w-[1440px] flex-col justify-center px-6 pb-20 pt-36 sm:min-h-screen sm:px-10 sm:pt-32 lg:px-14"
    >
        <div class="max-w-4xl">
            <SectionLabel index="00">Mixed Reality Presentation Platform</SectionLabel>
            <h1
                class="display-heading mt-8 max-w-4xl text-[clamp(4.1rem,10.8vw,10.5rem)]"
            >
                Present beyond<br />
                <span class="text-gradient">the frame.</span>
            </h1>
            <p
                class="mt-9 max-w-lg text-base leading-8 text-night/55 sm:text-lg"
            >
                Unframeはアイデアを空間的な体験へ変える。
                <br />
                現実と3次元の空間のプレゼンテーションをつくろう。
            </p>
            <div class="mt-10 flex flex-wrap items-center gap-5">
                <Button href="#concept" size="lg">
                    コンセプトを見る
                    <MoveRight
                        size={16}
                        strokeWidth={1.7}
                        class="transition duration-300 group-hover:translate-x-1"
                    />
                </Button>
                <a
                    class="group inline-flex items-center gap-2 text-sm text-night/55 transition hover:text-night"
                    href="#demo"
                >
                    デモを見る
                    <ArrowUpRight
                        size={15}
                        strokeWidth={1.5}
                        class="transition duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                </a>
            </div>
        </div>

        <div
            class="mt-20 flex items-end justify-between border-t border-night/10 pt-5 text-[0.65rem] uppercase tracking-[0.16em] text-night/35 sm:mt-24"
        >
            <a
                class="hidden ml-auto gap-3 transition hover:text-night sm:flex"
                href="#concept"
            >
                スクロールして探索 <ArrowDown size={14} strokeWidth={1.3} />
            </a>
        </div>
    </div>

    <div
        class="pointer-events-none absolute bottom-16 right-[8%] hidden h-44 w-44 rounded-full border border-night/10 lg:block"
    >
        <div
            class="absolute inset-6 rounded-full border border-brand-blue/30"
        ></div>
        <div
            class="absolute inset-0 motion-safe:animate-[spin_24s_linear_infinite]"
        >
            <div
                class="absolute -left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-brand-blue shadow-[0_0_20px_4px_rgba(113,135,245,0.5)]"
            ></div>
        </div>
    </div>
</section>
