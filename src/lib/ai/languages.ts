/** Languages the translation and output-language pickers offer. Add a line here to support another one; nothing else depends on this list. */
export const LANGUAGES: Record<string, string> = {
  pt: "Portuguese",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  nl: "Dutch",
  ru: "Russian",
  ja: "Japanese",
  zh: "Chinese",
  ar: "Arabic",
};

/** How the product's own two languages are named to the model: Portuguese is always the Brazilian variety. */
export const INTERFACE_LANGUAGE_NAME: Record<string, string> = { en: "English", "pt-BR": "Brazilian Portuguese" };

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as [string, ...string[]];

export const languageName = (code: string | undefined | null) => (code ? LANGUAGES[code.toLowerCase().slice(0, 2)] ?? code : "the language of the text");
