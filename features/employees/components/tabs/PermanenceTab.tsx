"use client"

import { Controller, useFormContext, useWatch } from "react-hook-form"

import { DayToggleGroup } from "@/features/employees/components/DayToggleGroup"
import { FormRow } from "@/features/employees/components/FormRow"
import { SwitchField } from "@/features/employees/components/SwitchField"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"

/**
 * Le tour de permanence, vu depuis la fiche : y participe-t-il, et à quelles
 * conditions ?
 *
 * Un onglet à lui seul, et non une section des contraintes, parce qu'il ne
 * parle pas du même métier. Les contraintes disent ce que quelqu'un fait dans
 * SON rayon ; la permanence dit qui porte les clés du MAGASIN. Les deux se
 * règlent pour des raisons différentes, par des personnes qui ne pensent pas à
 * la même chose au même moment.
 *
 * Les jours ne s'affichent qu'une fois la participation cochée : proposer de
 * choisir des jours de fermeture à quelqu'un qui ne fera jamais de permanence,
 * c'est faire saisir un réglage sans effet.
 */
export function PermanenceTab() {
  const { control } = useFormContext<EmployeeFormValues>()
  const permanence = useWatch({ control, name: "permanence" })

  return (
    <div className="grid gap-4">
      <SwitchField
        name="permanence"
        label="Participe aux permanences"
        description="Il pourra être retenu pour ouvrir ou fermer le magasin dans le tour mensuel."
      />

      {permanence ? (
        <>
          {/* La distinction se lit une fois, en haut, plutôt que d'être répétée
              sous chacun des quatre sélecteurs — c'est la même phrase, et elle
              vaut pour l'ouverture comme pour la fermeture. */}
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Un jour <strong>imposé</strong> lui est attribué systématiquement. Un jour{" "}
            <strong>préféré</strong> ne fait que le départager : à charge égale, il l’obtient
            avant les autres, mais l’équilibre du tour passe devant.
          </p>

          <div className="grid gap-2">
            <p className="text-sm font-medium">Ouverture du magasin</p>
            <FormRow
              label="Jours imposés"
              description="Ces jours-là, c’est lui qui ouvre."
            >
              <Controller
                control={control}
                name="permanenceRequiredOpeningDays"
                render={({ field }) => (
                  <DayToggleGroup
                    value={field.value}
                    onChange={field.onChange}
                    ariaLabel="Jours d’ouverture imposés en permanence"
                  />
                )}
              />
            </FormRow>
            <FormRow label="Jours préférés" description="À charge égale, il les obtient en premier.">
              <Controller
                control={control}
                name="permanencePreferredOpeningDays"
                render={({ field }) => (
                  <DayToggleGroup
                    value={field.value}
                    onChange={field.onChange}
                    ariaLabel="Jours d’ouverture préférés en permanence"
                  />
                )}
              />
            </FormRow>
          </div>

          <div className="grid gap-2">
            <p className="text-sm font-medium">Fermeture du magasin</p>
            <FormRow label="Jours imposés" description="Ces jours-là, c’est lui qui ferme.">
              <Controller
                control={control}
                name="permanenceRequiredClosingDays"
                render={({ field }) => (
                  <DayToggleGroup
                    value={field.value}
                    onChange={field.onChange}
                    ariaLabel="Jours de fermeture imposés en permanence"
                  />
                )}
              />
            </FormRow>
            <FormRow label="Jours préférés" description="À charge égale, il les obtient en premier.">
              <Controller
                control={control}
                name="permanencePreferredClosingDays"
                render={({ field }) => (
                  <DayToggleGroup
                    value={field.value}
                    onChange={field.onChange}
                    ariaLabel="Jours de fermeture préférés en permanence"
                  />
                )}
              />
            </FormRow>
          </div>
        </>
      ) : null}
    </div>
  )
}
