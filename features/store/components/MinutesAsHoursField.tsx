"use client"

import { Controller, useFormContext } from "react-hook-form"

import { Input } from "@/components/ui/input"
import { FormField } from "@/features/store/components/FormField"
import {
  hoursToMinutesValue,
  minutesToHoursValue,
} from "@/features/store/lib/duration-form-values"
import type { StoreFormValues } from "@/features/store/types/store.types"

type MinuteFieldName =
  | "minShiftDuration"
  | "maxShiftDuration"
  | "minSplitDuration"
  | "maxSplitDuration"

export function MinutesAsHoursField({
  name,
  label,
  description,
  required,
  className,
}: {
  readonly name: MinuteFieldName
  readonly label: string
  readonly description?: string
  readonly required?: boolean
  readonly className?: string
}) {
  const {
    control,
    formState: { errors },
  } = useFormContext<StoreFormValues>()
  const error = errors[name]?.message

  return (
    <FormField
      label={label}
      htmlFor={name}
      required={required}
      description={description}
      error={error}
      className={className}
    >
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <div className="relative">
            <Input
              id={name}
              type="number"
              min={0}
              step="0.25"
              inputMode="decimal"
              value={minutesToHoursValue(field.value)}
              onChange={(event) => field.onChange(hoursToMinutesValue(event.target.value))}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
              aria-invalid={!!error || undefined}
              className="pr-16"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
              heures
            </span>
          </div>
        )}
      />
    </FormField>
  )
}
