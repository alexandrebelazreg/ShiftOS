"use client"

import { useFormContext } from "react-hook-form"

import { FormField } from "@/features/store/components/FormField"
import { FormSection } from "@/features/store/components/FormSection"
import type { StoreFormValues } from "@/features/store/types/store.types"
import { Input } from "@/components/ui/input"

export function GeneralRulesSection() {
  const {
    register,
    formState: { errors },
  } = useFormContext<StoreFormValues>()

  return (
    <FormSection
      title="General rules"
      description="Baseline working-time constraints applied to every planning."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label="Minimum daily hours"
          htmlFor="minDailyHours"
          required
          description="Hours"
          error={errors.minDailyHours?.message}
        >
          <Input
            id="minDailyHours"
            type="number"
            min={0}
            step="0.5"
            inputMode="decimal"
            placeholder="e.g. 4"
            aria-invalid={!!errors.minDailyHours || undefined}
            {...register("minDailyHours")}
          />
        </FormField>

        <FormField
          label="Maximum daily hours"
          htmlFor="maxDailyHours"
          required
          description="Hours"
          error={errors.maxDailyHours?.message}
        >
          <Input
            id="maxDailyHours"
            type="number"
            min={0}
            step="0.5"
            inputMode="decimal"
            placeholder="e.g. 10"
            aria-invalid={!!errors.maxDailyHours || undefined}
            {...register("maxDailyHours")}
          />
        </FormField>

        <FormField
          label="Minimum rest between shifts"
          htmlFor="minRestBetweenShifts"
          required
          description="Hours"
          error={errors.minRestBetweenShifts?.message}
        >
          <Input
            id="minRestBetweenShifts"
            type="number"
            min={0}
            step="0.5"
            inputMode="decimal"
            placeholder="e.g. 11"
            aria-invalid={!!errors.minRestBetweenShifts || undefined}
            {...register("minRestBetweenShifts")}
          />
        </FormField>

        <FormField
          label="Maximum weekly hours override"
          htmlFor="maxWeeklyHoursOverride"
          description="Optional — leave empty to use the default"
          error={errors.maxWeeklyHoursOverride?.message}
        >
          <Input
            id="maxWeeklyHoursOverride"
            type="number"
            min={0}
            step="0.5"
            inputMode="decimal"
            placeholder="e.g. 48"
            aria-invalid={!!errors.maxWeeklyHoursOverride || undefined}
            {...register("maxWeeklyHoursOverride")}
          />
        </FormField>
      </div>
    </FormSection>
  )
}
