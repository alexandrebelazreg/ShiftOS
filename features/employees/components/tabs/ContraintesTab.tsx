"use client"

import { Controller, useFormContext, useWatch } from "react-hook-form"

import { CANONICAL_TIME_STEP_MINUTES } from "@/features/core/models"
import { DayToggleGroup } from "@/features/employees/components/DayToggleGroup"
import { FormRow } from "@/features/employees/components/FormRow"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"
import { advancedConstraintsSummary, ADVANCED_CONSTRAINTS_OPEN_BY_DEFAULT } from "@/features/employees/utils/advanced-constraints"
import { CollapsibleSection } from "@/components/ui/collapsible-section"
import { Input } from "@/components/ui/input"
import { SwitchField } from "@/features/employees/components/SwitchField"
import { TimeRuleToggle } from "@/features/employees/components/TimeRuleToggle"

/** `<input type="time">` steps in SECONDS. */
const TIME_STEP_SECONDS = CANONICAL_TIME_STEP_MINUTES * 60

/**
 * The fields living inside the fold. Listed once: the summary watches them and
 * the reveal-on-error check reads their errors, and two lists would drift into
 * a field that is summarised but never revealed.
 */
const ADVANCED_FIELDS = [
  "canOpen",
  "canClose",
  "splitShiftAllowed",
  "maxOpenings",
  "maxClosings",
  "earliestStartTime",
  "latestEndTime",
  "startTimeIsExact",
  "endTimeIsExact",
  "openingDays",
  "closingDays",
] as const

export function ContraintesTab() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<EmployeeFormValues>()

  // Watched, not read once: the closed section must summarise what the manager
  // just typed, not what the employee looked like when the drawer opened.
  const advanced = useWatch({ control, name: [...ADVANCED_FIELDS] })
  // Un refus de sauvegarde renvoie sur cet onglet ; si le champ fautif dort
  // dans un repli, le message désigne un écran qui paraît intact.
  const hasAdvancedError = ADVANCED_FIELDS.some((field) => errors[field] !== undefined)

  const canOpen = advanced[0]
  const canClose = advanced[1]
  const startIsExact = advanced[7]
  const endIsExact = advanced[8]

  const summary = advancedConstraintsSummary({
    canOpen,
    canClose,
    splitShiftAllowed: advanced[2],
    maxOpenings: advanced[3],
    maxClosings: advanced[4],
    earliestStartTime: advanced[5],
    latestEndTime: advanced[6],
    startTimeIsExact: startIsExact,
    endTimeIsExact: endIsExact,
    openingDays: advanced[9],
    closingDays: advanced[10],
  })

  return (
    <div className="grid gap-4">
      <FormRow label="Repos fixes" description="Ces jours ne seront jamais planifiés.">
        <Controller
          control={control}
          name="fixedDaysOff"
          render={({ field }) => (
            <DayToggleGroup value={field.value} onChange={field.onChange} ariaLabel="Repos fixes" />
          )}
        />
      </FormRow>

      <CollapsibleSection
        title="Contraintes avancées"
        summary={summary}
        defaultOpen={ADVANCED_CONSTRAINTS_OPEN_BY_DEFAULT}
        revealWhen={hasAdvancedError}
      >
        <div className="grid gap-2">
          <p className="text-sm font-medium">Horaires</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow
              label="Début de journée"
              htmlFor="earliestStartTime"
              description={
                startIsExact
                  ? "Ce salarié commencera à cette heure exacte, tous les jours travaillés."
                  : "Laissez vide sans restriction."
              }
              error={errors.earliestStartTime?.message}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Controller
                  control={control}
                  name="startTimeIsExact"
                  render={({ field }) => (
                    <TimeRuleToggle
                      value={field.value}
                      onChange={field.onChange}
                      looseLabel="Pas avant"
                      exactLabel="Commence à"
                      ariaLabel="Règle de début de journée"
                    />
                  )}
                />
                <Input
                  id="earliestStartTime"
                  type="time"
                  step={TIME_STEP_SECONDS}
                  className="w-32"
                  aria-invalid={!!errors.earliestStartTime || undefined}
                  {...register("earliestStartTime")}
                />
              </div>
            </FormRow>

            <FormRow
              label="Fin de journée"
              htmlFor="latestEndTime"
              description={
                endIsExact
                  ? "Ce salarié finira à cette heure exacte, tous les jours travaillés."
                  : "Laissez vide sans restriction."
              }
              error={errors.latestEndTime?.message}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Controller
                  control={control}
                  name="endTimeIsExact"
                  render={({ field }) => (
                    <TimeRuleToggle
                      value={field.value}
                      onChange={field.onChange}
                      looseLabel="Pas après"
                      exactLabel="Finit à"
                      ariaLabel="Règle de fin de journée"
                    />
                  )}
                />
                <Input
                  id="latestEndTime"
                  type="time"
                  step={TIME_STEP_SECONDS}
                  className="w-32"
                  aria-invalid={!!errors.latestEndTime || undefined}
                  {...register("latestEndTime")}
                />
              </div>
            </FormRow>
          </div>
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium">Ouvertures et fermetures</p>
          <SwitchField name="canOpen" label="Peut ouvrir" />
          <SwitchField name="canClose" label="Peut fermer" />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow
              label="Maximum d’ouvertures par semaine"
              htmlFor="maxOpenings"
              description="Laissez vide pour suivre la limite du secteur."
              error={errors.maxOpenings?.message}
            >
              <Input
                id="maxOpenings"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="Limite du secteur"
                aria-invalid={!!errors.maxOpenings || undefined}
                {...register("maxOpenings")}
              />
            </FormRow>

            <FormRow
              label="Maximum de fermetures par semaine"
              htmlFor="maxClosings"
              description="Laissez vide pour suivre la limite du secteur."
              error={errors.maxClosings?.message}
            >
              <Input
                id="maxClosings"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="Limite du secteur"
                aria-invalid={!!errors.maxClosings || undefined}
                {...register("maxClosings")}
              />
            </FormRow>
          </div>

          {/* Le droit d'ouvrir est au-dessus du devoir : sans lui la ligne
              n'aurait aucun sens, et la montrer inviterait à saisir une règle
              que le solveur ne pourra jamais tenir. */}
          {canOpen && (
            <FormRow
              label="Ouvre toujours le"
              description="Ces jours-là, il prend l’ouverture de son rayon."
              error={errors.openingDays?.message}
            >
              <Controller
                control={control}
                name="openingDays"
                render={({ field }) => (
                  <DayToggleGroup value={field.value} onChange={field.onChange} ariaLabel="Jours d’ouverture imposés" />
                )}
              />
            </FormRow>
          )}

          {canClose && (
            <FormRow
              label="Ferme toujours le"
              description="Ces jours-là, il reste jusqu’à la fermeture de son rayon."
              error={errors.closingDays?.message}
            >
              <Controller
                control={control}
                name="closingDays"
                render={({ field }) => (
                  <DayToggleGroup value={field.value} onChange={field.onChange} ariaLabel="Jours de fermeture imposés" />
                )}
              />
            </FormRow>
          )}
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium">Coupures</p>
          <SwitchField
            name="splitShiftAllowed"
            label="Autorisé à avoir une coupure"
            description="Le secteur doit également autoriser les coupures."
          />
        </div>
      </CollapsibleSection>
    </div>
  )
}
