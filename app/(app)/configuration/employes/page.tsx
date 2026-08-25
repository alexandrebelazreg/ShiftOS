import type { Metadata } from "next"

import { EmployeesView } from "@/features/employees/components/EmployeesView"

export const metadata: Metadata = { title: "Employés" }

export default function ConfigurationEmployeesPage() { return <EmployeesView /> }
