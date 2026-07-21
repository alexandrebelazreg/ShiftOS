import { redirect } from "next/navigation"

import { AppShell } from "@/components/layout/app-shell"
import { hasStore } from "@/features/store/services/store.repository"

/**
 * Layout for the authenticated application area. Until a store exists, the
 * manager is redirected into onboarding so the app is never shown empty.
 */
export default async function AppAreaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (!(await hasStore())) {
    redirect("/onboarding")
  }

  return <AppShell>{children}</AppShell>
}
