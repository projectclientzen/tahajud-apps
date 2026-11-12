import { createDatasetQuranText } from "./text";

export * from "./text";

/** Shared instance: the dataset chunk loads once per page session. */
export const quranText = createDatasetQuranText();
