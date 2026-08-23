"use client"

import { CalendarDays, Clock, MapPin, Pencil, Trash2 } from "lucide-react"
import Link from "next/link"

import { CapabilityBadges } from "@/features/employees/components/CapabilityBadges"
import { EmployeeStatusBadge } from "@/features/employees/components/EmployeeStatusBadge"
import type {
  EmployeeRecord,
  EmployeeScheduleType,
} from "@/features/employees/types/employee.types"
import {
  formatContractSummary,
  formatContractMinutes,
  formatWorkingDays,
  getFullName,
  getInitials,
} from "@/features/employees/utils/employee.format"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * Employee summary card. Shows identity, contract, working days, status and the
 * three shift capabilities, plus an Edit action.
 */
export function EmployeeCard({
  employee,
  onScheduleTypeChange,
  onDelete,
}: {
  employee: EmployeeRecord
  onScheduleTypeChange: (value: EmployeeScheduleType) => void | Promise<unknown>
  /** Absent, la carte ne propose pas la suppression du tout. */
  onDelete?: () => void
}) {
  const isInactive = employee.status === "inactive"
  const sectors = employee.sectors ?? []
  const scheduleType = employee.scheduleType ?? "variable"

  return (
    <Card className={cn("gap-0", isInactive && "opacity-70")}>
      <CardContent className="flex flex-col gap-4">
        {/* Header: identity + status */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              {getInitials(employee)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {getFullName(employee)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatContractSummary(employee)}
              </p>
            </div>
          </div>
          <EmployeeStatusBadge status={employee.status} />
        </div>

        {/* Contract + working days */}
        <dl className="grid gap-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
            <Clock className="size-4 shrink-0" />
            <dt className="sr-only">Contrat hebdomadaire</dt>
            <dd>{formatContractMinutes(employee.weeklyMinutes ?? Math.round(employee.weeklyHours * 60))} / semaine</dd>
            <fieldset className="ml-auto flex items-center gap-2 rounded-md border px-2 py-1 text-[11px]" disabled={isInactive}>
              <legend className="sr-only">Type d’horaire</legend>
              {(["variable", "fixed"] as const).map((value) => (
                <label key={value} className="flex cursor-pointer items-center gap-1 whitespace-nowrap">
                  <input
                    type="radio"
                    name={`schedule-type-${employee.id}`}
                    value={value}
                    checked={scheduleType === value}
                    onChange={() => void onScheduleTypeChange(value)}
                  />
                  {value === "variable" ? "Variable" : "Fixe"}
                </label>
              ))}
            </fieldset>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <CalendarDays className="size-4 shrink-0" />
            <dt className="sr-only">Jours travaillés</dt>
            <dd>
              {employee.workingDays.length > 0
                ? formatWorkingDays(employee.workingDays)
                : "Aucun jour travaillé"}
            </dd>
          </div>
          <div className="flex items-start gap-2 text-muted-foreground"><MapPin className="mt-0.5 size-4 shrink-0" /><dt className="sr-only">Secteurs maîtrisés par priorité</dt><dd>{sectors.length > 0 ? sectors.map((sector, index) => `${index + 1}. ${sector}`).join(" · ") : "Secteurs à renseigner"}</dd></div>
        </dl>

        {/* Capabilities */}
        <CapabilityBadges
          canOpen={employee.canOpen}
          canClose={employee.canClose}
          splitShiftAllowed={employee.splitShiftAllowed}
        />

        {/* Action */}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          {onDelete ? (
            <Button variant="ghost" size="sm" onClick={onDelete} aria-label={`Supprimer la fiche de ${getFullName(employee)}`}>
              <Trash2 />
              Supprimer
            </Button>
          ) : null}
          <Button variant="outline" size="sm" render={<Link href={`/configuration/employes/${employee.id}`} />}>
            <Pencil />
            Voir le profil
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
