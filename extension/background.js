// Keeple extension, milestone 1: hand the page you are looking at to Keeple.
// It is the bookmarklet (src/lib/client/bookmarklet.ts) as an extension: it opens Keeple in a new tab and, when that tab says it is ready, posts the
// page's HTML to it, so pages behind a login or a paywall you can open work too. Nothing is sent anywhere else, and nothing before you ask:
// the page is read only after a click on the menu item or the popup button (`activeTab`, no host permissions).
const ORIGIN = "https://www.keeple.me";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "keeple-read", title: "Read this page in Keeple", contexts: ["page", "selection"] });
  chrome.contextMenus.create({ id: "keeple-save", title: "Save this page to Keeple", contexts: ["page", "selection"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => void send(tab, info.menuItemId === "keeple-save" ? "save" : "read"));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "keeple:send") return;
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => send(tab, msg.kind === "save" ? "save" : "read")).then(() => reply({ ok: true }), () => reply({ ok: false }));
  return true;
});

async function send(tab, kind) {
  // Only ordinary web pages: not chrome:// pages, the store, or a file.
  if (!tab?.id || !/^https?:\/\//.test(tab.url ?? "")) return;
  let handedOver = false;
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: capture, args: [ORIGIN, kind] });
    handedOver = r?.result === true;
  } catch {
    handedOver = false; // the page cannot be scripted (a protected page, a closed tab)
  }
  // A browser may refuse a window that a page opens without its own click (a popup blocker). Keeple then opens from the extension with the address filled in:
  // nothing is read until the reader presses Read there, and it needs no permission beyond the ones above.
  if (!handedOver) await chrome.tabs.create({ url: ORIGIN + "/?url=" + encodeURIComponent(tab.url) });
}

// Runs inside the page (it must be self-contained). The same handshake as the bookmarklet: Keeple answers "understand:ready", the page then posts itself.
// The two message names are the protocol's identifiers and stay as they are, so the bookmarklet and this extension speak the same language.
function capture(origin, kind) {
  const w = window.open(origin + "/?capture=" + kind + "&url=" + encodeURIComponent(location.href));
  if (!w) return false;
  function onMessage(e) {
    if (e.source !== w || e.origin !== origin || e.data !== "understand:ready") return;
    w.postMessage({ type: "understand:page", url: location.href, title: document.title, html: document.documentElement.outerHTML }, origin);
    removeEventListener("message", onMessage);
  }
  addEventListener("message", onMessage);
  return true;
}
