import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Profil" };

export default function ProfilePage() {
  return (
    <>
      <PageHeader title="Profil" description="Akun, wilayah, dan notifikasi masuk sesi S4." />
      <Card>
        <ThemeToggle />
      </Card>
    </>
  );
}
