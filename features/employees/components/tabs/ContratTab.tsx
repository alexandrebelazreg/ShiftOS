"use client"

import { Controller, useFormContext } from "react-hook-form"

import { ArrangementSection } from "@/features/employees/components/ArrangementSection"
import { FormRow } from "@/features/employees/components/FormRow"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"
import { CONTRACT_TYPE_OPTIONS } from "@/features/employees/utils/employee.labels"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function ContratTab() {
  const {
    control,
    register,
    watch,
    formState: { errors },
  } = useFormContext<EmployeeFormValues>()

  const student = watch("student")
  const forfaitJour = watch("forfaitJour")
  const scheduleType = watch("scheduleType")

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <FormRow
          label="Heures"
          htmlFor="weeklyHours"
          required
          description="Heures entières par semaine"
          error={errors.weeklyHours?.message}
        >
          <Input
            id="weeklyHours"
            type="text"
            inputMode="numeric"
            placeholder="36"
            aria-invalid={!!errors.weeklyHours || undefined}
            {...register("weeklyHours")}
          />
        </FormRow>

        <FormRow label="Minutes" htmlFor="weeklyMinuteRemainder" required description="0, 15, 30 ou 45" error={errors.weeklyMinuteRemainder?.message}>
          <Input id="weeklyMinuteRemainder" type="number" min={0} max={45} step={15} aria-invalid={!!errors.weeklyMinuteRemainder || undefined} {...register("weeklyMinuteRemainder")} />
        </FormRow>

        <FormRow
          label="Type de contrat"
          htmlFor="contractType"
          error={errors.contractType?.message}
        >
          <Controller
            control={control}
            name="contractType"
            render={({ field }) => (
              // `items` lets <SelectValue /> render the option label instead of
              // the raw enum value ("full_time").
              <Select
                items={CONTRACT_TYPE_OPTIONS}
                value={field.value}
                onValueChange={field.onChange}
              >
                <SelectTrigger id="contractType" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormRow>
      </div>

      {watch("contractConfirmationRequired") ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm">
          <p className="font-medium">Ancien contrat ambigu : confirmez la durée historique.</p>
          <div className="mt-3 flex gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" value="2190" {...register("legacyContractMinutes")} /> 36 h 30
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" value="2205" {...register("legacyContractMinutes")} /> 36 h 45
            </label>
          </div>
          {errors.legacyContractMinutes?.message ? (
            <p className="mt-2 text-destructive">{errors.legacyContractMinutes.message}</p>
          ) : null}
        </div>
      ) : null}

      <FormRow label="Type d’horaire" description="Variable est sélectionné par défaut. Le mode fixe classe l’employé sans modifier son contrat, et décide de son traitement les jours fériés.">
        <Controller
          control={control}
          name="scheduleType"
          render={({ field }) => (
            <div className="flex flex-wrap gap-3">
              {(["variable", "fixed"] as const).map((value) => (
                <label key={value} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name={field.name}
                    value={value}
                    checked={field.value === value}
                    onChange={() => field.onChange(value)}
                  />
                  Horaire {value === "variable" ? "variable" : "fixe"}
                </label>
              ))}
            </div>
          )}
        />
      </FormRow>

      {/* Deux statuts qui ne changent que les jours fériés — d'où leur place
          juste sous le type d'horaire, dont ils sont la suite. */}
      <FormRow label="Statuts particuliers" description="Ils ne modifient que le traitement des jours fériés.">
        <div className="space-y-2">
          <Controller
            control={control}
            name="student"
            render={({ field }) => (
              <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name={field.name}
                  checked={field.value === true}
                  onChange={(event) => field.onChange(event.target.checked)}
                />
                Étudiant
              </label>
            )}
          />
          <Controller
            control={control}
            name="forfaitJour"
            render={({ field }) => (
              <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name={field.name}
                  checked={field.value === true}
                  onChange={(event) => field.onChange(event.target.checked)}
                />
                Cadre au forfait jour
              </label>
            )}
          />
          {/* La conséquence est ÉCRITE plutôt que la case grisée : un étudiant
              laissé en variable est un planning faux que rien ne signale. */}
          {student && scheduleType !== "fixed" ? (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              Un étudiant est traité en <strong>horaires fixes</strong> les jours fériés, quel que
              soit le choix ci-dessus : ses plages habituelles deviennent des heures fériées.
            </p>
          ) : null}
          {forfaitJour ? (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              Un cadre au forfait jour ne compte pas d’heures : les jours fériés, il est en
              <strong> JF</strong> ou <strong>PJ</strong>, jamais en heures fériées.
            </p>
          ) : null}
        </div>
      </FormRow>

      <ArrangementSection />

      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Les jours travaillés sont automatiquement déduits des repos fixes.</p>
    </div>
  )
}
