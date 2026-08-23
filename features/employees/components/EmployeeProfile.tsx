"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { CurrentAbsenceBanner } from "@/features/absences/components/CurrentAbsenceBanner"
import { ArrangementBanner } from "@/features/employees/components/ArrangementBanner"
import { EmployeeForm } from "@/features/employees/components/EmployeeForm"
import { employeeService } from "@/features/employees/services/employee.service"
import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { getFullName } from "@/features/employees/utils/employee.format"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/layout/page-header"
import { SaveFailureBanner } from "@/components/feedback/save-failure-banner"
import { useSaveFailure } from "@/components/feedback/use-save-failure"

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
  const { failure, guard } = useSaveFailure()

  useEffect(() => { void employeeService.getById(employeeId).then(setEmployee) }, [employeeId])

  if (employee === undefined) return <p className="text-sm text-muted-foreground">Chargement du profil…</p>
  if (employee === null) return <div className="space-y-4"><PageHeader title="Employé introuvable" description="Ce profil n’existe pas ou n’est plus disponible." /><Button variant="outline" onClick={() => router.push("/configuration/employes")}>Retour aux employés</Button></div>
  const profile = employee

  /**
   * Enregistrer, puis revenir à la liste — comme le fait déjà la création.
   *
   * L'écran se contentait de remettre la fiche dans son état local : rien ne
   * bougeait à l'écran, et le gérant n'avait aucun moyen de distinguer un
   * enregistrement réussi d'un clic perdu. Il repassait donc par Configuration
   * puis Employés pour aller vérifier. Le retour à la liste EST la preuve : on
   * y voit la fiche modifiée.
   *
   * Et l'échec ne passe plus en silence. Cet écran écrivait sans filet depuis
   * que les données ont quitté le navigateur — une session expirée rejetait la
   * promesse, l'écran gardait la valeur saisie, et la base ne l'avait pas.
   */
  async function save(draft: EmployeeDraft) {
    const updated = await guard(() => employeeService.update(profile.id, draft))
    if (!updated) return
    setEmployee(updated)
    router.push("/configuration/employes")
  }

  async function disable() {
    // Pas de retour à la liste ici : la désactivation se lit sur place, dans le
    // statut de la fiche, et l'écran doit rester lisible pour la réactiver.
    const updated = await guard(() => employeeService.disable(profile.id))
    if (updated) setEmployee(updated)
  }

  return <div className="mx-auto max-w-7xl space-y-6"><PageHeader title={getFullName(profile)} description="Profil employé : informations, contrat, affectations et contraintes." /><SaveFailureBanner failure={failure} what="Cette fiche" /><CurrentAbsenceBanner employeeId={profile.id} /><ArrangementBanner employee={profile} /><EmployeeForm employee={profile} sundayOpen={sundayOpen} onSubmit={save} onCancel={() => router.push("/configuration/employes")} onDisable={disable} /></div>
}
