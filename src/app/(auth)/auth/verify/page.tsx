import { redirect } from "next/navigation";

// The 6 digit code screen is gone (login is email + password). Old bookmarks and open tabs land on /login.
export default function Page() {
  redirect("/login");
}
