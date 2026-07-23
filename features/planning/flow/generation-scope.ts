import type { SectorDemandConfiguration } from "@/features/sectors"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import type { StoreConfig } from "@/features/store/schemas/store.schema"

import {
  diagnoseSectorConfiguration,
  type SectorProblem,
} from "@/features/planning/flow/sector-diagnostics"

/**
 * What the engines are actually asked to plan — decided from the SELECTION,
 * never from "every active sector".
 *
 * The bug this replaces: generation read `setup.sectors`, so a manager who had
 * narrowed the page down to Drive still handed both Drive and Accueil to the
 * engines, and was told to go and deactivate Accueil in the configuration. The
 * configuration is shared and long-lived; the selection is what the manager is
 * doing right now. Only the second one belongs in a generation request.
 *
 * Everything downstream is derived from the selected sectors — the demand is
 * built from their coverage profiles, the daily budgets from their weekly
 * distribution, the shift rules from their own settings — so filtering the
 * sector list filters all of it, provided the EMPLOYEE list is filtered with it.
 * That last part is not optional: an employee left in the request while their
 * sector is out of it has a contract to honour and no demand to honour it
 * against, which V2 reports as `contract_inexact` and which reads to a manager
 * as "Drive is broken" when nothing about Drive is.
 */

export interface GenerationScope {
  /** The selected sectors, in the order the caller listed them. */
  readonly sectors: readonly SectorDemandConfiguration[]
  /** Only the people eligible for those sectors. */
  readonly employees: readonly EmployeeRecord[]
  readonly sectorIds: readonly string[]
}

export type GenerationScopeVerdict =
  | { readonly kind: "generate"; readonly scope: GenerationScope }
  | {
      readonly kind: "refused"
      readonly code: "no-selection" | "multiple-sectors" | "sector-configuration"
      /** The headline. One sentence, actionable. */
      readonly message: string
      /** Everything else worth showing underneath it. */
      readonly details: readonly SectorProblem[]
    }

export interface GenerationScopeInput {
  readonly store: StoreConfig | null
  readonly sectors: readonly SectorDemandConfiguration[]
  readonly employees: readonly EmployeeRecord[]
  /** Exactly what the page's sector menu has selected. Never a default. */
  readonly selectedSectorIds: readonly string[]
}

/**
 * Narrow a configuration to a selection, or explain why it cannot be planned.
 *
 * Pure. It calls no engine and builds no planning, so a refusal here costs the
 * caller nothing and can never disturb what is already on screen.
 */
export function resolveGenerationScope(input: GenerationScopeInput): GenerationScopeVerdict {
  const selectedIds = new Set(input.selectedSectorIds)
  // Archived sectors are not plannable whatever a stale selection says, so the
  // intersection is taken against the ACTIVE ones rather than trusting the ids.
  const selected = input.sectors.filter(
    (sector) => sector.status === "active" && selectedIds.has(sector.id)
  )

  if (selected.length === 0) {
    // An empty selection is a real state with a real meaning: nothing. It is
    // never quietly promoted to "all sectors" — that promotion is precisely how
    // an unselected, incomplete sector used to block a selected, valid one.
    return {
      kind: "refused",
      code: "no-selection",
      message: "Sélectionnez au moins un secteur à planifier.",
      details: [],
    }
  }

  if (selected.length > 1) {
    // Refused honestly, as a missing capability rather than a misconfiguration.
    // Nothing here asks anyone to change their configuration: the sectors are
    // fine, the engines simply cannot allocate one weekly budget across several
    // of them yet.
    return {
      kind: "refused",
      code: "multiple-sectors",
      message:
        "La génération simultanée de plusieurs secteurs n’est pas encore disponible. Sélectionnez un seul secteur pour générer son planning.",
      // Their own problems are still worth showing, below the headline, so a
      // manager narrowing down to one of them already knows what awaits.
      details: diagnoseSectorConfiguration({
        store: input.store,
        sectors: selected,
        employees: input.employees,
      }),
    }
  }

  const employees = eligibleEmployees(input.employees, selected)
  const problems = diagnoseSectorConfiguration({
    store: input.store,
    sectors: selected,
    employees,
  })
  if (problems.length > 0) {
    return {
      kind: "refused",
      code: "sector-configuration",
      message: `Le secteur « ${selected[0].name.trim() || "sans nom"} » ne peut pas être planifié en l’état.`,
      details: problems,
    }
  }

  return {
    kind: "generate",
    scope: { sectors: selected, employees, sectorIds: selected.map((sector) => sector.id) },
  }
}

/**
 * The people the selected sectors can actually draw on.
 *
 * Membership is by sector NAME, which is what an employee record stores. An
 * employee belonging to several sectors qualifies as soon as one of them is
 * selected; an employee belonging to none is excluded, because "no sector" is
 * not a sector this request is planning.
 */
export function eligibleEmployees(
  employees: readonly EmployeeRecord[],
  sectors: readonly SectorDemandConfiguration[]
): readonly EmployeeRecord[] {
  const names = new Set(sectors.map((sector) => sector.name))
  return employees.filter(
    (employee) => employee.status === "active" && employee.sectors?.some((name) => names.has(name))
  )
}

/** Every sector a manager may pick from: the active ones, in configured order. */
export function selectableSectors(
  sectors: readonly SectorDemandConfiguration[]
): readonly SectorDemandConfiguration[] {
  return sectors.filter((sector) => sector.status === "active")
}
