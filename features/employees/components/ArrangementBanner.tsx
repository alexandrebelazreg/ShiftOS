"use client"

import {
  arrangementLabel,
  arrangementOn,
} from "@/features/employees/models/contract-arrangement"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"

/**
 * « Mi-temps thérapeutique, 17 h 30, jusqu'au 31/05/2026 », en tête de fiche.
 *
 * Ce qu'on doit savoir AVANT de régler quoi que ce soit d'autre : le contrat
 * affiché dans l'onglet ne sera pas celui que le planning applique cette
 * semaine-ci. Sans cette ligne, on discute des trente-cinq heures de quelqu'un
 * qui en fait dix-sept.
 *
 * Rien ne s'affiche hors période — y compris pour un aménagement enregistré
 * mais terminé, qui n'est plus une information mais un souvenir.
 */
export function ArrangementBanner({ employee }: { readonly employee: EmployeeRecord }) {
  const today = new Date().toISOString().slice(0, 10)
  const arrangement = arrangementOn(employee, today)
  if (arrangement === null) return null

  return (
    <p className="rounded-lg border border-sky-500/50 bg-sky-50 p-3 text-sm dark:bg-sky-950/30">
      <strong>Contrat aménagé</strong> — {arrangementLabel(arrangement)}
      {arrangement.daysOff.length > 0 ? ", jours en moins réglés dans l’onglet Contrat" : ""}.
    </p>
  )
}
