"use client"

import { Controller, useFormContext } from "react-hook-form"
import { useEffect, useState } from "react"

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
        render={({ field }) => (
          availableSectors.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Aucun secteur configuré. Créez d’abord un secteur dans Configuration.</p> : <div className="flex flex-wrap gap-2">{availableSectors.map((sector) => { const selected = field.value.includes(sector.name); return <Button key={sector.id} type="button" size="sm" variant={selected ? "default" : "outline"} onClick={() => field.onChange(selected ? field.value.filter((value) => value !== sector.name) : [...field.value, sector.name])}>{sector.name}</Button> })}</div>
        )}
      />
    </FormRow>
  )
}
