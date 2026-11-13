import { dispatchAdmin } from "@/server/admin/routes";

// Never prerender or cache: every answer is for one admin.
export const dynamic = "force-dynamic";

export const GET = dispatchAdmin;
export const POST = dispatchAdmin;
export const PUT = dispatchAdmin;
export const PATCH = dispatchAdmin;
export const DELETE = dispatchAdmin;
