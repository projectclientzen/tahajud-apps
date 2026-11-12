import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth/auth-frame";
import { AppGate } from "@/components/auth/gate";
import { ExtraSteps } from "@/components/onboarding/extra-steps";

export const metadata: Metadata = { title: "Langkah tambahan" };

export default function OnboardingExtraPage() {
  return (
    <AuthFrame>
      <AppGate need="app">
        <ExtraSteps />
      </AppGate>
    </AuthFrame>
  );
}
