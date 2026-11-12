import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth/auth-frame";
import { AppGate } from "@/components/auth/gate";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export const metadata: Metadata = { title: "Mulai" };

export default function OnboardingPage() {
  return (
    <AuthFrame>
      <AppGate need="onboarding">
        <OnboardingFlow />
      </AppGate>
    </AuthFrame>
  );
}
