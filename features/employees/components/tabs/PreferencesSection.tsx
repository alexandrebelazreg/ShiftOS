"use client"

import { Controller, useFormContext, useWatch } from "react-hook-form"

import { CANONICAL_TIME_STEP_MINUTES } from "@/features/core/models"
import { FormRow } from "@/features/employees/components/FormRow"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"
import { preferencesSummary } from "@/features/employees/utils/preferences-summary"
import { CollapsibleSection } from "@/components/ui/collapsible-section"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/** `<input type="time">` steps in SECONDS. */
const TIME_STEP_SECONDS = CANONICAL_TIME_STEP_MINUTES * 60

const FIELDS = [
  "preferOpening",
  "preferClosing",
  "preferredStartSide",
  "preferredStartTime",
  "preferredEndSide",
  "preferredEndTime",
] as const

/**
 * Les souhaits du salarié — jamais des règles.
 *
 * Séparés des « Contraintes avancées » au-dessus parce qu'ils ne se lisent pas
 * pareil : une contrainte, le planning la tient ou refuse la semaine ; un
 * souhait, il s'en approche quand la couverture le permet et l'abandonne sans
 * bruit sinon. Les mélanger ferait croire qu'un « préfère finir avant 17 h »
 * est aussi sûr qu'un « ne finit pas après 17 h ».
 */
export function PreferencesSection() {
  const {
    control,
    setValue,
    formState: { errors },
  } = useFormContext<EmployeeFormValues>()
  const values = useWatch({ control, name: [...FIELDS] })
  const [preferOpening, preferClosing, startSide, startTime, endSide, endTime] = values
  const hasError = FIELDS.some((field) => errors[field] !== undefined)

  // Une seule question, « ouvrir ou fermer ? », sur deux champs historiques.
  // Une fiche ancienne qui aurait les deux cochés se relit comme « ouvrir ».
  const role = preferOpening ? "open" : preferClosing ? "close" : ""

  return (
    <CollapsibleSection
      title="Préférences"
      summary={preferencesSummary({
        preferOpening,
        preferClosing,
        preferredStartSide: startSide,
        preferredStartTime: startTime,
        preferredEndSide: endSide,
        preferredEndTime: endTime,
      })}
      defaultOpen={false}
      revealWhen={hasError}
    >
      <p className="text-xs text-muted-foreground">
        Des souhaits, pas des règles : le planning les suit quand il le peut, sans jamais laisser un
        créneau découvert pour les tenir.
      </p>

      <FormRow label="Préfère">
        <Segmented
          ariaLabel="Préférence d’ouverture ou de fermeture"
          value={role}
          options={[
            { value: "", label: "Indifférent" },
            { value: "open", label: "Ouvrir" },
            { value: "close", label: "Fermer" },
          ]}
          onChange={(next) => {
            setValue("preferOpening", next === "open", { shouldDirty: true })
            setValue("preferClosing", next === "close", { shouldDirty: true })
          }}
        />
      </FormRow>

      <div className="grid gap-4 sm:grid-cols-2">
        <TimePreferenceRow
          label="Préfère commencer"
          sideName="preferredStartSide"
          timeName="preferredStartTime"
          side={startSide}
          error={errors.preferredStartTime?.message ?? errors.preferredStartSide?.message}
        />
        <TimePreferenceRow
          label="Préfère finir"
          sideName="preferredEndSide"
          timeName="preferredEndTime"
          side={endSide}
          error={errors.preferredEndTime?.message ?? errors.preferredEndSide?.message}
        />
      </div>
    </CollapsibleSection>
  )
}

function TimePreferenceRow({
  label,
  sideName,
  timeName,
  side,
  error,
}: {
  label: string
  sideName: "preferredStartSide" | "preferredEndSide"
  timeName: "preferredStartTime" | "preferredEndTime"
  side: EmployeeFormValues["preferredStartSide"]
  error?: string
}) {
  const { control, register, setValue } = useFormContext<EmployeeFormValues>()
  return (
    <FormRow label={label} htmlFor={timeName} error={error}>
      <div className="flex flex-wrap items-center gap-2">
        <Controller
          control={control}
          name={sideName}
          render={({ field }) => (
            <Segmented
              ariaLabel={label}
              value={field.value}
              options={[
                { value: "", label: "Indifférent" },
                { value: "before", label: "Avant" },
                { value: "after", label: "Après" },
              ]}
              onChange={(next) => {
                field.onChange(next)
                // Revenir à « indifférent » efface l'heure : gardée, elle
                // ferait refuser la fiche pour une préférence qu'on vient d'ôter.
                if (next === "") setValue(timeName, "", { shouldDirty: true })
              }}
            />
          )}
        />
        {side !== "" && (
          <Input
            id={timeName}
            type="time"
            step={TIME_STEP_SECONDS}
            className="w-32"
            aria-invalid={!!error || undefined}
            {...register(timeName)}
          />
        )}
      </div>
    </FormRow>
  )
}

/** Le même dessin que `TimeRuleToggle`, à trois positions. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: readonly { readonly value: T; readonly label: string }[]
  onChange: (next: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-input p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
