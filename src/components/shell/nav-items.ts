import { BookOpen, ChartColumn, House, MoonStar, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Four primary destinations (CHANGE-2026-11-13 M4). Profile lives in the page header, not here. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Beranda", icon: House },
  { href: "/worship", label: "Amalan", icon: MoonStar },
  { href: "/quran", label: "Al-Qur'an", icon: BookOpen },
  { href: "/reports", label: "Laporan", icon: ChartColumn },
];

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
