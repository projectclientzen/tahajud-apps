import { h } from "@/server/api/routes";

// Never prerender or cache: every answer is per user.
export const dynamic = "force-dynamic";

export const GET = h.getKhatam;
export const POST = h.createKhatam;
