"use client"

import { Controller, useFormContext, useWatch } from "react-hook-form"

import { DayToggleGroup } from "@/features/employees/components/DayToggleGroup"
import { FormRow } from "@/features/employees/components/FormRow"
import { SwitchField } from "@/features/employees/components/SwitchField"
import { Input } from "@/components/ui/input"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"

/**
 * « En dernier recours », rattaché à son droit.
 *
 * Décalé et bordé : il ne se lit pas comme un troisième réglage de même rang,
 * mais comme une nuance de celui qui le précède — la même chose que dit
 * l'indentation d'une clause dans un contrat.
 */
function LastResortField({
  name,
  negation,
}: {
  readonly name: "permanenceLastResortOpening" | "permanenceLastResortClosing"
  /**
   * La négation conjuguée, écrite en entier — « n’ouvrira », « ne fermera ».
   *
   * Passée toute faite plutôt que composée d'un « ne » et d'un verbe : l'un des
   * deux s'élide et l'autre non, et une phrase montrée au gérant ne se construit
   * pas par concaténation.
   */
  readonly negation: string
}) {
  return (
    <div className="border-l-2 border-border pl-4">
      <SwitchField
        name={name}
        label="En dernier recours"
        description={`Il ${negation} que si personne d’autre n’est disponible ce jour-là. Ses jours imposés, eux, restent tenus.`}
      />
    </div>
  )
}

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
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<EmployeeFormValues>()
  const [permanence, canOpen, canClose] = useWatch({
    control,
    name: ["permanence", "permanenceCanOpen", "permanenceCanClose"],
  })

  return (
    <div className="grid gap-4">
      <SwitchField
        name="permanence"
        label="Participe aux permanences"
        description="Il pourra être retenu pour ouvrir ou fermer le magasin dans le tour mensuel."
      />

      {permanence ? (
        <>
          {/* Les deux droits d'abord : ils décident de ce qui vaut la peine
              d'être réglé en dessous. Distincts de « peut ouvrir / peut fermer »
              des contraintes, qui parlent du RAYON — porter les clés du magasin
              ne s'apprend pas en même temps que lever le rideau d'un comptoir. */}
          <div className="grid gap-2">
            <SwitchField
              name="permanenceCanOpen"
              label="Peut ouvrir le magasin"
              description="Désarmer l’alarme, lever le rideau, lancer la journée."
            />
            {/* Sous le droit, et invisible sans lui : « en dernier recours »
                n'a rien à dire d'un rôle qu'on ne tient pas. Un par rôle, parce
                qu'ouvrir régulièrement et ne fermer qu'au dépannage est la
                situation ordinaire d'un adjoint. */}
            {canOpen ? (
              <LastResortField name="permanenceLastResortOpening" negation="n’ouvrira" />
            ) : null}

            <SwitchField
              name="permanenceCanClose"
              label="Peut fermer le magasin"
              description="Compter la caisse, armer l’alarme, verrouiller."
            />
            {canClose ? (
              <LastResortField name="permanenceLastResortClosing" negation="ne fermera" />
            ) : null}

            {errors.permanenceCanOpen ? (
              <p role="alert" className="text-xs font-medium text-destructive">
                {errors.permanenceCanOpen.message}
              </p>
            ) : null}
          </div>

          {/* La distinction se lit une fois, en haut, plutôt que d'être répétée
              sous chacun des quatre sélecteurs — c'est la même phrase, et elle
              vaut pour l'ouverture comme pour la fermeture. */}
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            Un jour <strong>imposé</strong> lui est attribué systématiquement. Un jour{" "}
            <strong>préféré</strong> ne fait que le départager : à charge égale, il l’obtient
            avant les autres, mais l’équilibre du tour passe devant.
          </p>

          {canOpen ? (
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
          ) : null}

          {canClose ? (
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

            {/* Le libellé doit énoncer les DEUX effets : ce réglage interdit
                les autres jours ET donne ceux-là. N'en dire qu'un fait
                découvrir l'autre sur la feuille du mois. */}
            <FormRow
              label="Fermeture uniquement le"
              description="Ces jours-là, c’est lui qui ferme, et il ne fermera jamais un autre jour. Aucun jour coché : aucune restriction."
              error={errors.permanenceClosingOnlyDays?.message}
            >
              <Controller
                control={control}
                name="permanenceClosingOnlyDays"
                render={({ field }) => (
                  <DayToggleGroup
                    value={field.value}
                    onChange={field.onChange}
                    ariaLabel="Seuls jours de fermeture autorisés en permanence"
                  />
                )}
              />
            </FormRow>

            <FormRow
              label="Maximum de fermetures"
              htmlFor="permanenceMaxClosings"
              description="Par semaine. Laissez vide pour ne poser aucun plafond."
              error={errors.permanenceMaxClosings?.message}
            >
              <Input
                id="permanenceMaxClosings"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="Sans plafond"
                className="w-40"
                aria-invalid={!!errors.permanenceMaxClosings || undefined}
                {...register("permanenceMaxClosings")}
              />
            </FormRow>

            {/* Un GROUPE et non un droit : dès qu'une seule fiche le coche, les
                samedis ne vont plus qu'aux personnes cochées. Le dire ici, où
                la case se coche, évite de découvrir la règle sur la feuille. */}
            <SwitchField
              name="permanenceSaturdayTurnOver"
              label="Turn-over fermeture du samedi"
              description="Les samedis tournent entre les personnes cochées. Si personne ne l’est dans le magasin, tout le monde y passe."
            />
          </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
