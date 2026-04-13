import { redirect } from "next/navigation";

// Root route — redirect to login; the app layout will redirect to role dashboard after auth
export default function RootPage() {
  redirect("/login");
}
