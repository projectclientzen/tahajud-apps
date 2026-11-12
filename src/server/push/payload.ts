import type { NotificationPayload } from "./types";

const MAX_TITLE = 80;
const MAX_BODY = 240;

/** Builds the JSON the service worker reads. Only whitelisted fields are sent. */
export function buildPayload(p: NotificationPayload): string {
  if (!p.url.startsWith("/") || p.url.startsWith("//")) {
    throw new RangeError("Notification url must be a relative app path");
  }
  return JSON.stringify({
    type: p.type,
    title: p.title.slice(0, MAX_TITLE),
    body: p.body.slice(0, MAX_BODY),
    url: p.url,
    tag: p.tag ?? p.type,
  });
}
