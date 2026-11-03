import { currentLocale, tNow } from "./runtime";
import type { MessageKey } from "./translate";

/**
 * The server answers in English, always: its messages are part of the API contract (`{ error: "..." }`), asserted by tests and read by scripts. The words a
 * reader sees are chosen here, on the client, by matching the server's message and showing its translation. A message nobody has translated yet is shown as
 * the server wrote it (never lost, never blank), and `tests/unit/i18nServerMessages.test.ts` checks that every message the server can send has an entry.
 */
const CATALOG: [RegExp, MessageKey, string[]][] = [
  [/^Sign\-in\ is\ not\ set\ up\ on\ this\ server\.$/, "srv.signInOff", []],
  [/^Sign\-in\ is\ not\ set\ up\ on\ this\ server\ \([^)]+\ are\ needed\)\.$/, "srv.signInOffLong", []],
  [/^Google\ sign\-in\ was\ cancelled\.$/, "srv.signInCancelled", []],
  [/^The\ sign\-in\ link\ was\ stale\.\ Please\ try\ again\.$/, "srv.signInStale", []],
  [/^Sign\-in\ could\ not\ be\ completed\ on\ the\ server\.\ Please\ try\ again\ in\ a\ moment\.$/, "srv.signInFailed", []],
  [/^Google\ did\ not\ accept\ the\ sign\-in\ \((.+?)\)\.$/, "srv.googleRefused", ["status"]],
  [/^Google\ returned\ no\ access\ token\.$/, "srv.googleNoToken", []],
  [/^Could\ not\ read\ the\ Google\ profile\ \((.+?)\)\.$/, "srv.googleProfile", ["status"]],
  [/^Google\ returned\ no\ subject\ id\.$/, "srv.googleNoSubject", []],
  [/^Server\ transcription\ needs\ a\ Together\ AI\ key\.$/, "srv.transcribeNeedsKey", []],
  [/^That\ recording\ is\ too\ long\.\ Keep\ it\ under\ a\ few\ seconds\.$/, "srv.recordingTooLong", []],
  [/^No\ audio\ received\.$/, "srv.noAudio", []],
  [/^That\ does\ not\ look\ like\ an\ audio\ recording\.$/, "srv.notAudio", []],
  [/^Transcription\ timed\ out\ or\ could\ not\ reach\ the\ provider\.$/, "srv.transcribeTimeout", []],
  [/^Transcription\ failed\ \((.+?)\)\.\ (.+?)$/, "srv.transcribeFailed", ["status", "detail"]],
  [/^Semantic\ search\ needs\ a\ Together\ AI\ key;\ lexical\ search\ still\ works\.$/, "srv.semanticNeedsKey", []],
  [/^Embedding\ failed\.$/, "srv.embeddingFailed", []],
  [/^Too\ much\ context\.$/, "srv.tooMuchContext", []],
  [/^That\ request\ is\ too\ large\.$/, "srv.requestTooLarge", []],
  [/^Malformed\ request\.$/, "srv.malformed", []],
  [/^That\ key\ was\ not\ accepted\ by\ Together\ AI\.$/, "srv.keyRejected", []],
  [/^Together\ AI\ is\ rate\-limiting\ right\ now\.\ Try\ again\ in\ a\ moment\.$/, "srv.togetherLimit", []],
  [/^The\ model\ (.+?)\ is\ not\ available\ on\ this\ key\.$/, "srv.modelUnavailable", ["model"]],
  [/^The\ AI\ service\ could\ not\ answer\ right\ now\.\ Try\ again\.$/, "srv.aiCouldNotAnswer", []],
  [/^That\ does\ not\ look\ like\ a\ link\.$/, "srv.notALink", []],
  [/^Could\ not\ read\ that\ page\.$/, "srv.couldNotReadPage", []],
  [/^That\ page\ could\ not\ be\ read\.$/, "srv.pageNotRead", []],
  [/^Could\ not\ save\ that\ link\.$/, "srv.couldNotSaveLink", []],
  [/^That\ link\ is\ not\ a\ web\ page,\ a\ PDF\ or\ plain\ text,\ so\ it\ cannot\ be\ read\ here\.\ Open\ it\ in\ your\ browser\ and\ paste\ the\ text,\ or\ upload\ a\ file\.$/, "srv.linkNotText", []],
  [/^Nothing\ readable\ at\ that\ link\.$/, "srv.nothingAtLink", []],
  [/^That\ page\ is\ too\ large\ to\ read\ here\ \(over\ 4\ MB\ of\ HTML\)\.\ Paste\ its\ text\ instead\.$/, "srv.pageTooLarge", []],
  [/^No\ page\ content\ received:\ send\ JSON\ with\ a\ url\ and\ the\ page's\ html\.$/, "srv.noPageContent", []],
  [/^Only\ http\(s\)\ pages\ can\ be\ read\.$/, "srv.onlyHttp", []],
  [/^That\ file\ is\ larger\ than\ 25\ MB\.$/, "srv.fileTooLarge25", []],
  [/^No\ file\ received\.$/, "srv.noFile", []],
  [/^Only\ (.+?)\ files\ can\ be\ imported\.$/, "srv.onlyFormats", ["formats"]],
  [/^That\ file\ does\ not\ look\ like\ text\.\ Only\ (.+?)\ files\ can\ be\ imported\.$/, "srv.notTextFile", ["formats"]],
  [/^Nothing\ readable\ in\ that\ file\.$/, "srv.nothingInFile", []],
  [/^Could\ not\ read\ that\ file\.$/, "srv.couldNotReadFile", []],
  [/^That\ text\ is\ too\ long\.$/, "srv.textTooLong", []],
  [/^That\ request\ could\ not\ be\ read:\ send\ JSON\ like\ \{"text":\ "\.\.\."\}\.$/, "srv.textBadRequest", []],
  [/^That\ text\ is\ longer\ than\ 2\ million\ characters\.$/, "srv.textOver2m", []],
  [/^That\ text\ contains\ characters\ that\ cannot\ be\ stored\ \(it\ may\ be\ a\ binary\ file\)\.$/, "srv.textBinary", []],
  [/^Nothing\ to\ read\.$/, "srv.nothingToRead", []],
  [/^Could\ not\ save\ that\ text\.$/, "srv.couldNotSaveText", []],
  [/^Only\ http\(s\)\ links\ can\ be\ read\.$/, "srv.onlyHttpLinks", []],
  [/^Only\ links\ on\ the\ standard\ web\ ports\ \(80\ and\ 443\)\ can\ be\ read\.$/, "srv.onlyPorts", []],
  [/^Only\ public\ links\ can\ be\ read\.$/, "srv.onlyPublic", []],
  [/^That\ host\ could\ not\ be\ found\.$/, "srv.hostNotFound", []],
  [/^That\ page\ redirected\ nowhere\.$/, "srv.redirectedNowhere", []],
  [/^That\ page\ is\ larger\ than\ 10\ MB\.$/, "srv.pageOver10", []],
  [/^Too\ many\ redirects\.$/, "srv.tooManyRedirects", []],
  [/^That\ site\ blocks\ readers\ like\ this\ one\.\ Open\ the\ page\ in\ your\ browser\ and\ use\ the\ “Read\ in\ Understand”\ bookmarklet,\ or\ paste\ its\ text\.$/, "srv.siteBlocks", []],
  [/^That\ page\ asks\ for\ payment\ or\ a\ subscription\ \(402\),\ so\ it\ cannot\ be\ read\ here\.\ If\ you\ have\ access,\ open\ it\ in\ your\ browser\ and\ use\ the\ “Read\ in\ Understand”\ bookmarklet,\ or\ paste\ its\ text\.$/, "srv.payment402", []],
  [/^That\ page\ no\ longer\ exists\ \(404\)\.$/, "srv.gone404", []],
  [/^That\ site\ is\ having\ trouble\ \(it\ answered\ (.+?)\)\.\ Try\ again\ in\ a\ moment\.$/, "srv.siteTrouble", ["status"]],
  [/^That\ page\ answered\ (.+?)\.$/, "srv.pageAnswered", ["status"]],
  [/^That\ page\ took\ too\ long\ to\ answer\.$/, "srv.pageSlow", []],
  [/^That\ page\ could\ not\ be\ reached\.$/, "srv.pageUnreachable", []],
  [/^You\ have\ used\ today's\ (.+?)\ (.+?)\.\ The\ allowance\ renews\ at\ midnight\ UTC,\ or\ (.+?)\.$/, "srv.quotaUser", ["n", "what", "hint"]],
  [/^You\ have\ used\ today's\ (.+?)\ free\ (.+?)\.\ Sign\ in\ with\ Google\ for\ (.+?)\ a\ day,\ (.+?),\ or\ come\ back\ tomorrow\.$/, "srv.quotaAnon", ["n", "what", "m", "hint"]],
  [/^This\ network\ has\ used\ today's\ shared\ allowance\ of\ (.+?)\.\ Sign\ in\ with\ Google,\ (.+?),\ or\ come\ back\ tomorrow\.$/, "srv.quotaIp", ["what", "hint"]],
  [/^The\ free\ (.+?)\ for\ visitors\ who\ are\ not\ signed\ in\ are\ used\ up\ for\ today\.\ Sign\ in\ with\ Google,\ (.+?),\ or\ come\ back\ tomorrow\.$/, "srv.quotaVisitors", ["what", "hint"]],
  [/^You\ already\ have\ an\ AI\ answer\ being\ written\.\ Wait\ for\ it\ to\ finish,\ then\ ask\ again\.$/, "srv.busyUser", []],
  [/^The\ beta's\ AI\ budget\ for\ (.+?)\ is\ used\ up,\ so\ the\ shared\ AI\ is\ paused\ until\ it\ renews\ \(UTC\)\.\ You\ can\ keep\ going\ with\ your\ own\ Together\ key\ \(the\ key\ button\ in\ the\ top\ bar\)\.$/, "srv.budgetSpent", ["when"]],
  [/^The\ AI\ is\ temporarily\ unavailable\.\ Try\ again\ in\ a\ minute\.$/, "srv.aiUnavailable", []],
  [/^The\ shared\ key\ allows\ (.+?)\ of\ these\ per\ (.+?)\.\ Try\ again\ in\ about\ (.+?),\ or\ add\ your\ own\ Together\ key\ with\ the\ key\ button\ in\ the\ top\ bar\ \(your\ own\ key\ is\ not\ limited\ here\)\.$/, "srv.rateSharedKey", ["max", "window", "wait"]],
  [/^That\ is\ more\ than\ (.+?)\ imports\ in\ (.+?)\ minutes\.\ Try\ again\ in\ about\ (.+?)\.$/, "srv.rateImports", ["max", "minutes", "wait"]],
  [/^Could\ not\ save\ that\ to\ your\ library\.$/, "srv.couldNotSaveLibrary", []],
  [/^That\ page\ is\ nested\ too\ deeply\ to\ read\ here\.\ Paste\ its\ text\ instead\.$/, "srv.nestedTooDeep", []],
  [/^That\ page\ has\ too\ many\ elements\ to\ read\ here\.\ Paste\ its\ text\ instead\.$/, "srv.tooManyElements", []],
  [/^Could\ not\ find\ a\ readable\ article\ on\ that\ page\.$/, "srv.noArticle", []],
  [/^The\ page\ had\ no\ readable\ paragraphs\.$/, "srv.noParagraphs", []],
  [/^That\ file\ is\ not\ a\ valid\ (.+?)\.$/, "srv.zipInvalid", ["what"]],
  [/^That\ (.+?)\ holds\ too\ many\ parts\ to\ read\ here\.$/, "srv.zipParts", ["what"]],
  [/^A\ part\ of\ that\ (.+?)\ is\ too\ large\ to\ read\ here\.$/, "srv.zipPartLarge", ["what"]],
  [/^That\ (.+?)\ is\ too\ large\ to\ read\ here\ once\ unpacked\.$/, "srv.zipUnpacked", ["what"]],
  [/^That\ file\ is\ not\ a\ valid\ (.+?),\ or\ it\ is\ damaged\ or\ protected\.$/, "srv.zipDamaged", ["what"]],
  [/^That\ PDF\ could\ not\ be\ opened\ \(it\ may\ be\ damaged\)\.$/, "srv.pdfOpen", []],
  [/^That\ PDF\ has\ (.+?)\ pages;\ the\ limit\ is\ (.+?)\.\ Import\ a\ shorter\ extract\.$/, "srv.pdfPages", ["n", "limit"]],
  [/^That\ PDF\ took\ too\ long\ to\ read\.$/, "srv.pdfSlow", []],
  [/^That\ PDF\ could\ not\ be\ read\ \(it\ may\ be\ damaged\)\.$/, "srv.pdfRead", []],
  [/^That\ PDF\ holds\ too\ much\ text\ to\ read\ here\.\ Import\ a\ shorter\ extract\.$/, "srv.pdfMuchText", []],
  [/^That\ PDF\ has\ no\ selectable\ text:\ it\ looks\ like\ a\ scan\ or\ a\ set\ of\ images,\ and\ this\ app\ does\ not\ read\ text\ in\ images\ \(there\ is\ no\ OCR\)\.\ Open\ a\ PDF\ that\ has\ a\ text\ layer,\ or\ paste\ the\ text\.$/, "srv.pdfScan", []],
  [/^That\ file\ is\ not\ an\ EPUB\ book\.$/, "srv.epubNot", []],
  [/^That\ EPUB\ has\ no\ readable\ package\ and\ cannot\ be\ opened\.$/, "srv.epubPackage", []],
  [/^That\ EPUB\ has\ no\ readable\ chapters\.$/, "srv.epubChapters", []],
  [/^That\ book\ holds\ more\ text\ than\ can\ be\ read\ here\ \(over\ 3\ million\ characters\)\.$/, "srv.epubMuch", []],
  [/^That\ file\ holds\ more\ text\ than\ can\ be\ read\ here\ \(over\ 3\ million\ characters\)\.$/, "srv.fileMuch", []],
  [/^Nothing\ readable\ in\ that\ web\ page\.$/, "srv.htmlNothing", []],
  [/^That\ file\ is\ not\ a\ Word\ document\ \(\.docx\)\.$/, "srv.docxNot", []],
  [/^That\ Word\ document\ is\ damaged\ and\ could\ not\ be\ read\.$/, "srv.docxDamaged", []],
  [/^That\ Word\ document\ has\ no\ text\.$/, "srv.docxEmpty", []],
  [/^The\ AI\ service\ took\ too\ long\ to\ answer\.\ Try\ again,\ or\ ask\ about\ a\ shorter\ passage\.$/, "srv.aiSlow", []],
  [/^The\ AI\ model\ used\ up\ its\ room\ thinking\ and\ gave\ no\ answer\.\ Try\ again,\ or\ ask\ for\ a\ longer\ answer\.$/, "srv.aiThinking", []],
  [/^The\ shared\ AI\ service\ is\ busy\ right\ now\.\ Try\ again\ in\ a\ few\ seconds\.$/, "srv.aiBusy", []],
  [/^Answers\ need\ a\ Together\ AI\ key\.\ Add\ yours\ from\ the\ key\ button\ in\ the\ top\ bar\.$/, "srv.needsKeyTop", []],
  [/^Import\ failed\ \((.+?)\)\.$/, "srv.importFailed", ["status"]],
  [/^“(.+?)”\ is\ already\ in\ your\ library\.$/, "srv.alreadyInLibrary", ["title"]],
  [/^The\ page\ could\ not\ be\ read\ here\.$/, "srv.pageNotReadHere", []],
  [/^A\ batch\ holds\ (.+?)\ files:\ (.+?)\ were\ left\ out\.\ Add\ them\ again\ when\ these\ finish\.$/, "srv.batchLimit", ["files", "skipped"]],
  [/^Could\ not\ reach\ the\ server\.\ Check\ your\ connection\ and\ try\ again\.$/, "srv.serverUnreachable", []],
  [/^Request\ failed\ \((.+?)\)\.$/, "srv.requestFailed", ["status"]],
  [/^The\ server\ sent\ no\ result\.$/, "srv.noResult", []],
  [/^That\ could\ not\ be\ saved\ to\ your\ library\ \(invalid\ data\)\.\ It\ is\ kept\ in\ this\ browser\.$/, "srv.invalidData", []],
  [/^Could\ not\ sync\ to\ your\ library\.\ Kept\ in\ this\ browser\.$/, "srv.syncFailed", []],
  [/^You\ seem\ to\ be\ offline\.\ Changes\ are\ kept\ in\ this\ browser\ and\ sync\ when\ you\ reload\.$/, "srv.offline", []],
  [/^That\ file\ could\ not\ be\ imported\.$/, "srv.fileNotImported", []],
  [/^That\ file\ is\ too\ large\ to\ be\ a\ backup\.$/, "srv.backupTooLarge", []],
  [/^That\ file\ is\ not\ a\ backup\ \(it\ is\ not\ valid\ JSON\)\.$/, "srv.backupNotJson", []],
  [/^That\ file\ is\ not\ an\ Understand\.io\ backup\.$/, "srv.backupNotApp", []],
  [/^That\ backup\ was\ made\ by\ a\ different\ version\ and\ cannot\ be\ read\.$/, "srv.backupVersion", []],
  [/^That\ backup\ is\ damaged\ \((.+?):\ (.+?)\)\.\ Nothing\ was\ restored\.$/, "srv.backupDamaged", ["where", "issue"]],
];

/** Phrases the server builds into a message: a period, a count of minutes, a name of what is limited. */
const FRAGMENTS: [RegExp | string, (m: RegExpExecArray | null) => string][] = [
  ["AI questions", () => tNow("srv.fragAiQuestions")],
  ["searches by meaning", () => tNow("srv.fragSearches")],
  ["voice transcriptions", () => tNow("srv.fragVoice")],
  ["add your own Together key with the key button in the top bar", () => tNow("srv.fragKeyHint")],
  ["Word document (.docx)", () => tNow("srv.docxWhat")],
  ["today", () => tNow("srv.fragToday")],
  ["this month", () => tNow("srv.fragThisMonth")],
  ["hour", () => tNow("srv.fragHour")],
  [/^(\d+) hours$/, (m) => tNow("srv.fragHours", { n: Number(m![1]) })],
  [/^(\d+) minutes$/, (m) => tNow("srv.fragMinutes", { n: Number(m![1]) })],
  [/^(\d+) seconds$/, (m) => tNow("srv.fragSeconds", { n: Number(m![1]) })],
];

function fragment(v: string): string {
  for (const [pat, f] of FRAGMENTS) {
    if (typeof pat === "string") {
      if (v === pat) return f(null);
    } else {
      const m = pat.exec(v);
      if (m) return f(m);
    }
  }
  return v;
}

/** The server's message in the page's language, or the message itself when it is English already or has no translation. */
export function localizeServerMessage(message: string | undefined | null): string {
  const text = (message ?? "").trim();
  if (!text || currentLocale() === "en") return text;
  for (const [re, key, names] of CATALOG) {
    const m = re.exec(text);
    if (!m) continue;
    const vars: Record<string, string> = {};
    names.forEach((n, i) => (vars[n] = fragment(m[i + 1])));
    return tNow(key, vars);
  }
  return text;
}

/** Every message the catalog knows, as `[English with {placeholders}, key]`, for the tests. */
export const SERVER_MESSAGE_KEYS: MessageKey[] = CATALOG.map(([, k]) => k);
export const catalogSize = CATALOG.length;
