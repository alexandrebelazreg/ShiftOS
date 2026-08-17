import { renderToStaticMarkup } from "react-dom/server"
import { FormProvider, useForm } from "react-hook-form"
import { describe, expect, it } from "vitest"

import { EmployeeForm } from "@/features/employees/components/EmployeeForm"
import { DimancheTab } from "@/features/employees/components/tabs/DimancheTab"
import type { EmployeeFormValues } from "@/features/employees/types/employee.types"
import { createEmptyEmployeeFormValues } from "@/features/employees/utils/employee.mappers"

/**
 * L'onglet Dimanche, tel qu'il s'affiche.
 *
 * Ce qui est garanti ici n'est pas une esthétique — c'est qu'un onglet grisé
 * porte bien l'attribut qui le grise, et qu'une question sans objet ne soit pas
 * posée. Un schéma peut prouver ce qui s'enregistre, jamais ce qui se voit.
 */

/** Le contexte de formulaire que les onglets attendent, sans le formulaire entier. */
function Harness({
  values,
  children,
}: {
  values?: Partial<EmployeeFormValues>
  children: React.ReactNode
}) {
  const form = useForm<EmployeeFormValues>({
    defaultValues: { ...createEmptyEmployeeFormValues(), ...values },
  })
  return <FormProvider {...form}>{children}</FormProvider>
}

const tab = (values?: Partial<EmployeeFormValues>) =>
  renderToStaticMarkup(
    <Harness values={values}>
      <DimancheTab />
    </Harness>
  )

const form = (sundayOpen: boolean) =>
  renderToStaticMarkup(
    <EmployeeForm employee={null} sundayOpen={sundayOpen} onSubmit={() => {}} onCancel={() => {}} />
  )

/**
 * Le bouton d'onglet lui-même, attributs compris.
 *
 * On lit `aria-disabled` et non `disabled` : Base UI garde le bouton focusable
 * et le neutralise par l'attribut ARIA, que les classes `aria-disabled:*` du
 * composant traduisent en gris. Chercher `disabled` tout court aurait réussi
 * sur `aria-disabled="false"` — un test vert sur un onglet resté cliquable.
 */
const dimancheTrigger = (markup: string) => markup.match(/<button[^>]*>Dimanche</)?.[0] ?? ""

describe("l'onglet Dimanche dans la liste des onglets", () => {
  it("est grisé quand le magasin ferme le dimanche", () => {
    const markup = form(false)
    expect(dimancheTrigger(markup)).toContain('aria-disabled="true"')
    expect(markup).toContain("Le magasin est fermé le dimanche")
  })

  it("est ouvert comme les autres quand le magasin ouvre le dimanche", () => {
    const markup = form(true)
    expect(dimancheTrigger(markup)).toContain('aria-disabled="false"')
    expect(markup).not.toContain("Le magasin est fermé le dimanche")
  })
})

describe("l'onglet Dimanche, une fois ouvert", () => {
  it("ne pose aucune question tant qu'il ne travaille pas le dimanche", () => {
    const markup = tab({ sundayWork: false })
    expect(markup).toContain("Travaille le dimanche")
    expect(markup).not.toContain("Contrepartie")
    expect(markup).not.toContain("Nature de l’engagement")
    expect(markup).not.toContain("au maximum")
  })

  it("demande l’engagement, le plafond et la contrepartie du volontaire", () => {
    const markup = tab({ sundayWork: true, sundayCommitment: "volunteer" })
    expect(markup).toContain("Volontaire")
    expect(markup).toContain("Tous les dimanches")
    expect(markup).toContain("Dimanches par mois, au maximum")
    // Les quatre plafonds, et une limite qui n'oblige à rien.
    expect(markup).toContain("il peut n’être appelé aucune fois")
    for (const choice of ["1", "2", "3", "4"]) {
      expect(markup).toContain(`value="${choice}"`)
    }
    // Les trois contreparties, dont une est obligatoire.
    expect(markup).toContain("Lisser les heures sur la semaine")
    expect(markup).toContain("Repos compensateur en semaine")
    expect(markup).toContain("Heures supplémentaires")
  })

  it("ne demande pas de plafond à qui fait tous les dimanches", () => {
    const markup = tab({ sundayWork: true, sundayCommitment: "fixed" })
    expect(markup).not.toContain("Dimanches par mois, au maximum")
    // La contrepartie, elle, lui est due comme aux autres.
    expect(markup).toContain("Contrepartie")
  })

  it("dit que le dimanche laissé en repos fixe n’a rien de fautif", () => {
    const markup = tab({
      sundayWork: true,
      sundayCommitment: "volunteer",
      fixedDaysOff: ["sunday"],
    })
    expect(markup).toContain("c’est l’usage, et il n’y a rien à corriger")
    expect(markup).toContain("Son accord suffit à l’appeler")
  })

  it("signale en revanche le repos du dimanche à qui les fait tous", () => {
    const markup = tab({
      sundayWork: true,
      sundayCommitment: "fixed",
      fixedDaysOff: ["sunday"],
    })
    expect(markup).toContain("retirez le dimanche de ses repos")
  })
})
