"use client"

import { Controller, useFormContext } from "react-hook-form"

import { FormField } from "@/features/store/components/FormField"
import { FormSection } from "@/features/store/components/FormSection"
import {
  COUNTRY_OPTIONS,
  TIMEZONE_OPTIONS,
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

export function StoreInformationSection() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<StoreFormValues>()

  return (
    <FormSection
      title="Store information"
      description="Where is this workplace located?"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label="Store name"
          htmlFor="name"
          required
          error={errors.name?.message}
          className="md:col-span-2"
        >
          <Input
            id="name"
            placeholder="Nom de votre magasin"
            aria-invalid={!!errors.name || undefined}
            {...register("name")}
          />
        </FormField>

        <FormField label="Enseigne" htmlFor="brand" className="md:col-span-2">
          <Input id="brand" placeholder="Nom de votre enseigne" {...register("brand")} />
        </FormField>

        <FormField
          label="Address"
          htmlFor="address"
          required
          error={errors.address?.message}
          className="md:col-span-2"
        >
          <Input
            id="address"
            placeholder="123 Rue de la République"
            aria-invalid={!!errors.address || undefined}
            {...register("address")}
          />
        </FormField>

        <FormField
          label="City"
          htmlFor="city"
          required
          error={errors.city?.message}
        >
          <Input
            id="city"
            placeholder="Ville"
            aria-invalid={!!errors.city || undefined}
            {...register("city")}
          />
        </FormField>

        <FormField
          label="Postal code"
          htmlFor="postalCode"
          required
          error={errors.postalCode?.message}
        >
          <Input
            id="postalCode"
            placeholder="69001"
            aria-invalid={!!errors.postalCode || undefined}
            {...register("postalCode")}
          />
        </FormField>

        <FormField
          label="Country"
          htmlFor="country"
          required
          error={errors.country?.message}
        >
          <Controller
            control={control}
            name="country"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="country"
                  className="w-full"
                  aria-invalid={!!errors.country || undefined}
                >
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((country) => (
                    <SelectItem key={country} value={country}>
                      {country}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>

        <FormField
          label="Timezone"
          htmlFor="timezone"
          required
          error={errors.timezone?.message}
        >
          <Controller
            control={control}
            name="timezone"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id="timezone"
                  className="w-full"
                  aria-invalid={!!errors.timezone || undefined}
                >
                  <SelectValue placeholder="Select a timezone" />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((timezone) => (
                    <SelectItem key={timezone} value={timezone}>
                      {timezone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>
      </div>
    </FormSection>
  )
}
