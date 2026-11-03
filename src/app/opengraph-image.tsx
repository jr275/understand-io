import { ogCard, OG_SIZE } from "@/lib/seo/ogCard";
import { translate } from "@/i18n/translate";

/** The English social card, used by every page that has none of its own. The Portuguese pages point at `/og/pt-BR` (see `socialFor`). */
export const alt = translate("en", "meta.landingTitle");
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard("en");
}
