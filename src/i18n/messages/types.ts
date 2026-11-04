import type { en } from "./en";

/** The shape of a dictionary: the English one decides it, and every other language must have exactly the same keys (the compiler checks it). */
type Widen<T> = T extends string ? string : T extends { one: string; other: string } ? { one: string; other: string } : { [K in keyof T]: Widen<T[K]> };
export type Messages = Widen<typeof en>;
