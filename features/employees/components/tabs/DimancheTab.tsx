"use client"

import { Controller, useFormContext, useWatch } from "react-hook-form"

import { FormRow } from "@/features/employees/components/FormRow"
import { SwitchField } from "@/features/employees/components/SwitchField"
import {
  SUNDAYS_PER_MONTH,
  type EmployeeFormValues,
} from "@/features/employees/types/employee.types"
import {
  SUNDAY_COMMITMENT_OPTIONS,
  SUNDAY_COMPENSATION_OPTIONS,
} from "@/features/employees/utils/employee.labels"

/**
 * Le dimanche, vu depuis la fiche : y va-t-il, jusqu'où, et que reçoit-il en
 * échange ?
 *
 * Un onglet à lui seul plutôt qu'une ligne des contraintes, parce qu'un
 * dimanche ne se règle pas comme un autre jour. Les repos fixes se cochent d'un
 * oui ou d'un non ; le dimanche demande un accord, une limite et une
 * contrepartie — trois questions que personne ne se pose au moment où il
 * remplit les jours de la semaine.
 *
 * Tout se cache tant que la première case n'est pas cochée : régler un plafond
 * pour quelqu'un qui n'ira jamais le dimanche, c'est saisir un réglage sans
 * effet.
 */
export function DimancheTab() {
  const {
    control,
    formState: { errors },
  } = useFormContext<EmployeeFormValues>()
  const [sundayWork, sundayCommitment, fixedDaysOff, forbiddenDays] = useWatch({
    control,
    name: ["sundayWork", "sundayCommitment", "fixedDaysOff", "forbiddenDays"],
  })

  const restsOnSunday =
    fixedDaysOff.includes("sunday") || forbiddenDays.includes("sunday")

  return (
    <div className="grid gap-4">
      <SwitchField
        name="sundayWork"
        label="Travaille le dimanche"
        description="Sans cette case, il ne sera jamais appelé un dimanche."
      />

      {sundayWork ? (
        <>
          {/* Le dimanche laissé en repos fixe est l'USAGE de la maison, pas une
              contradiction : c'est l'accord donné ici qui autorise à appeler, le
              repos de l'onglet Contraintes disant seulement qu'on n'y touche pas
              d'office. Écrit noir sur blanc, parce que les deux réglages vivent
              sur deux onglets et se lisent l'un sans l'autre. */}
          {restsOnSunday ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Le dimanche reste l’un de ses jours de repos, dans l’onglet Contraintes.
              C’est l’usage, et il n’y a rien à corriger.{" "}
              {sundayCommitment === "fixed" ? (
                <>
                  Mais il est ici de <strong>tous les dimanches</strong> : ces deux réglages ne
                  disent pas la même chose, retirez le dimanche de ses repos.
                </>
              ) : (
                <>Son accord suffit à l’appeler, dans la limite fixée ci-dessous.</>
              )}
            </p>
          ) : null}

          <FormRow label="Nature de l’engagement">
            <Controller
              control={control}
              name="sundayCommitment"
              render={({ field }) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  {SUNDAY_COMMITMENT_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                      <input
                        type="radio"
                        className="mt-1"
                        name={field.name}
                        value={option.value}
                        checked={field.value === option.value}
                        onChange={() => field.onChange(option.value)}
                      />
                      <span>
                        <span className="font-medium">{option.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            />
          </FormRow>

          {/* Rien à plafonner chez qui les fait tous : le champ disparaît plutôt
              que d'afficher un nombre que le planning ne lira jamais. */}
          {sundayCommitment === "volunteer" ? (
            <FormRow
              label="Dimanches par mois, au maximum"
              description="Une limite, jamais un objectif : il peut n’être appelé aucune fois."
            >
              <Controller
                control={control}
                name="maxSundaysPerMonth"
                render={({ field }) => (
                  <div
                    role="radiogroup"
                    aria-label="Nombre maximum de dimanches par mois"
                    className="flex flex-wrap gap-2"
                  >
                    {SUNDAYS_PER_MONTH.map((choice) => (
                      <label
                        key={choice}
                        className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                      >
                        <input
                          type="radio"
                          name={field.name}
                          value={choice}
                          checked={field.value === choice}
                          onChange={() => field.onChange(choice)}
                        />
                        {choice}
                      </label>
                    ))}
                  </div>
                )}
              />
            </FormRow>
          ) : null}

          <FormRow
            label="Contrepartie"
            required
            description="Un dimanche travaillé se rend toujours d’une de ces trois façons."
            error={errors.sundayCompensation?.message}
          >
            <Controller
              control={control}
              name="sundayCompensation"
              render={({ field }) => (
                <div className="grid gap-2">
                  {SUNDAY_COMPENSATION_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                      <input
                        type="radio"
                        className="mt-1"
                        name={field.name}
                        value={option.value}
                        checked={field.value === option.value}
                        onChange={() => field.onChange(option.value)}
                      />
                      <span>
                        <span className="font-medium">{option.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            />
          </FormRow>
        </>
      ) : null}
    </div>
  )
}
