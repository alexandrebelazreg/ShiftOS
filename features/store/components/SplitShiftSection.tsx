"use client"

import { Controller, useFormContext, useWatch } from "react-hook-form"

import { FormField } from "@/features/store/components/FormField"
import { FormSection } from "@/features/store/components/FormSection"
import { RadioCards } from "@/features/store/components/RadioCards"
import { SPLIT_SHIFT_POLICY_OPTIONS } from "@/features/store/lib/constants"
import type { StoreFormValues } from "@/features/store/types/store.types"
import { SPLIT_SHIFT_DETAIL_POLICIES } from "@/features/core/models"
import { Input } from "@/components/ui/input"

export function SplitShiftSection() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<StoreFormValues>()

  const policy = useWatch({ control, name: "splitShiftPolicy" })
  const showDetails = SPLIT_SHIFT_DETAIL_POLICIES.includes(policy)

  return (
    <FormSection
      title="Politique de coupure"
      description="Définissez si un employé peut effectuer un service avec coupure sur une journée."
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
          />
        )}
      />

      {showDetails ? (
        <div className="grid gap-4 rounded-lg border border-dashed border-border p-4 md:grid-cols-3">
          <FormField
            label="Durée minimale de coupure"
            htmlFor="minSplitDuration"
            required
            description="Minutes"
            error={errors.minSplitDuration?.message}
          >
            <Input
              id="minSplitDuration"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="ex. 60"
              aria-invalid={!!errors.minSplitDuration || undefined}
              {...register("minSplitDuration")}
            />
          </FormField>

          <FormField
            label="Durée maximale de coupure"
            htmlFor="maxSplitDuration"
            required
            description="Minutes"
            error={errors.maxSplitDuration?.message}
          >
            <Input
              id="maxSplitDuration"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="ex. 240"
              aria-invalid={!!errors.maxSplitDuration || undefined}
              {...register("maxSplitDuration")}
            />
          </FormField>

          <FormField
            label="Maximum de coupures par employé et par semaine"
            htmlFor="maxSplitShiftsPerWeek"
            required
            error={errors.maxSplitShiftsPerWeek?.message}
          >
            <Input
              id="maxSplitShiftsPerWeek"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="ex. 3"
              aria-invalid={!!errors.maxSplitShiftsPerWeek || undefined}
              {...register("maxSplitShiftsPerWeek")}
            />
          </FormField>
        </div>
      ) : null}
    </FormSection>
  )
}
