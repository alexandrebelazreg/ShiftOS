import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { StoreConfig } from "@/features/store/schemas/store.schema"
import { isSectorDemandReady, type SectorDemandConfiguration } from "@/features/sectors"

export type SetupSector = SectorDemandConfiguration
export interface SetupReadiness { readonly ready: boolean; readonly blockers: readonly string[] }

/** Product-level gate only; it never invokes or mutates a Core engine. */
export function evaluateSetupReadiness({ store, employees, sectors }: { readonly store: StoreConfig | null; readonly employees: readonly EmployeeRecord[]; readonly sectors: readonly SetupSector[] }): SetupReadiness {
  const blockers: string[] = []
  if (!store) blockers.push("Configurez les informations du magasin.")
  if (!store?.openingHours.some((day) => !day.closed)) blockers.push("Indiquez au moins un jour et des horaires d’ouverture.")
  if (sectors.length === 0) blockers.push("Créez au moins un secteur.")
  sectors.filter((sector) => sector.status === "active" && !isSectorDemandReady(sector, store, employees)).forEach((sector) => blockers.push(`Complétez la configuration de demande du secteur « ${sector.name || "sans nom"} » et affectez-lui au moins un salarié.`))
  if (employees.filter((employee) => employee.status === "active").length === 0) blockers.push("Ajoutez au moins un employé actif.")
  return { ready: blockers.length === 0, blockers }
}
