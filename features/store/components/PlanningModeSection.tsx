"use client"

import { Controller, useFormContext, useWatch } from "react-hook-form"

import { FormField } from "@/features/store/components/FormField"
import { FormSection } from "@/features/store/components/FormSection"
import { MinutesAsHoursField } from "@/features/store/components/MinutesAsHoursField"
import { RadioCards } from "@/features/store/components/RadioCards"
import {
  PLANNING_MODE_OPTIONS,
  TIME_GRANULARITY_OPTIONS,
  timeGranularityLabel,
} from "@/features/store/lib/constants"
import type { StoreFormValues } from "@/features/store/types/store.types"
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
    formState: { errors },
  } = useFormContext<StoreFormValues>()

  const planningMode = useWatch({ control, name: "planningMode" })

  return (
    <FormSection
      id="creation-planning"
      step={3}
      title="Création du planning"
      description="Choisissez comment les services sont créés. Ce choix est partagé par la configuration initiale et les modifications futures."
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
            className="md:grid-cols-2"
          />
        )}
      />

      {planningMode === "dynamic" ? (
        <div className="grid gap-4 rounded-lg border border-dashed border-border bg-muted/20 p-4 md:grid-cols-2">
          <MinutesAsHoursField
            name="minShiftDuration"
            label="Durée minimale d’un service généré"
            description="Une plage plus courte ne sera pas créée automatiquement."
            required
          />
          <FormField
            label="Précision des horaires"
            htmlFor="timeGranularity"
            required
            description="Pas utilisé pour positionner le début et la fin des services."
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
                    <SelectValue placeholder="Sélectionner une précision">
                      {field.value ? timeGranularityLabel(field.value) : null}
                    </SelectValue>
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
