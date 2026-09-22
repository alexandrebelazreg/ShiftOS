import { describe, expect, it } from "vitest"

import { grantableWeekCount } from "@/features/paid-leave/domain/campaign"
import type {
  PaidLeaveRequest,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"

/**
 * Le solde de congés, la borne qui manquait.
 *
 * La cible venait du VŒU, jamais d'un droit : une campagne pouvait accorder cinq
 * semaines à quelqu'un qui n'en avait plus que trois, et la paie le découvrait
 * après. Rien, nulle part, ne vérifiait le solde.
 *
 * Trois bornes désormais, et une seule fonction pour les dire : ce qu'elle a
 * demandé, ce que ses vœux offrent encore, ce qu'il lui reste à poser. Deux
 * façons de calculer « combien peut-il en obtenir » finiraient par diverger, et
 * l'écart ne se verrait qu'à la validation.
 *
 * `null` n'est PAS zéro, et la distinction porte tout le champ : `null` dit
 * « solde inconnu, on ne vérifie rien », zéro dit « plus rien à poser ».
 */

const WEEKS = new Set(
  Array.from({ length: 10 }, (_, index) => `2026-W${28 + index}` as PaidLeaveWeekId)
)

const request = (wish1: string[], wish2: string[] = []): PaidLeaveRequest =>
  ({ employeeId: "alice", wish1, wish2, wish3: [] }) as never

describe("combien on peut réellement accorder", () => {
  const trois = request(["2026-W28", "2026-W29", "2026-W30"])

  it("borne au solde quand il est plus court que la demande", () => {
    expect(grantableWeekCount(trois, WEEKS, 2)).toBe(2)
  })

  it("ne borne rien quand le solde dépasse la demande", () => {
    expect(grantableWeekCount(trois, WEEKS, 5)).toBe(3)
  })

  it("ne vérifie rien quand le solde est inconnu", () => {
    // Le comportement d'avant ce champ, et celui de toute campagne qui n'a pas
    // rempli la case. `undefined` et `null` disent la même chose.
    expect(grantableWeekCount(trois, WEEKS, null)).toBe(3)
    expect(grantableWeekCount(trois, WEEKS, undefined)).toBe(3)
  })

  it("ferme la campagne à qui n’a plus rien à poser", () => {
    // Zéro est une valeur légitime, et distincte de « inconnu ». Les confondre
    // rendrait impossible de dire « cette personne a épuisé ses congés ».
    expect(grantableWeekCount(trois, WEEKS, 0)).toBe(0)
  })

  it("reste borné par les vœux, solde généreux ou non", () => {
    // Le solde AUTORISE, il ne crée pas de demande : on ne peut pas accorder
    // une semaine que personne n'a souhaitée.
    expect(grantableWeekCount(request(["2026-W28"]), WEEKS, 5)).toBe(1)
  })

  it("ignore les semaines hors période, comme les autres bornes", () => {
    expect(grantableWeekCount(request(["2026-W28", "2026-W50"]), WEEKS, 5)).toBe(1)
  })

  it("rend zéro sans demande, quel que soit le solde", () => {
    expect(grantableWeekCount(undefined, WEEKS, 4)).toBe(0)
    expect(grantableWeekCount(request([]), WEEKS, 4)).toBe(0)
  })

  it("arrondit un solde fractionnaire VERS LE BAS", () => {
    // Vingt-deux jours ouvrables font quatre semaines pleines et deux jours :
    // on ne pose pas les deux jours ici, et surtout on n'arrondit pas à cinq.
    expect(grantableWeekCount(request(["2026-W28", "2026-W29", "2026-W30"]), WEEKS, 2.9)).toBe(2)
  })

  it("ne descend jamais sous zéro sur un solde négatif", () => {
    // Un solde négatif n'a pas de sens métier, mais une saisie peut en produire
    // un. Il vaut « rien à poser », jamais une cible négative que la suite du
    // calcul interpréterait n'importe comment.
    expect(grantableWeekCount(trois, WEEKS, -2)).toBe(0)
  })
})
