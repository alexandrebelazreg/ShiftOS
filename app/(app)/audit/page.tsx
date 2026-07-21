import type { Metadata } from "next"

import { PageHeader } from "@/components/layout/page-header"

export const metadata: Metadata = { title: "Audit" }

export default function AuditPage() {
  return <PageHeader title="Audit" />
}
