"use client"

import { Ban } from "lucide-react"
import { useState } from "react"
import { FormProvider } from "react-hook-form"

import { ContraintesTab } from "@/features/employees/components/tabs/ContraintesTab"
import { ContratTab } from "@/features/employees/components/tabs/ContratTab"
import { DimancheTab } from "@/features/employees/components/tabs/DimancheTab"
import { InformationsTab } from "@/features/employees/components/tabs/InformationsTab"
import { AffectationsTab } from "@/features/employees/components/tabs/AffectationsTab"
import { PermanenceTab } from "@/features/employees/components/tabs/PermanenceTab"
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
  { value: "permanence", label: "Permanence" },
  { value: "dimanche", label: "Dimanche" },
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
  student: "contrat",
  forfaitJour: "contrat",
  arrangementStart: "contrat",
  arrangementEnd: "contrat",
  arrangementHours: "contrat",

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

  permanence: "permanence",
  permanenceCanOpen: "permanence",
  permanenceCanClose: "permanence",
  permanencePreferredOpeningDays: "permanence",
  permanenceRequiredOpeningDays: "permanence",
  permanencePreferredClosingDays: "permanence",
  permanenceRequiredClosingDays: "permanence",
  permanenceClosingOnlyDays: "permanence",
  permanenceMaxClosings: "permanence",
  permanenceLastResortOpening: "permanence",
  permanenceLastResortClosing: "permanence",
  permanenceSaturdayTurnOver: "permanence",

  sundayWork: "dimanche",
  sundayCommitment: "dimanche",
  maxSundaysPerMonth: "dimanche",
  sundayCompensation: "dimanche",
}

/**
 * Tabbed employee form shared by the create and edit flows. Emits a validated,
 * coerced draft on submit; persistence is handled by the caller.
 */
export function EmployeeForm({
  employee,
  sundayOpen,
  onSubmit,
  onCancel,
  onDisable,
}: {
  employee: EmployeeRecord | null
  /**
   * Le magasin ouvre-t-il le dimanche ? Lu côté serveur et passé ici, parce que
   * les horaires du magasin vivent dans un cookie que seul le serveur relit.
   */
  sundayOpen: boolean
  onSubmit: (draft: EmployeeDraft) => void | Promise<void>
  onCancel: () => void
  onDisable?: (employee: EmployeeRecord) => void | Promise<void>
}) {
  const form = useEmployeeForm(employee)
  const { isSubmitting, errors } = form.formState
  const [tab, setTab] = useState<TabValue>("informations")
  const [blockedTab, setBlockedTab] = useState<TabValue | null>(null)

  // Un onglet grisé qui porte l'erreur bloquerait l'enregistrement sans laisser
  // aucun moyen de la corriger : le magasin peut fermer le dimanche APRÈS qu'une
  // fiche y a été réglée. Il redevient donc atteignable le temps de la faute —
  // même raison que la section repliée des contraintes, qui s'ouvre d'elle-même.
  //
  // Lu depuis FIELD_TABS et non d'une seconde liste : un champ ajouté à l'onglet
  // sans être ajouté ici serait exactement le champ qu'on ne peut plus corriger.
  const sundayBlocks = Object.keys(errors).some(
    (field) => FIELD_TABS[field] === "dimanche"
  )

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
            {TABS.map((item) => {
              // Grisé plutôt que retiré : un onglet qui disparaît laisse croire
              // que le réglage n'existe pas, quand il n'est qu'hors sujet ici —
              // et il redeviendra saisissable le jour où le magasin ouvrira le
              // dimanche, sans que rien de ce qui est enregistré soit perdu.
              const closed = item.value === "dimanche" && !sundayOpen && !sundayBlocks
              return (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  disabled={closed}
                  aria-label={closed ? "Dimanche — le magasin est fermé ce jour-là" : undefined}
                  title={closed ? "Le magasin est fermé le dimanche" : undefined}
                >
                  {item.label}
                </TabsTrigger>
              )
            })}
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
            <TabsContent value="permanence">
              <PermanenceTab />
            </TabsContent>
            <TabsContent value="dimanche">
              <DimancheTab />
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
