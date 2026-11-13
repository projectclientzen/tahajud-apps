"use client";

import { FullReader } from "./full-reader";
import type { ReadMode } from "./read-modes";

/** Client wrapper for the reader route. Stage 3 adds the khatam "mark as read" actions here. */
export function KhatamReaderPage({ mode, n }: { mode: ReadMode; n: number }) {
  return <FullReader mode={mode} n={n} />;
}
