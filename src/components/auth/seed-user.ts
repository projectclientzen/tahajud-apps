import { createDataLayer, type ScenarioName, type SignInResponse } from "@/data";

/**
 * First sign-in on this device: give the mock "server" state for this user. A user whose access is active
 * starts at onboarding, the others see their access state. Later sign-ins keep the stored state.
 * Mock mode only; the real server creates this row itself.
 */
export async function seedUserData(res: SignInResponse): Promise<void> {
  const scenario: ScenarioName =
    res.access.access_status === "active"
      ? "onboarding_pending"
      : res.access.access_status === "awaiting_order_verification"
        ? "purchase_pending"
        : "no_active_access";
  const layer = createDataLayer({ userId: res.user.id, scenario });
  if (layer.mode === "mock") await layer.access.getAccess();
}
