"use client"

import { useEffect, useState } from "react"

import { absenceMotiveLabel } from "@/features/absences/models/absence-motive"
import { absenceCoversDate, absencePeriodLabel } from "@/features/absences/models/absence-period"
import { absenceService } from "@/features/absences/services/absence.service"
import type { AbsenceRecord } from "@/features/absences/types/absence-record"

/**
 * « Absent en ce moment », en tête de la fiche employé.
 *
 * Une ligne, pas un historique : la fiche sert à régler un contrat et des
 * contraintes, et y empiler les absences passées la transformerait en dossier
 * disciplinaire. Ce qu'il faut savoir en l'ouvrant, c'est si la personne est là
 * — sinon on règle les samedis de quelqu'un qui ne reviendra qu'en mai.
 *
 * Rien ne s'affiche quand la personne est présente : c'est le cas ordinaire, et
 * un bandeau vert « présent » sur trente fiches n'apprend rien à personne.
 */
export function CurrentAbsenceBanner({ employeeId }: { readonly employeeId: string }) {
  const [absence, setAbsence] = useState<AbsenceRecord | null>(null)

  useEffect(() => {
    let cancelled = false
    const today = new Date().toISOString().slice(0, 10)
    void absenceService.list().then((absences) => {
      if (cancelled) return
      setAbsence(
        absences.find(
          (candidate) =>
            candidate.employeeId === employeeId && absenceCoversDate(candidate, today)
        ) ?? null
      )
    })
    return () => {
      cancelled = true
    }
  }, [employeeId])

  if (absence === null) return null

  return (
    <p className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
      <strong>Absent</strong> — {absenceMotiveLabel(absence.type)}, {absencePeriodLabel(absence)}.
    </p>
  )
}
