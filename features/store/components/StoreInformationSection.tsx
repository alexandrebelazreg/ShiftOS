"use client"

import { Controller, useFormContext } from "react-hook-form"

import { ControlledStoreInput } from "@/features/store/components/ControlledStoreInput"
import { FormField } from "@/features/store/components/FormField"
import { FormSection } from "@/features/store/components/FormSection"
import {
  COUNTRY_OPTIONS,
  TIMEZONE_OPTIONS,
  countryLabel,
  timezoneLabel,
} from "@/features/store/lib/constants"
import type { StoreFormValues } from "@/features/store/types/store.types"
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
    formState: { errors },
  } = useFormContext<StoreFormValues>()

  return (
    <FormSection
      id="identite-magasin"
      step={1}
      title="Identité et localisation"
      description="Les informations qui permettent d’identifier le magasin et son heure locale."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          label="Nom du magasin"
          htmlFor="name"
          required
          error={errors.name?.message}
          className="md:col-span-2"
        >
          <ControlledStoreInput
            name="name"
            id="name"
            placeholder="Nom de votre magasin"
            aria-invalid={!!errors.name || undefined}
          />
        </FormField>

        <FormField
          label="Enseigne"
          htmlFor="brand"
          description="Facultatif. Utile si le nom du magasin diffère de celui de l’enseigne."
          className="md:col-span-2"
        >
          <ControlledStoreInput
            name="brand"
            id="brand"
            placeholder="Nom de votre enseigne"
          />
        </FormField>

        <FormField
          label="Adresse"
          htmlFor="address"
          required
          error={errors.address?.message}
          className="md:col-span-2"
        >
          <ControlledStoreInput
            name="address"
            id="address"
            placeholder="123 Rue de la République"
            aria-invalid={!!errors.address || undefined}
          />
        </FormField>

        <FormField
          label="Ville"
          htmlFor="city"
          required
          error={errors.city?.message}
        >
          <ControlledStoreInput
            name="city"
            id="city"
            placeholder="Ville"
            aria-invalid={!!errors.city || undefined}
          />
        </FormField>

        <FormField
          label="Code postal"
          htmlFor="postalCode"
          required
          error={errors.postalCode?.message}
        >
          <ControlledStoreInput
            name="postalCode"
            id="postalCode"
            placeholder="69001"
            aria-invalid={!!errors.postalCode || undefined}
          />
        </FormField>

        <FormField
          label="Pays"
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
                  <SelectValue placeholder="Sélectionner un pays">
                    {field.value ? countryLabel(field.value) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((country) => (
                    <SelectItem key={country.value} value={country.value}>
                      {country.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>

        <FormField
          label="Fuseau horaire"
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
                  <SelectValue placeholder="Sélectionner un fuseau horaire">
                    {field.value ? timezoneLabel(field.value) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((timezone) => (
                    <SelectItem key={timezone.value} value={timezone.value}>
                      {timezone.label}
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
