import type { Metadata } from "next"
import { PageHeader } from "@/components/layout/page-header"
import { SectorConfigurationView } from "@/features/sectors/SectorConfigurationView"
import { getStore } from "@/features/store"
export const metadata: Metadata = { title: "Configuration des secteurs" }
export default async function SectorsPage() { const store = await getStore(); return <div className="space-y-6"><PageHeader title="Secteurs" description="Décrivez précisément le fonctionnement et la demande de chaque secteur." /><SectorConfigurationView store={store} /></div> }
