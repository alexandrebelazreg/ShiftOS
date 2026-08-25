"use client"

import { useFormContext, useWatch } from "react-hook-form"

import { ControlledStoreInput } from "@/features/store/components/ControlledStoreInput"
import { FormField } from "@/features/store/components/FormField"
import { FormSection } from "@/features/store/components/FormSection"
import { MinutesAsHoursField } from "@/features/store/components/MinutesAsHoursField"
import type { StoreFormValues } from "@/features/store/types/store.types"

export function GeneralRulesSection() {
  const {
    control,
    formState: { errors },
  } = useFormContext<StoreFormValues>()
  const planningMode = useWatch({ control, name: "planningMode" })

  return (
    <FormSection
      id="limites-travail"
      step={4}
      title="Durées et limites de travail"
      description="Ces limites encadrent toutes les journées proposées par Planiteo."
    >
      <div className="rounded-lg border bg-muted/25 p-4">
        <p className="text-sm font-medium">Deux maximums à ne pas confondre</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sky-950 dark:border-sky-800 dark:bg-sky-950/35 dark:text-sky-100">
            <p className="text-sm font-semibold">Maximum journalier en continu</p>
            <p className="mt-1 text-xs leading-relaxed opacity-80">
              La plus longue plage travaillée sans interruption.
            </p>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100">
            <p className="text-sm font-semibold">Maximum journalier avec coupure</p>
            <p className="mt-1 text-xs leading-relaxed opacity-80">
              Le cumul des plages travaillées ; le temps de coupure n’est pas compté.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <MinutesAsHoursField
          name="maxShiftDuration"
          label="Maximum journalier en continu"
          description={planningMode === "dynamic"
            ? "Obligatoire pour la génération automatique."
            : "Facultatif en mode catalogue de services."}
          required={planningMode === "dynamic"}
          className="rounded-lg border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-900 dark:bg-sky-950/20"
        />

        <FormField
          label="Maximum journalier avec coupure"
          htmlFor="maxDailyHours"
          required
          description="Total des heures réellement travaillées sur la journée."
          error={errors.maxDailyHours?.message}
          className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20"
        >
          <HoursInput
            id="maxDailyHours"
            name="maxDailyHours"
            invalid={!!errors.maxDailyHours}
          />
        </FormField>

        <FormField
          label="Minimum travaillé par jour"
          htmlFor="minDailyHours"
          required
          description="En dessous de cette durée, la journée n’est pas proposée."
          error={errors.minDailyHours?.message}
        >
          <HoursInput
            id="minDailyHours"
            name="minDailyHours"
            invalid={!!errors.minDailyHours}
          />
        </FormField>

        <FormField
          label="Repos minimum entre deux journées"
          htmlFor="minRestBetweenShifts"
          required
          description="Temps entre la fin d’une journée et le début de la suivante."
          error={errors.minRestBetweenShifts?.message}
        >
          <HoursInput
            id="minRestBetweenShifts"
            name="minRestBetweenShifts"
            invalid={!!errors.minRestBetweenShifts}
          />
        </FormField>

        <FormField
          label="Maximum hebdomadaire"
          htmlFor="maxWeeklyHoursOverride"
          description="Facultatif. Laissez vide pour conserver la limite par défaut."
          error={errors.maxWeeklyHoursOverride?.message}
          className="md:col-span-2"
        >
          <HoursInput
            id="maxWeeklyHoursOverride"
            name="maxWeeklyHoursOverride"
            invalid={!!errors.maxWeeklyHoursOverride}
          />
        </FormField>
      </div>
    </FormSection>
  )
}

function HoursInput({
  id,
  name,
  invalid,
}: {
  readonly id: string
  readonly name:
    | "maxDailyHours"
    | "minDailyHours"
    | "minRestBetweenShifts"
    | "maxWeeklyHoursOverride"
  readonly invalid: boolean
}) {
  return (
    <div className="relative">
      <ControlledStoreInput
        name={name}
        id={id}
        type="number"
        min={0}
        step="0.25"
        inputMode="decimal"
        aria-invalid={invalid || undefined}
        className="pr-16"
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
        heures
      </span>
    </div>
  )
}
