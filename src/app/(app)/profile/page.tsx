import type { Metadata } from "next";
import { ProfileSummary } from "@/components/settings/profile-summary";

export const metadata: Metadata = { title: "Profil" };

export default function ProfilePage() {
  return <ProfileSummary />;
}
