"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { EmployeeForm } from "@/features/employees/components/EmployeeForm"
import { employeeService } from "@/features/employees/services/employee.service"
import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { getFullName } from "@/features/employees/utils/employee.format"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/layout/page-header"

/** Dedicated editing page: the single place where an employee profile is changed. */
export function EmployeeProfile({
  employeeId,
  sundayOpen,
}: {
  employeeId: string
  sundayOpen: boolean
}) {
  const router = useRouter()
  const [employee, setEmployee] = useState<EmployeeRecord | null | undefined>(undefined)

  useEffect(() => { void employeeService.getById(employeeId).then(setEmployee) }, [employeeId])

  if (employee === undefined) return <p className="text-sm text-muted-foreground">Chargement du profil…</p>
  if (employee === null) return <div className="space-y-4"><PageHeader title="Employé introuvable" description="Ce profil n’existe pas ou n’est plus disponible." /><Button variant="outline" onClick={() => router.push("/configuration/employes")}>Retour aux employés</Button></div>
  const profile = employee

  async function save(draft: EmployeeDraft) {
    const updated = await employeeService.update(profile.id, draft)
    setEmployee(updated)
  }

  async function disable() {
    const updated = await employeeService.disable(profile.id)
    setEmployee(updated)
  }

  return <div className="mx-auto max-w-7xl space-y-6"><PageHeader title={getFullName(profile)} description="Profil employé : informations, contrat, affectations et contraintes." /><EmployeeForm employee={profile} sundayOpen={sundayOpen} onSubmit={save} onCancel={() => router.push("/configuration/employes")} onDisable={disable} /></div>
}
