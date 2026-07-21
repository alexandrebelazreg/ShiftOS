"use client"

import { Controller, useFormContext } from "react-hook-form"

import { FormRow } from "@/features/employees/components/FormRow"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"
import { CONTRACT_TYPE_OPTIONS } from "@/features/employees/utils/employee.labels"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function ContratTab() {
  const {
    control,
    register,
    watch,
    formState: { errors },
  } = useFormContext<EmployeeFormValues>()

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <FormRow
          label="Heures"
          htmlFor="weeklyHours"
          required
          description="Heures entières par semaine"
          error={errors.weeklyHours?.message}
        >
          <Input
            id="weeklyHours"
            type="text"
            inputMode="numeric"
            placeholder="36"
            aria-invalid={!!errors.weeklyHours || undefined}
            {...register("weeklyHours")}
          />
        </FormRow>

        <FormRow label="Minutes" htmlFor="weeklyMinuteRemainder" required description="0, 15, 30 ou 45" error={errors.weeklyMinuteRemainder?.message}>
          <Input id="weeklyMinuteRemainder" type="number" min={0} max={45} step={15} aria-invalid={!!errors.weeklyMinuteRemainder || undefined} {...register("weeklyMinuteRemainder")} />
        </FormRow>

        <FormRow
          label="Type de contrat"
          htmlFor="contractType"
          error={errors.contractType?.message}
        >
          <Controller
            control={control}
            name="contractType"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="contractType" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormRow>
      </div>

      {watch("contractConfirmationRequired") ? <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm"><p className="font-medium">Ancien contrat ambigu : confirmez la durée historique.</p><div className="mt-3 flex gap-4"><label><input type="radio" value="2190" {...register("legacyContractMinutes")} /> 36 h 30 — 2 190 minutes</label><label><input type="radio" value="2205" {...register("legacyContractMinutes")} /> 36 h 45 — 2 205 minutes</label></div>{errors.legacyContractMinutes?.message ? <p className="mt-2 text-destructive">{errors.legacyContractMinutes.message}</p> : null}</div> : null}

      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Les jours travaillés sont automatiquement déduits des repos fixes.</p>
    </div>
  )
}
