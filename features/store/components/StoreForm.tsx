"use client"

import { useState, useTransition } from "react"
import { FormProvider, useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { GeneralRulesSection } from "@/features/store/components/GeneralRulesSection"
import { OpeningHoursSection } from "@/features/store/components/OpeningHoursSection"
import { PlanningModeSection } from "@/features/store/components/PlanningModeSection"
import { SplitShiftSection } from "@/features/store/components/SplitShiftSection"
import { StoreInformationSection } from "@/features/store/components/StoreInformationSection"
import { storeFormDefaults } from "@/features/store/lib/store-form-defaults"
import {
  storeSchema,
  type StoreConfig,
} from "@/features/store/schemas/store.schema"
import { saveStoreConfiguration, updateStoreConfiguration } from "@/features/store/services/onboarding.actions"
import type { StoreFormValues } from "@/features/store/types/store.types"
import { Button } from "@/components/ui/button"

export function StoreForm({ initialStore, onSaved }: { initialStore?: StoreConfig; onSaved?: () => void }) {
  const [isPending, startTransition] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const form = useForm<StoreFormValues>({
    // The form holds raw values (numbers as strings); Zod coerces them.
    // The resolver's parsed output is a StoreConfig at runtime, so the cast
    // here only reconciles the input/output type gap of a coercing schema.
    resolver: zodResolver(storeSchema) as unknown as Resolver<StoreFormValues>,
    defaultValues: initialStore ? toFormValues(initialStore) : storeFormDefaults,
    mode: "onSubmit",
  })

  function onSubmit(values: StoreFormValues) {
    const store = values as unknown as StoreConfig
    setSubmitError(null)
    startTransition(async () => {
      // Persist via the server action; on success it redirects to the
      // dashboard. Only failures return here.
      const result = initialStore ? await updateStoreConfiguration(store) : await saveStoreConfiguration(store)
      if (result && !result.ok) {
        setSubmitError(result.error)
      } else if (result?.ok) {
        onSaved?.()
      }
    })
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <StoreInformationSection />
        <OpeningHoursSection />
        <PlanningModeSection />
        <SplitShiftSection />
        <GeneralRulesSection />

        {submitError ? (
          <p className="text-sm font-medium text-destructive">{submitError}</p>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          {initialStore ? <Button type="button" variant="outline" onClick={onSaved}>Annuler</Button> : <Button type="button" variant="outline" disabled>Retour</Button>}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Enregistrement…" : initialStore ? "Enregistrer les modifications" : "Continuer"}
          </Button>
        </div>
      </form>
    </FormProvider>
  )
}

function toFormValues(store: StoreConfig): StoreFormValues {
  return {
    name: store.name, brand: store.brand ?? "", address: store.address, city: store.city, postalCode: store.postalCode, country: store.country, timezone: store.timezone,
    openingHours: store.openingHours.map((day) => ({ ...day })), planningMode: store.planningMode,
    minShiftDuration: store.minShiftDuration === undefined ? "" : String(store.minShiftDuration), maxShiftDuration: store.maxShiftDuration === undefined ? "" : String(store.maxShiftDuration), timeGranularity: store.timeGranularity === undefined ? "" : String(store.timeGranularity),
    splitShiftPolicy: store.splitShiftPolicy, minSplitDuration: store.minSplitDuration === undefined ? "" : String(store.minSplitDuration), maxSplitDuration: store.maxSplitDuration === undefined ? "" : String(store.maxSplitDuration), maxSplitShiftsPerWeek: store.maxSplitShiftsPerWeek === undefined ? "" : String(store.maxSplitShiftsPerWeek),
    minDailyHours: String(store.minDailyHours), maxDailyHours: String(store.maxDailyHours), minRestBetweenShifts: String(store.minRestBetweenShifts), maxWeeklyHoursOverride: store.maxWeeklyHoursOverride === undefined ? "" : String(store.maxWeeklyHoursOverride),
  }
}
