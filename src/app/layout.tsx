import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Literata, Newsreader, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/store/settings";
import { TipLayer } from "@/components/ui/Tip";

const newsreader = Newsreader({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--nf-serif",
  display: "swap",
});
const schibsted = Schibsted_Grotesk({
  subsets: ["latin", "latin-ext"],
  variable: "--nf-sans",
  display: "swap",
});
const literata = Literata({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--nf-book",
  display: "swap",
});
const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--nf-legible",
  display: "swap",
});

const description =
  "Highlight any line and ask it anything. An open model writes the answer in the margin, beside the words, citing the paragraphs it used.";

export const metadata: Metadata = {
  title: { default: "Gloss", template: "%s" },
  description,
  applicationName: "Gloss",
  openGraph: { title: "Gloss", description, siteName: "Gloss", type: "website" },
  twitter: { card: "summary_large_image", title: "Gloss", description },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#151412" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${newsreader.variable} ${schibsted.variable} ${literata.variable} ${atkinson.variable}`}
      data-theme="paper"
      data-pen="vermilion"
      data-face="serif"
      data-align="left"
      data-paras="spaced"
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <TipLayer />
      </body>
    </html>
  );
}
