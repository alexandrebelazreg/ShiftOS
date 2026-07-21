"use client"

import { Controller, useFieldArray, useFormContext, useWatch } from "react-hook-form"

import { FormSection } from "@/features/store/components/FormSection"
import { WEEK_DAY_LABELS } from "@/features/store/lib/constants"
import type { StoreFormValues } from "@/features/store/types/store.types"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export function OpeningHoursSection() {
  const { control } = useFormContext<StoreFormValues>()
  const { fields } = useFieldArray({ control, name: "openingHours" })

  return (
    <FormSection
      title="Horaires d’ouverture"
      description="Configurez les horaires de chaque jour de la semaine."
    >
      <div className="divide-y divide-border rounded-lg border border-border">
        {fields.map((field, index) => (
          <DayRow key={field.id} index={index} day={field.day} />
        ))}
      </div>
    </FormSection>
  )
}

/**
 * A single day row. Isolated as a component so it can subscribe to its own
 * `closed` state via `useWatch` without re-rendering the whole section.
 */
function DayRow({
  index,
  day,
}: {
  index: number
  day: StoreFormValues["openingHours"][number]["day"]
}) {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<StoreFormValues>()

  const closed = useWatch({ control, name: `openingHours.${index}.closed` })
  const dayErrors = errors.openingHours?.[index]

  return (
    <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-24 shrink-0 text-sm font-medium">
        {WEEK_DAY_LABELS[day]}
      </span>

      <div className="flex flex-1 flex-wrap items-center gap-3">
        <div className="grid gap-1">
          <Input
            type="time"
            aria-label={`Heure d’ouverture du ${WEEK_DAY_LABELS[day]}`}
            disabled={closed}
            aria-invalid={!!dayErrors?.opensAt || undefined}
            className="w-32"
            {...register(`openingHours.${index}.opensAt`)}
          />
          {dayErrors?.opensAt ? (
            <span className="text-xs font-medium text-destructive">
              {dayErrors.opensAt.message}
            </span>
          ) : null}
        </div>

        <span className="text-sm text-muted-foreground">à</span>

        <div className="grid gap-1">
          <Input
            type="time"
            aria-label={`Heure de fermeture du ${WEEK_DAY_LABELS[day]}`}
            disabled={closed}
            aria-invalid={!!dayErrors?.closesAt || undefined}
            className="w-32"
            {...register(`openingHours.${index}.closesAt`)}
          />
          {dayErrors?.closesAt ? (
            <span className="text-xs font-medium text-destructive">
              {dayErrors.closesAt.message}
            </span>
          ) : null}
        </div>
      </div>

      <Label
        className={cn(
          "flex shrink-0 items-center gap-2 text-sm",
          closed ? "text-foreground" : "text-muted-foreground"
        )}
      >
        <Controller
          control={control}
          name={`openingHours.${index}.closed`}
          render={({ field }) => (
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              aria-label={`${WEEK_DAY_LABELS[day]} fermé`}
            />
          )}
        />
        Fermé
      </Label>
    </div>
  )
}
