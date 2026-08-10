"use client"

import { Controller, useFormContext } from "react-hook-form"
import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"

import { FormRow } from "@/features/employees/components/FormRow"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"
import { createSetupRepository } from "@/features/onboarding/setup-repository"
import type { SetupSector } from "@/features/onboarding/setup-readiness"
import { Button } from "@/components/ui/button"

/** Editable list of sectors mastered by the employee. */
export function SecteursTab() {
  const { control } = useFormContext<EmployeeFormValues>()
  const [availableSectors, setAvailableSectors] = useState<readonly SetupSector[]>([])
  useEffect(() => queueMicrotask(() => setAvailableSectors(createSetupRepository(window.localStorage).listSectors())), [])
  return (
    <FormRow label="Secteurs maîtrisés" description="Sélectionnez les secteurs déjà configurés.">
      <Controller
        control={control}
        name="sectors"
        render={({ field }) => {
          const move = (index: number, delta: -1 | 1) => {
            const target = index + delta
            if (target < 0 || target >= field.value.length) return
            const ordered = [...field.value]
            ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
            field.onChange(ordered)
          }

          if (availableSectors.length === 0) {
            return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Aucun secteur configuré. Créez d’abord un secteur dans Configuration.</p>
          }

          return <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {availableSectors.map((sector) => {
                const selected = field.value.includes(sector.name)
                return <Button
                  key={sector.id}
                  type="button"
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  onClick={() => field.onChange(selected
                    ? field.value.filter((value) => value !== sector.name)
                    : [...field.value, sector.name])}
                >
                  {sector.name}
                </Button>
              })}
            </div>

            {field.value.length > 1 ? <div className="space-y-2 rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Priorité des secteurs</p>
                <p className="text-xs text-muted-foreground">Le secteur n° 1 est la priorité déclarée. La génération reste actuellement secteur par secteur.</p>
              </div>
              {field.value.map((name, index) => (
                <div key={name} className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                  <span className="flex size-6 items-center justify-center rounded-full bg-background text-xs font-semibold">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
                  <Button type="button" size="icon" variant="ghost" disabled={index === 0} aria-label={`Monter ${name}`} onClick={() => move(index, -1)}><ArrowUp /></Button>
                  <Button type="button" size="icon" variant="ghost" disabled={index === field.value.length - 1} aria-label={`Descendre ${name}`} onClick={() => move(index, 1)}><ArrowDown /></Button>
                </div>
              ))}
            </div> : null}
          </div>
        }}
      />
    </FormRow>
  )
}
