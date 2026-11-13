import { createDatasetQuranText } from "./text";

export * from "./text";
export * from "./full";

/** Shared instance: the dataset chunk loads once per page session. */
export const quranText = createDatasetQuranText();
