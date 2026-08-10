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
              // `items` lets <SelectValue /> render the option label instead of
              // the raw enum value ("full_time").
              <Select
                items={CONTRACT_TYPE_OPTIONS}
                value={field.value}
                onValueChange={field.onChange}
              >
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

      {watch("contractConfirmationRequired") ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm">
          <p className="font-medium">Ancien contrat ambigu : confirmez la durée historique.</p>
          <div className="mt-3 flex gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" value="2190" {...register("legacyContractMinutes")} /> 36 h 30
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" value="2205" {...register("legacyContractMinutes")} /> 36 h 45
            </label>
          </div>
          {errors.legacyContractMinutes?.message ? (
            <p className="mt-2 text-destructive">{errors.legacyContractMinutes.message}</p>
          ) : null}
        </div>
      ) : null}

      <FormRow label="Type d’horaire" description="Variable est sélectionné par défaut. Le mode fixe classe l’employé sans modifier son contrat.">
        <Controller
          control={control}
          name="scheduleType"
          render={({ field }) => (
            <div className="flex flex-wrap gap-3">
              {(["variable", "fixed"] as const).map((value) => (
                <label key={value} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name={field.name}
                    value={value}
                    checked={field.value === value}
                    onChange={() => field.onChange(value)}
                  />
                  Horaire {value === "variable" ? "variable" : "fixe"}
                </label>
              ))}
            </div>
          )}
        />
      </FormRow>

      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Les jours travaillés sont automatiquement déduits des repos fixes.</p>
    </div>
  )
}
