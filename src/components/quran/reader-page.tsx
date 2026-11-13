"use client";

import * as React from "react";
import { FullReader, type MarkProps } from "./full-reader";
import type { ReadMode } from "./read-modes";
import { useKhatam } from "./use-khatam";

/** Client wrapper for the reader route. Marking only shows while a khatam target is running. */
export function KhatamReaderPage({ mode, n }: { mode: ReadMode; n: number }) {
  const k = useKhatam();
  const view = k.view;
  const mark: MarkProps | undefined =
    view && view.status === "active"
      ? {
          // Position after `pagesRead` pages is the next page to read, so the last read page is one before it.
          lastReadPage: view.pagesRead === 0 ? null : ((view.pagesRead - 1) % 604) + 1,
          onMark: (page) => k.markPage(page),
        }
      : undefined;
  return <FullReader mode={mode} n={n} mark={mark} />;
}
