import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({ ...base, reporter: [["list"]], projects: (base.projects ?? []).map((p) => ({ ...p, use: { ...p.use, channel: "chrome" } })) });
