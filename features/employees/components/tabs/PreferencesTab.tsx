"use client"

import { useFormContext } from "react-hook-form"

import { FormRow } from "@/features/employees/components/FormRow"
import { SwitchField } from "@/features/employees/components/SwitchField"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"
import { Textarea } from "@/components/ui/textarea"

export function PreferencesTab() {
  const { register } = useFormContext<EmployeeFormValues>()

  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        Toutes les préférences sont facultatives.
      </p>

      <div className="grid gap-2">
        <SwitchField name="preferOpening" label="Préfère les ouvertures" />
        <SwitchField name="preferClosing" label="Préfère les fermetures" />
      </div>

      <FormRow label="Notes" htmlFor="notes">
        <Textarea
          id="notes"
          rows={4}
          placeholder="Toute information complémentaire sur cet employé…"
          {...register("notes")}
        />
      </FormRow>
    </div>
  )
}
