import { topicInfo } from "@/lib/content/types";
import type { MessageKey, Translator } from "./translate";

/** A topic's name in the reader's language (the topic ids are stable data; only the words change). An id with no entry shows its English label. */
export function topicName(t: Translator, id: string): string {
  const key = `topics.${id}` as MessageKey;
  const v = t(key);
  return v === key ? topicInfo(id).label : v;
}
