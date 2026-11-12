import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Custom font-size tokens (see @theme in globals.css). Without this, tailwind-merge
// reads `text-body` as a text color and drops `text-on-primary` from the same call.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["helper", "body", "card-title", "page-title", "stat", "dhikr", "quran"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
