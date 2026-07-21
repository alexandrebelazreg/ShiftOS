"use client"

import { Controller, useFormContext } from "react-hook-form"

import { FormRow } from "@/features/employees/components/FormRow"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export function InformationsTab() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<EmployeeFormValues>()

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow
          label="Prénom"
          htmlFor="firstName"
          required
          error={errors.firstName?.message}
        >
          <Input
            id="firstName"
            placeholder="Prénom"
            aria-invalid={!!errors.firstName || undefined}
            {...register("firstName")}
          />
        </FormRow>

        <FormRow
          label="Nom"
          htmlFor="lastName"
          required
          error={errors.lastName?.message}
        >
          <Input
            id="lastName"
            placeholder="Nom"
            aria-invalid={!!errors.lastName || undefined}
            {...register("lastName")}
          />
        </FormRow>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow label="Téléphone" htmlFor="phone" error={errors.phone?.message}>
          <Input
            id="phone"
            type="tel"
            placeholder="Téléphone"
            {...register("phone")}
          />
        </FormRow>

        <FormRow label="E-mail" htmlFor="email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            placeholder="adresse@entreprise.fr"
            aria-invalid={!!errors.email || undefined}
            {...register("email")}
          />
        </FormRow>
      </div>

      <FormRow label="Statut" description="Les employés inactifs sont conservés, jamais supprimés.">
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <Label className="flex w-fit items-center gap-2 text-sm font-normal">
              <Switch
                checked={field.value === "active"}
                onCheckedChange={(checked) =>
                  field.onChange(checked ? "active" : "inactive")
                }
                aria-label="Actif"
              />
              {field.value === "active" ? "Actif" : "Inactif"}
            </Label>
          )}
        />
      </FormRow>
    </div>
  )
}
