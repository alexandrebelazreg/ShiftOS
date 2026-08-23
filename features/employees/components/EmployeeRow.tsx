"use client"

import { Pencil, Trash2 } from "lucide-react"
import Link from "next/link"

import { EmployeeStatusBadge } from "@/features/employees/components/EmployeeStatusBadge"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import {
  formatContractMinutes,
  formatWorkingDays,
  getFullName,
  getInitials,
} from "@/features/employees/utils/employee.format"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Une fiche sur une ligne, pour lire l'équipe entière d'un coup d'œil.
 *
 * La carte montre tout d'une personne ; la ligne compare les personnes entre
 * elles. C'est pour cela que les mêmes champs n'y figurent pas : le type
 * d'horaire et les compétences, utiles quand on examine quelqu'un, deviennent
 * du bruit quand on cherche qui travaille le samedi. On garde ce qui s'aligne
 * en colonnes et se compare — contrat, jours, secteurs, statut.
 */
export function EmployeeRow({
  employee,
  onDelete,
}: {
  employee: EmployeeRecord
  onDelete?: () => void
}) {
  const isInactive = employee.status === "inactive"
  const sectors = employee.sectors ?? []

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2.5 last:border-0",
        "hover:bg-muted/40",
        isInactive && "opacity-70"
      )}
    >
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
          {getInitials(employee)}
        </div>
        <p className="truncate text-sm font-medium">{getFullName(employee)}</p>
      </div>

      <p className="shrink-0 text-sm text-muted-foreground tabular-nums">
        {formatContractMinutes(employee.weeklyMinutes ?? Math.round(employee.weeklyHours * 60))}
      </p>

      <p className="min-w-0 flex-1 basis-40 truncate text-sm text-muted-foreground">
        {employee.workingDays.length > 0 ? formatWorkingDays(employee.workingDays) : "Aucun jour"}
      </p>

      <p className="min-w-0 flex-1 basis-40 truncate text-sm text-muted-foreground">
        {sectors.length > 0 ? sectors.join(" · ") : "Secteurs à renseigner"}
      </p>

      <EmployeeStatusBadge status={employee.status} />

      <div className="flex shrink-0 items-center gap-1">
        {onDelete ? (
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Supprimer la fiche de ${getFullName(employee)}`}>
            <Trash2 />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          render={<Link href={`/configuration/employes/${employee.id}`} />}
          aria-label={`Voir le profil de ${getFullName(employee)}`}
        >
          <Pencil />
        </Button>
      </div>
    </div>
  )
}
