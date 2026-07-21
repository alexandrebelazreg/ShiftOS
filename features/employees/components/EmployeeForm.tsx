"use client"

import { Ban } from "lucide-react"
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

  const canDisable = Boolean(employee && employee.status === "active" && onDisable)

  return (
    <FormProvider {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          onSubmit(values as unknown as EmployeeDraft)
        )}
        className="flex h-full flex-col"
      >
        <Tabs defaultValue="informations" className="flex-1 gap-4 overflow-hidden">
          <TabsList className="w-full">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
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
