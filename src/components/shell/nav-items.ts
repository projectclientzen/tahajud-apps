import { BookOpen, House, MoonStar, UserRound, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Four primary destinations (PRD v1.2 §5.1). */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Beranda", icon: House },
  { href: "/worship", label: "Amalan", icon: MoonStar },
  { href: "/quran", label: "Al-Qur'an", icon: BookOpen },
  { href: "/profile", label: "Profil", icon: UserRound },
];

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
