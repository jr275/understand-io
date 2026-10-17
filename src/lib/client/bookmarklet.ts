/** The bookmarklet: opens Understand in a new tab and hands it the page's HTML through postMessage. */
export function bookmarklet(origin: string, kind: "read" | "save") {
  const code =
    `(function(){var o=${JSON.stringify(origin)};` +
    `var w=window.open(o+'/?capture=${kind}&url='+encodeURIComponent(location.href));if(!w)return;` +
    `function h(e){if(e.source!==w||e.origin!==o||e.data!=='understand:ready')return;` +
    `w.postMessage({type:'understand:page',url:location.href,title:document.title,html:document.documentElement.outerHTML},o);` +
    `removeEventListener('message',h)}addEventListener('message',h)})()`;
  return `javascript:${code}`;
}
