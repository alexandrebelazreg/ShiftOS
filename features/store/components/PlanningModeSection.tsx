"use client"

import { Controller, useFormContext, useWatch } from "react-hook-form"

import { FormField } from "@/features/store/components/FormField"
import { FormSection } from "@/features/store/components/FormSection"
import { RadioCards } from "@/features/store/components/RadioCards"
import {
  PLANNING_MODE_OPTIONS,
  TIME_GRANULARITY_OPTIONS,
} from "@/features/store/lib/constants"
import type { StoreFormValues } from "@/features/store/types/store.types"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function PlanningModeSection() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<StoreFormValues>()

  const planningMode = useWatch({ control, name: "planningMode" })

  return (
    <FormSection
      title="Planning mode"
      description="How should ShiftOS build your plannings?"
    >
      <Controller
        control={control}
        name="planningMode"
        render={({ field }) => (
          <RadioCards
            value={field.value}
            onChange={field.onChange}
            options={PLANNING_MODE_OPTIONS}
            invalid={!!errors.planningMode}
          />
        )}
      />

      {planningMode === "dynamic" ? (
        <div className="grid gap-4 rounded-lg border border-dashed border-border p-4 md:grid-cols-3">
          <FormField
            label="Minimum shift duration"
            htmlFor="minShiftDuration"
            required
            description="Minutes"
            error={errors.minShiftDuration?.message}
          >
            <Input
              id="minShiftDuration"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="e.g. 120"
              aria-invalid={!!errors.minShiftDuration || undefined}
              {...register("minShiftDuration")}
            />
          </FormField>

          <FormField
            label="Maximum shift duration"
            htmlFor="maxShiftDuration"
            required
            description="Minutes"
            error={errors.maxShiftDuration?.message}
          >
            <Input
              id="maxShiftDuration"
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="e.g. 480"
              aria-invalid={!!errors.maxShiftDuration || undefined}
              {...register("maxShiftDuration")}
            />
          </FormField>

          <FormField
            label="Time granularity"
            htmlFor="timeGranularity"
            required
            error={errors.timeGranularity?.message}
          >
            <Controller
              control={control}
              name="timeGranularity"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="timeGranularity"
                    className="w-full"
                    aria-invalid={!!errors.timeGranularity || undefined}
                  >
                    <SelectValue placeholder="Select granularity" />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_GRANULARITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
        </div>
      ) : null}
    </FormSection>
  )
}
