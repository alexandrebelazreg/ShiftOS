"use client"

import { Controller, useFormContext, useWatch } from "react-hook-form"

import { DayToggleGroup } from "@/features/employees/components/DayToggleGroup"
import { FormRow } from "@/features/employees/components/FormRow"
import { SwitchField } from "@/features/employees/components/SwitchField"
import {
  CONTRACT_ARRANGEMENT_LABELS,
  CONTRACT_ARRANGEMENT_REASONS,
} from "@/features/employees/models/contract-arrangement"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"
import { Input } from "@/components/ui/input"

/**
 * L'aménagement temporaire, dans l'onglet Contrat et non dans un onglet à lui.
 *
 * Parce que c'est LE contrat, pour quelques mois. Le mettre ailleurs aurait
 * séparé les deux nombres qu'on veut lire ensemble — trente-cinq heures au
 * contrat, dix-sept pendant l'arrêt — et fait croire à un réglage de plus
 * plutôt qu'à une parenthèse dans celui d'au-dessus.
 *
 * Ce n'est pas une absence : il est là, autrement. Le saisir dans les absences
 * aurait demandé vingt-six journées pour trois mois, et fait croire au planning
 * qu'il manque quelqu'un les jours où il est justement présent.
 */
export function ArrangementSection() {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<EmployeeFormValues>()

  const active = useWatch({ control, name: "arrangementActive" })

  return (
    <div className="grid gap-4">
      <SwitchField
        name="arrangementActive"
        label="Aménagement temporaire du contrat"
        description="Mi-temps thérapeutique et semblables : il travaille, moins, pour une durée décidée ailleurs."
      />

      {active ? (
        <div className="grid gap-4 rounded-lg border p-3">
          <FormRow label="Motif" htmlFor="arrangementReason">
            <select
              id="arrangementReason"
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm sm:w-72"
              {...register("arrangementReason")}
            >
              {CONTRACT_ARRANGEMENT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {CONTRACT_ARRANGEMENT_LABELS[reason]}
                </option>
              ))}
            </select>
          </FormRow>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow label="Du" htmlFor="arrangementStart" error={errors.arrangementStart?.message}>
              <Input id="arrangementStart" type="date" {...register("arrangementStart")} />
            </FormRow>

            {/* La date que porte la prescription. Un renouvellement se saisit
                le jour où il arrive, en revenant repousser cette date : une fin
                ouverte, elle, ne se serait jamais refermée d'elle-même. */}
            <FormRow
              label="Au"
              htmlFor="arrangementEnd"
              error={errors.arrangementEnd?.message}
              description="À repousser ici si la prescription est renouvelée."
            >
              <Input id="arrangementEnd" type="date" {...register("arrangementEnd")} />
            </FormRow>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow
              label="Heures pendant la période"
              htmlFor="arrangementHours"
              description="Ce que son contrat vaut le temps de l’aménagement."
              error={errors.arrangementHours?.message}
            >
              <div className="flex items-center gap-2">
                <Input
                  id="arrangementHours"
                  type="text"
                  inputMode="numeric"
                  placeholder="17"
                  className="w-20"
                  {...register("arrangementHours")}
                />
                <span className="text-sm text-muted-foreground">h</span>
                <Input
                  id="arrangementMinuteRemainder"
                  type="number"
                  min={0}
                  max={45}
                  step={15}
                  className="w-20"
                  aria-label="Minutes de l’aménagement"
                  {...register("arrangementMinuteRemainder")}
                />
              </div>
            </FormRow>

            <FormRow
              label="Jours non travaillés en plus"
              description="Ils s’ajoutent à ses repos fixes, le temps de la période."
            >
              <Controller
                control={control}
                name="arrangementDaysOff"
                render={({ field }) => (
                  <DayToggleGroup
                    value={field.value}
                    onChange={field.onChange}
                    ariaLabel="Jours non travaillés pendant l’aménagement"
                  />
                )}
              />
            </FormRow>
          </div>

          <FormRow label="Note" htmlFor="arrangementNote" description="Facultative.">
            <Input id="arrangementNote" type="text" {...register("arrangementNote")} />
          </FormRow>

          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Le planning applique l’aménagement en vigueur le <strong>premier jour</strong> de la
            semaine générée : une semaine se pose d’un bloc, et un aménagement qui s’achève un
            mercredi laisse sa semaine entière réduite.
          </p>
        </div>
      ) : null}
    </div>
  )
}
