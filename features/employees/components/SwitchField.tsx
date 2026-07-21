"use client"

import { Controller, useFormContext, type FieldPath } from "react-hook-form"

import type { EmployeeFormValues } from "@/features/employees/types/employee.types"
import { Switch } from "@/components/ui/switch"

/**
 * Reusable labelled boolean toggle bound to a boolean field of the employee
 * form. Renders a row with title/description on the left and a switch on the
 * right.
 */
export function SwitchField({
  name,
  label,
  description,
}: {
  name: FieldPath<EmployeeFormValues>
  label: string
  description?: string
}) {
  const { control } = useFormContext<EmployeeFormValues>()

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Switch
            checked={Boolean(field.value)}
            onCheckedChange={field.onChange}
            aria-label={label}
          />
        )}
      />
    </div>
  )
}
