"use client"

import { Ban } from "lucide-react"
import { useState } from "react"
import { FormProvider } from "react-hook-form"

import { ContraintesTab } from "@/features/employees/components/tabs/ContraintesTab"
import { ContratTab } from "@/features/employees/components/tabs/ContratTab"
import { InformationsTab } from "@/features/employees/components/tabs/InformationsTab"
import { AffectationsTab } from "@/features/employees/components/tabs/AffectationsTab"
import { useEmployeeForm } from "@/features/employees/hooks/useEmployeeForm"
import type { EmployeeDraft } from "@/features/employees/schemas/employee.schema"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { Button } from "@/components/ui/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

const TABS = [
  { value: "informations", label: "Informations" },
  { value: "contrat", label: "Contrat" },
  { value: "affectations", label: "Affectations" },
  { value: "contraintes", label: "Contraintes" },
] as const

type TabValue = (typeof TABS)[number]["value"]

/** Which tab holds each field, so a rejected submit can reveal the culprit. */
const FIELD_TABS: Record<string, TabValue> = {
  firstName: "informations",
  lastName: "informations",
  phone: "informations",
  email: "informations",
  status: "informations",

  weeklyHours: "contrat",
  weeklyMinuteRemainder: "contrat",
  legacyContractMinutes: "contrat",
  contractType: "contrat",
  scheduleType: "contrat",

  sectors: "affectations",
  competencies: "affectations",

  canOpen: "contraintes",
  canClose: "contraintes",
  splitShiftAllowed: "contraintes",
  fixedDaysOff: "contraintes",
  forbiddenDays: "contraintes",
  maxOpenings: "contraintes",
  maxClosings: "contraintes",
  earliestStartTime: "contraintes",
  latestEndTime: "contraintes",
  startTimeIsExact: "contraintes",
  endTimeIsExact: "contraintes",
  openingDays: "contraintes",
  closingDays: "contraintes",
}

/**
 * Tabbed employee form shared by the create and edit flows. Emits a validated,
 * coerced draft on submit; persistence is handled by the caller.
 */
export function EmployeeForm({
  employee,
  onSubmit,
  onCancel,
  onDisable,
}: {
  employee: EmployeeRecord | null
  onSubmit: (draft: EmployeeDraft) => void | Promise<void>
  onCancel: () => void
  onDisable?: (employee: EmployeeRecord) => void | Promise<void>
}) {
  const form = useEmployeeForm(employee)
  const { isSubmitting } = form.formState
  const [tab, setTab] = useState<TabValue>("informations")
  const [blockedTab, setBlockedTab] = useState<TabValue | null>(null)

  const canDisable = Boolean(employee && employee.status === "active" && onDisable)

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit(
          (values) => {
            setBlockedTab(null)
            return onSubmit(values as unknown as EmployeeDraft)
          },
          (errors) => {
            // Errors can live on a tab the user isn't looking at, which makes
            // "Enregistrer" seem inert — jump to the first offending tab.
            const target = Object.keys(errors)
              .map((field) => FIELD_TABS[field])
              .find(Boolean)
            if (!target) return
            setBlockedTab(target)
            setTab(target)
          }
        )}
        className="flex h-full flex-col"
      >
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as TabValue)}
          className="flex-1 gap-4 overflow-hidden"
        >
          <TabsList className="w-full">
            {TABS.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-y-auto px-1">
            <TabsContent value="informations">
              <InformationsTab />
            </TabsContent>
            <TabsContent value="contrat">
              <ContratTab />
            </TabsContent>
            <TabsContent value="affectations"><AffectationsTab /></TabsContent>
            <TabsContent value="contraintes">
              <ContraintesTab />
            </TabsContent>
          </div>
        </Tabs>

        {blockedTab ? (
          <p role="alert" className="pb-3 text-sm text-destructive">
            Enregistrement impossible : corrigez les champs signalés dans l’onglet «{" "}
            {TABS.find((item) => item.value === blockedTab)?.label} ».
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <div>
            {canDisable && employee ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => onDisable?.(employee)}
                disabled={isSubmitting}
              >
                <Ban />
                Désactiver
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {employee ? "Enregistrer" : "Créer l’employé"}
            </Button>
          </div>
        </div>
      </form>
    </FormProvider>
  )
}
