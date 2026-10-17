import type { Metadata } from "next";
import { Topbar } from "@/components/chrome/Topbar";
import { Toasts } from "@/components/chrome/Toasts";
import { ImportBar } from "@/components/landing/ImportBar";
import { SampleRow } from "@/components/landing/SampleRow";
import { Desk } from "@/components/landing/Desk";
import { Notice } from "@/components/chrome/Notice";

export const metadata: Metadata = { title: "Understand.io" };

export default async function LandingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const url = typeof sp.url === "string" ? sp.url : typeof sp.save === "string" ? sp.save : undefined;
  const capture = sp.capture === "read" || sp.capture === "save" ? sp.capture : undefined;
  const signin = typeof sp.signin === "string" ? sp.signin.slice(0, 200) : "";
  return (
    <div className="landing relative z-[1] flex min-h-dvh flex-col transition-[opacity,filter,transform] duration-300 ease-[var(--ease-out)]">
      <Topbar variant="landing" />
      <main className="relative flex flex-1 flex-col pb-[clamp(20px,4vh,44px)]">
        <div className="flex flex-1 flex-col justify-center pb-[clamp(16px,3vh,36px)] pt-[clamp(28px,8vh,96px)]">
          <section className="mx-auto flex w-full max-w-[980px] flex-col items-center px-6 text-center sm:px-10">
            <h1 className="hero-title font-serif text-ink">
              <span className="block">
                Highlight <span className="hero-mark">any line</span>.
              </span>
              <span className="block">Ask it anything.</span>
            </h1>
            <ImportBar initialUrl={url} capture={capture} />
            <SampleRow />
          </section>
        </div>
        <Desk />
      </main>
      <Toasts bottom={24} />
      {signin ? <Notice text={signin} /> : null}
    </div>
  );
}
