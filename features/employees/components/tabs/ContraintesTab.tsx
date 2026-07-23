"use client"

import { Controller, useFormContext } from "react-hook-form"

import { DayToggleGroup } from "@/features/employees/components/DayToggleGroup"
import { FormRow } from "@/features/employees/components/FormRow"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"
import { Input } from "@/components/ui/input"
import { SwitchField } from "@/features/employees/components/SwitchField"

export function ContraintesTab() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<EmployeeFormValues>()

  return (
    <div className="grid gap-4">
      <div className="space-y-2"><p className="text-sm font-medium">Contraintes de service</p><SwitchField name="canOpen" label="Peut ouvrir" /><SwitchField name="canClose" label="Peut fermer" /><SwitchField name="splitShiftAllowed" label="Coupure autorisée" /></div>
      <FormRow label="Repos fixes" description="Ces jours ne seront jamais planifiés.">
        <Controller
          control={control}
          name="fixedDaysOff"
          render={({ field }) => (
            <DayToggleGroup value={field.value} onChange={field.onChange} ariaLabel="Repos fixes" />
          )}
        />
      </FormRow>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow
          label="Nombre maximal d’ouvertures"
          htmlFor="maxOpenings"
          description="Par semaine — laissez vide sans limite."
          error={errors.maxOpenings?.message}
        >
          <Input
            id="maxOpenings"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Sans limite"
            aria-invalid={!!errors.maxOpenings || undefined}
            {...register("maxOpenings")}
          />
        </FormRow>

        <FormRow
          label="Nombre maximal de fermetures"
          htmlFor="maxClosings"
          description="Par semaine — laissez vide sans limite."
          error={errors.maxClosings?.message}
        >
          <Input
            id="maxClosings"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="Sans limite"
            aria-invalid={!!errors.maxClosings || undefined}
            {...register("maxClosings")}
          />
        </FormRow>
      </div>
    </div>
  )
}
