"use client"
import { useRouter } from "next/navigation"
import { EmployeeForm } from "@/features/employees/components/EmployeeForm"
import { employeeService } from "@/features/employees/services/employee.service"
import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import { PageHeader } from "@/components/layout/page-header"
export function EmployeeCreatePage() { const router = useRouter(); async function create(draft: EmployeeDraft) { await employeeService.create(draft); router.push("/configuration/employes") } return <div className="mx-auto max-w-7xl space-y-6"><PageHeader title="Nouvel employé" description="Renseignez l’identité, le contrat, les affectations puis les contraintes." /><EmployeeForm employee={null} onSubmit={create} onCancel={() => router.push("/configuration/employes")} /></div> }
