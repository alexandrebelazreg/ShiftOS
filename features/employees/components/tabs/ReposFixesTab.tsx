"use client"

import { Controller, useFormContext } from "react-hook-form"

import { DayToggleGroup } from "@/features/employees/components/DayToggleGroup"
import { FormRow } from "@/features/employees/components/FormRow"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"

export function ReposFixesTab() {
  const { control } = useFormContext<EmployeeFormValues>()
  return <FormRow label="Repos fixes" description="Ces jours ne seront jamais planifiés."><Controller control={control} name="fixedDaysOff" render={({ field }) => <DayToggleGroup value={field.value} onChange={field.onChange} ariaLabel="Repos fixes" />} /></FormRow>
}
