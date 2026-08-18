"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form"

import { FormRow } from "@/features/employees/components/FormRow"
import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { getFullName } from "@/features/employees/utils/employee.format"
import { ABSENCE_MOTIVE_DEFAULTS } from "@/features/absences/models/absence-motive"
import {
  DEFAULT_ABSENCE_RULES,
  resolveMotive,
  type AbsenceRules,
} from "@/features/absences/models/absence-rules"
import {
  absenceFormSchema,
  type AbsenceFormValues,
} from "@/features/absences/schemas/absence.schema"
import type { AbsenceDraft } from "@/features/absences/services/absence.service"
import { DAY_HALF_LABELS } from "@/features/absences/types/absence-record"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * La saisie d'une absence — UN seul formulaire, celui du matin comme celui de
 * la formation prévue dans trois semaines.
 *
 * Les dates arrivent pré-remplies sur aujourd'hui : c'est le geste le plus
 * fréquent, et le seul qui se fasse dans l'urgence. Ce qui n'a pas lieu d'être
 * ne s'affiche pas — les heures n'apparaissent que pour la délégation, la
 * demi-journée que sur une journée unique. Un champ visible et sans effet est
 * un champ qu'on remplit.
 */
export function AbsenceForm({
  employees,
  today,
  rules = DEFAULT_ABSENCE_RULES,
  onSubmit,
  onCancel,
}: {
  readonly employees: readonly EmployeeRecord[]
  readonly today: string
  /** Les règles en vigueur : le papier annoncé doit être celui qu'on réclamera. */
  readonly rules?: AbsenceRules
  readonly onSubmit: (draft: AbsenceDraft) => void | Promise<void>
  readonly onCancel: () => void
}) {
  const form = useForm<AbsenceFormValues>({
    resolver: zodResolver(absenceFormSchema(today)) as unknown as Resolver<AbsenceFormValues>,
    defaultValues: {
      employeeId: employees[0]?.id ?? "",
      type: "sick_leave",
      start: today,
      end: today,
      halfDay: "",
      hours: "",
      note: "",
    },
    mode: "onSubmit",
  })

  const {
    control,
    register,
    formState: { errors, isSubmitting },
  } = form

  // `useWatch` et non `watch` : le second rend le composant inoptimisable par le
  // compilateur React, et c'est `useWatch` qu'emploient tous les autres
  // formulaires du projet.
  const [type, start, end] = useWatch({ control, name: ["type", "start", "end"] })
  const definition = resolveMotive(rules, type)
  const oneDay = end === start

  return (
    <form
      onSubmit={form.handleSubmit((values) => onSubmit(values as unknown as AbsenceDraft))}
      className="grid gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow label="Salarié" htmlFor="employeeId" error={errors.employeeId?.message}>
          <select
            id="employeeId"
            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            {...register("employeeId")}
          >
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {getFullName(employee)}
              </option>
            ))}
          </select>
        </FormRow>

        <FormRow label="Motif" htmlFor="type" error={errors.type?.message}>
          <select
            id="type"
            className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            {...register("type")}
          >
            {ABSENCE_MOTIVE_DEFAULTS.map((motive) => (
              <option key={motive.value} value={motive.value}>
                {motive.label}
              </option>
            ))}
          </select>
        </FormRow>
      </div>

      {/* Le papier attendu est annoncé AVANT la saisie, pas réclamé après : c'est
          au moment où l'on enregistre l'arrêt qu'on peut encore le demander. */}
      {definition.proof ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Justificatif attendu : <strong>{definition.proof.label}</strong>
          {definition.proof.dueDays === null
            ? "."
            : `, sous ${definition.proof.dueDays} jours.`}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormRow label="Du" htmlFor="start" error={errors.start?.message}>
          <Input id="start" type="date" {...register("start")} />
        </FormRow>

        {/* Toujours une date : celle que porte le papier. Une prolongation se
            saisit le jour où elle arrive, depuis le détail de l'absence. */}
        <FormRow
          label="Au"
          htmlFor="end"
          error={errors.end?.message}
          description="Prolongeable ensuite, si un second arrêt arrive."
        >
          <Input id="end" type="date" {...register("end")} />
        </FormRow>
      </div>

      {definition.countedInHours ? (
        <FormRow
          label="Heures prises"
          htmlFor="hours"
          description="Sur la journée indiquée ci-dessus."
          error={errors.hours?.message}
        >
          <Input
            id="hours"
            type="text"
            inputMode="decimal"
            placeholder="2"
            className="w-32"
            {...register("hours")}
          />
        </FormRow>
      ) : oneDay ? (
        <FormRow label="Journée" error={errors.halfDay?.message}>
          <Controller
            control={control}
            name="halfDay"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Journée entière ou demi-journée" className="flex flex-wrap gap-2">
                {([
                  ["", "Journée entière"],
                  ["morning", DAY_HALF_LABELS.morning],
                  ["afternoon", DAY_HALF_LABELS.afternoon],
                ] as const).map(([value, label]) => (
                  <label key={label} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name={field.name}
                      value={value}
                      checked={field.value === value}
                      onChange={() => field.onChange(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          />
        </FormRow>
      ) : null}

      <FormRow
        label={definition.needsDetail ? "Précision" : "Note"}
        htmlFor="note"
        required={definition.needsDetail}
        description={definition.needsDetail ? undefined : "Facultative."}
        error={errors.note?.message}
      >
        <Input id="note" type="text" {...register("note")} />
      </FormRow>

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Annuler
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          Enregistrer l’absence
        </Button>
      </div>
    </form>
  )
}
