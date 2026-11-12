import { createDataLayer, type ScenarioName, type VerifyOtpResponse } from "@/data";

/**
 * First sign-in on this device: give the mock "server" state for this user. A user whose access is active
 * starts at onboarding, the others see their access state. Later sign-ins keep the stored state.
 * Mock mode only; the real server creates this row itself (S5).
 */
export async function seedUserData(res: VerifyOtpResponse): Promise<void> {
  const scenario: ScenarioName =
    res.access.access_status === "active"
      ? "onboarding_pending"
      : res.access.access_status === "awaiting_order_verification"
        ? "purchase_pending"
        : "no_active_access";
  const layer = createDataLayer({ userId: res.user.id, scenario });
  if (layer.mode === "mock") await layer.access.getAccess();
}

export const LOGIN_EMAIL_KEY = "tt-login-email";
export const LOGIN_NOTICE_KEY = "tt-login-notice";

export function rememberLogin(email: string, notice: string) {
  try {
    sessionStorage.setItem(LOGIN_EMAIL_KEY, email);
    sessionStorage.setItem(LOGIN_NOTICE_KEY, notice);
  } catch {
    /* storage blocked: the verify screen asks for the email again */
  }
}

export function recallLogin(): { email: string; notice: string } {
  try {
    return {
      email: sessionStorage.getItem(LOGIN_EMAIL_KEY) ?? "",
      notice: sessionStorage.getItem(LOGIN_NOTICE_KEY) ?? "",
    };
  } catch {
    return { email: "", notice: "" };
  }
}
