"use client"

import { useCallback, useEffect, useState } from "react"

import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import { employeeService } from "@/features/employees/services/employee.service"
import { sortEmployeesByName } from "@/features/employees/utils/employee.format"
import { employeeDeletionVerdict } from "@/features/employees/deletion"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { EmployeeScheduleType } from "@/features/employees/types/employee.types"

/**
 * React state wrapper around `employeeService`. Holds the list as the single
 * source of truth for the UI and refreshes it after every mutation.
 */
export function useEmployees() {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Rangée une fois ici, et tous les écrans en héritent.
  //
  // Le tri ne descend pas dans le service : l'ordre des salariés qu'on soumet
  // au solveur entre dans l'empreinte du problème, et le déplacer déplacerait
  // des plannings existants. Le constructeur de problème range de son côté par
  // identifiant, ce qui l'isole de tout choix d'affichage.
  const refresh = useCallback(async () => {
    setEmployees(sortEmployeesByName(await employeeService.list()))
  }, [])

  useEffect(() => {
    let active = true
    employeeService.list().then((list) => {
      if (active) {
        setEmployees(sortEmployeesByName(list))
        setIsLoading(false)
      }
    })
    return () => {
      active = false
    }
  }, [])

  const createEmployee = useCallback(
    async (draft: EmployeeDraft) => {
      const created = await employeeService.create(draft)
      await refresh()
      return created
    },
    [refresh]
  )

  const updateEmployee = useCallback(
    async (id: string, draft: EmployeeDraft) => {
      const updated = await employeeService.update(id, draft)
      await refresh()
      return updated
    },
    [refresh]
  )

  const disableEmployee = useCallback(
    async (id: string) => {
      const disabled = await employeeService.disable(id)
      await refresh()
      return disabled
    },
    [refresh]
  )

  /**
   * Efface la fiche — après vérification, jamais à l'aveugle.
   *
   * Le verdict est rendu ICI, et non par l'écran : un appelant distrait qui
   * oublierait de le consulter emporterait des absences que la cascade SQL
   * effacerait sans un mot. L'écran s'en sert pour prévenir AVANT de proposer
   * le geste ; cette seconde lecture est ce qui garantit que l'état n'a pas
   * changé entre l'avertissement et le clic.
   */
  const removeEmployee = useCallback(
    async (id: string) => {
      // Chargé au clic, et non à l'import : ce module tire les plannings, les
      // absences, les permanences et les congés. Les faire entrer dans le
      // paquet de tous les écrans qui listent l'équipe ferait payer à chacun
      // d'eux un code que seule la suppression exécute.
      const { loadEmployeeCitationSources } = await import("@/features/employees/citation-sources")
      const sources = await loadEmployeeCitationSources()
      const verdict = employeeDeletionVerdict(id, sources)
      if (!verdict.deletable) return verdict
      await employeeService.remove(id)
      await refresh()
      return verdict
    },
    [refresh]
  )

  const setEmployeeScheduleType = useCallback(
    async (id: string, scheduleType: EmployeeScheduleType) => {
      const updated = await employeeService.setScheduleType(id, scheduleType)
      await refresh()
      return updated
    },
    [refresh]
  )

  return {
    employees,
    isLoading,
    createEmployee,
    updateEmployee,
    disableEmployee,
    removeEmployee,
    setEmployeeScheduleType,
  }
}
