import { getServices } from "@/server/jobs/services";
import { handleScalevWebhook } from "@/server/scalev/intake";

// Own route, not the /api/v1 pipeline: Scalev sends no cookie and no Origin header, and the body must be read raw
// (the signature is over the exact bytes). Never cached, never prerendered.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  return handleScalevWebhook(req, { db: async () => (await getServices()).db });
}
