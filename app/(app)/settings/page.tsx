import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Paramètres" }

export default function SettingsPage() {
  return <PageHeader title="Paramètres" description="Les paramètres généraux seront disponibles ici." />
}
