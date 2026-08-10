"use client"

import { Controller, useFormContext, useWatch } from "react-hook-form"

import { ControlledStoreInput } from "@/features/store/components/ControlledStoreInput"
import { FormField } from "@/features/store/components/FormField"
import { FormSection } from "@/features/store/components/FormSection"
import { MinutesAsHoursField } from "@/features/store/components/MinutesAsHoursField"
import { RadioCards } from "@/features/store/components/RadioCards"
import { SPLIT_SHIFT_POLICY_OPTIONS } from "@/features/store/lib/constants"
import type { StoreFormValues } from "@/features/store/types/store.types"
import { SPLIT_SHIFT_DETAIL_POLICIES } from "@/features/core/models"

export function SplitShiftSection() {
  const {
    control,
    formState: { errors },
  } = useFormContext<StoreFormValues>()

  const policy = useWatch({ control, name: "splitShiftPolicy" })
  const showDetails = SPLIT_SHIFT_DETAIL_POLICIES.includes(policy)

  return (
    <FormSection
      id="journees-coupure"
      step={5}
      title="Journées avec coupure"
      description="Une coupure sépare deux plages travaillées dans la même journée. Elle n’est pas comptée comme du temps travaillé."
    >
      <Controller
        control={control}
        name="splitShiftPolicy"
        render={({ field }) => (
          <RadioCards
            value={field.value}
            onChange={field.onChange}
            options={SPLIT_SHIFT_POLICY_OPTIONS}
            invalid={!!errors.splitShiftPolicy}
            className="md:grid-cols-2"
          />
        )}
      />

      {showDetails ? (
        <div className="grid gap-4 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-4 md:grid-cols-3 dark:border-amber-800 dark:bg-amber-950/20">
          <MinutesAsHoursField
            name="minSplitDuration"
            label="Coupure minimale"
            description="Durée minimale entre les deux plages."
            required
          />

          <MinutesAsHoursField
            name="maxSplitDuration"
            label="Coupure maximale"
            description="Au-delà, la journée n’est pas proposée."
            required
          />

          <FormField
            label="Journées avec coupure par semaine"
            htmlFor="maxSplitShiftsPerWeek"
            required
            description="Maximum pour un même employé."
            error={errors.maxSplitShiftsPerWeek?.message}
          >
            <ControlledStoreInput
              name="maxSplitShiftsPerWeek"
              id="maxSplitShiftsPerWeek"
              type="number"
              min={0}
              inputMode="numeric"
              aria-invalid={!!errors.maxSplitShiftsPerWeek || undefined}
            />
          </FormField>
        </div>
      ) : null}
    </FormSection>
  )
}
