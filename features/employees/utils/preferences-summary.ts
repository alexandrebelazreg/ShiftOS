import type { EmployeeFormValues } from "@/features/employees/types/employee.types"

type PreferenceValues = Pick<
  EmployeeFormValues,
  | "preferOpening"
  | "preferClosing"
  | "preferredStartSide"
  | "preferredStartTime"
  | "preferredEndSide"
  | "preferredEndTime"
>

/**
 * Ce que la section repliée annonce — une entrée par souhait, vide sans souhait.
 *
 * Même forme que `advancedConstraintsSummary` : une section fermée qui ne dit
 * rien de son contenu cache un réglage actif, et le gérant croirait la fiche
 * sans souhait alors que le planning en tient compte.
 */
export function preferencesSummary(values: PreferenceValues): string[] {
  const summary: string[] = []
  if (values.preferOpening) summary.push("Préfère ouvrir")
  else if (values.preferClosing) summary.push("Préfère fermer")
  if (values.preferredStartSide !== "" && values.preferredStartTime !== "") {
    summary.push(
      `Préfère commencer ${values.preferredStartSide === "before" ? "avant" : "après"} ${values.preferredStartTime}`
    )
  }
  if (values.preferredEndSide !== "" && values.preferredEndTime !== "") {
    summary.push(
      `Préfère finir ${values.preferredEndSide === "before" ? "avant" : "après"} ${values.preferredEndTime}`
    )
  }
  return summary
}
