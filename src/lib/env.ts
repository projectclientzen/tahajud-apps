export type DataMode = "mock" | "live";

/** Data source for repositories. Mock is the default until S5 wires the backend. */
export const DATA_MODE: DataMode = process.env.NEXT_PUBLIC_DATA_MODE === "live" ? "live" : "mock";

export const IS_DEMO = DATA_MODE === "mock";

/** Dev-only routes (component gallery). Off in production unless explicitly enabled. */
export const DEV_ROUTES_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_ROUTES === "true";

/**
 * Customer service WhatsApp number, digits only (country code first, e.g. 6281234567890).
 * Empty means the WhatsApp button is hidden everywhere.
 */
export const CS_WHATSAPP: string = (process.env.NEXT_PUBLIC_CS_WHATSAPP ?? "").replace(/\D/g, "");

/** Link to buy access on Scalev. Only https links are used. Empty hides the buy button. */
export const PURCHASE_URL: string = /^https:\/\//.test(process.env.NEXT_PUBLIC_PURCHASE_URL ?? "")
  ? (process.env.NEXT_PUBLIC_PURCHASE_URL as string)
  : "";

/** `wa.me` link with a ready message. The message never carries email or other personal data. */
export function whatsappLink(message: string, number: string = CS_WHATSAPP): string | null {
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null;
}
