"use client"
import { useRouter } from "next/navigation"
import { EmployeeForm } from "@/features/employees/components/EmployeeForm"
import { employeeService } from "@/features/employees/services/employee.service"
import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import { PageHeader } from "@/components/layout/page-header"
import { SaveFailureBanner } from "@/components/feedback/save-failure-banner"
import { useSaveFailure } from "@/components/feedback/use-save-failure"
export function EmployeeCreatePage({ sundayOpen }: { sundayOpen: boolean }) { const router = useRouter(); const { failure, guard } = useSaveFailure(); async function create(draft: EmployeeDraft) { const created = await guard(() => employeeService.create(draft)); if (created) router.push("/configuration/employes") } return <div className="mx-auto max-w-7xl space-y-6"><SaveFailureBanner failure={failure} what="Cette fiche" /><PageHeader title="Nouvel employé" description="Renseignez l’identité, le contrat, les affectations puis les contraintes." /><EmployeeForm employee={null} sundayOpen={sundayOpen} onSubmit={create} onCancel={() => router.push("/configuration/employes")} /></div> }
