for (const kind of ["read", "save"]) {
  document.getElementById(kind).addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "keeple:send", kind });
    window.close();
  });
}
