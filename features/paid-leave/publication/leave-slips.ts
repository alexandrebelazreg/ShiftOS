import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { nameWithUppercaseFamily } from "@/features/planning/board/model/labels"
import {
  campaignWeeks,
  weekFromId,
} from "@/features/paid-leave/calendar/campaign-weeks"
import {
  activeClosureWeeks,
  attributableWeekIds,
  effectiveRequestedWeeks,
  paidLeaveTargets,
  preferenceRank,
} from "@/features/paid-leave/domain/campaign"
import { readPaidLeaveLegally } from "@/features/paid-leave/domain/legal-leave"
import { byFamilyName } from "@/features/paid-leave/publication/leave-sheet"
import type {
  PaidLeaveCampaign,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * LE BILLET INDIVIDUEL : ce que la feuille au mur ne dit à personne.
 *
 * La feuille A3 dit CE QUI a été décidé — vingt-six colonnes, une ligne par
 * personne. Elle ne dit à personne POURQUOI, et c'est la seule question que se
 * pose celui qui y cherche son nom et n'y trouve pas ses semaines d'août.
 *
 * Le verdict existe pourtant depuis le premier jour : `compromises` porte une
 * phrase par personne, enregistrée avec le calcul. Elle n'avait simplement
 * aucun support pour sortir de l'écran du gérant.
 *
 * CE QUI VA SUR LE BILLET, ET CE QUI N'Y VA PAS — la ligne est délibérée.
 *
 * Y va ce qui INFORME ou PROFITE au salarié : ses semaines, ce qu'il avait
 * demandé, le rang obtenu et la raison, les jours de fractionnement que son
 * congé lui ouvre, et ce qu'il lui restera à poser. Le fractionnement surtout :
 * c'est un droit, et le taire reviendrait à le garder pour soi.
 *
 * N'y va PAS le congé principal fragmenté (L3141-19). C'est un reproche adressé
 * au gérant, pas une information pour le salarié : le compte rendu de génération
 * le lui dit déjà, et c'est à lui de le corriger ou de le justifier. Imprimer
 * « votre congé est irrégulier » sur un billet qu'il distribue lui-même
 * reviendrait à lui faire annoncer sa propre infraction.
 *
 * UNE PERSONNE NON SERVIE REÇOIT UN BILLET, si elle avait demandé quelque chose.
 * C'est dur à tendre, et c'est exactement pour cela qu'il faut le faire : le
 * silence est pire, et la phrase du verdict dit au moins pourquoi. Celle qui
 * n'avait rien demandé n'en reçoit pas — il n'y aurait rien à lui apprendre.
 */

export interface PaidLeaveSlipWeek {
  readonly weekId: PaidLeaveWeekId
  /** « S30 · 20 juil – 26 juil », lisible sans compter les semaines. */
  readonly label: string
  /** Le magasin ferme : la personne est en congé sans l'avoir demandé. */
  readonly closed: boolean
  /** Le rang du vœu servi. `null` hors de tout vœu, ou sur une fermeture. */
  readonly rank: 1 | 2 | 3 | null
}

export interface PaidLeaveSlip {
  readonly employeeId: string
  readonly name: string
  readonly sectorName: string | null
  /** Tout ce que la personne pose : attributions ET fermeture, dans l'ordre. */
  readonly weeks: readonly PaidLeaveSlipWeek[]
  /** Les semaines décidées par l'arbitrage, fermeture exclue. */
  readonly grantedCount: number
  /**
   * Ce qu'on POUVAIT lui accorder — demande, vœux servables, solde, fermeture.
   *
   * C'est le dénominateur qu'il faut lui montrer. « 3 sur 5 » se lit comme un
   * échec de l'arbitrage ; si les deux semaines manquantes sont refusées par son
   * solde, l'arbitrage n'y est pour rien.
   */
  readonly grantableCount: number
  /** Ce qu'elle avait demandé. Dit à part, et seulement s'il dépasse le reste. */
  readonly requestedCount: number
  /** Le verdict enregistré avec le calcul. `null` sans calcul, ou après retouche. */
  readonly message: string | null
  /** Les jours ouvrables que ce congé lui ouvre (L3141-23). Zéro le plus souvent. */
  readonly fractionationDays: number
  /** Ce qu'il lui restera à poser. `null` quand le solde n'est pas saisi. */
  readonly remainingWeeks: number | null
}

export interface LeaveSlipsVM {
  readonly campaignName: string
  readonly storeName: string
  readonly periodLabel: string
  readonly statusLabel: string
  /** Une proposition doit se voir comme telle, même sur un billet individuel. */
  readonly draft: boolean
  readonly printedAtLabel: string
  readonly slips: readonly PaidLeaveSlip[]
}

export function buildLeaveSlips({
  campaign,
  employees,
  sectors,
  storeName,
  printedAtLabel,
}: {
  readonly campaign: PaidLeaveCampaign
  readonly employees: readonly EmployeeRecord[]
  readonly sectors: readonly SectorDemandConfiguration[]
  readonly storeName: string
  readonly printedAtLabel: string
}): LeaveSlipsVM {
  const weeks = campaignWeeks(campaign.year, campaign.period)
  const order = weeks.map((week) => week.id)
  const attribuables = attributableWeekIds(campaign)
  const closed = activeClosureWeeks(campaign)
  const targetOf = paidLeaveTargets(campaign)
  const activeSectors = sectors.filter((sector) => sector.status === "active")
  const sectorByName = new Map(activeSectors.map((sector) => [sector.name, sector]))
  const verdicts = new Map(
    (campaign.solution?.compromises ?? []).map((entry) => [entry.employeeId, entry.message])
  )

  const slips = employees
    .filter((employee) => employee.status === "active")
    // Le même tri que la feuille au mur, et par la même fonction : on distribue
    // des billets dans l'ordre où on lit la feuille.
    .sort(byFamilyName)
    .map((employee) => {
      const request = campaign.requests[employee.id]
      const granted = new Set(campaign.grants[employee.id] ?? [])
      const legal = readPaidLeaveLegally(campaign, employee.id)

      const slipWeeks = order
        .filter((weekId) => granted.has(weekId) || closed.has(weekId))
        .map((weekId) => {
          const week = weekFromId(weekId)
          return {
            weekId,
            label: `${week.shortLabel} · ${week.rangeLabel}`,
            closed: closed.has(weekId),
            // Une semaine de fermeture ne porte pas de rang : personne ne l'a
            // demandée, et lui en donner un ferait croire à un arbitrage.
            rank: closed.has(weekId) || !request ? null : preferenceRank(request, weekId),
          }
        })

      const solde = campaign.employeeSettings?.[employee.id]?.entitlementWeeks
      return {
        employeeId: employee.id,
        name: nameWithUppercaseFamily(`${employee.firstName} ${employee.lastName}`.trim()),
        sectorName: sectorByName.get(employee.sectors?.[0] ?? "")?.name ?? null,
        weeks: slipWeeks,
        grantedCount: granted.size,
        grantableCount: targetOf(employee.id),
        requestedCount: effectiveRequestedWeeks(request, attribuables),
        message: verdicts.get(employee.id) ?? null,
        fractionationDays: legal.fractionationDays,
        // Ce qui reste APRÈS tout ce que cette campagne pose, fermeture
        // comprise : c'est le nombre que la personne veut connaître pour
        // décider de sa fin d'année.
        remainingWeeks:
          solde === null || solde === undefined
            ? null
            : Math.max(0, Math.floor(solde) - slipWeeks.length),
      }
    })
    // Ni semaine ni demande : il n'y aurait rien à lui apprendre. Mais une
    // personne qui a demandé et n'a rien obtenu reçoit bien son billet.
    .filter((slip) => slip.weeks.length > 0 || slip.requestedCount > 0)

  return {
    campaignName: campaign.name,
    storeName,
    periodLabel:
      weeks.length > 0
        ? `Semaine ${weeks[0].weekNumber} → semaine ${weeks[weeks.length - 1].weekNumber}`
        : "Aucune semaine",
    statusLabel:
      campaign.status === "validated"
        ? `Validé le ${formatDate(campaign.validatedSnapshot?.validatedAt)}`
        : "Proposition — non validée",
    draft: campaign.status !== "validated",
    printedAtLabel,
    slips,
  }
}

/**
 * « Vous en aviez demandé plus que votre solde ne permettait », dit sans détour.
 *
 * `null` dans le cas normal, où la demande tient dans le solde : une phrase qui
 * apparaît toujours cesse d'être lue. Elle ne sort que quand elle explique un
 * écart que la personne verrait sinon comme un refus.
 */
export function describeShortBalance(slip: PaidLeaveSlip): string | null {
  if (slip.requestedCount <= slip.grantableCount) return null
  return `Vous aviez demandé ${slip.requestedCount} semaines : votre solde et la période `
    + `n’en permettaient que ${slip.grantableCount}.`
}

/** Le solde restant, dit pour la personne qui le lit. */
export function describeRemaining(slip: PaidLeaveSlip): string | null {
  if (slip.remainingWeeks === null) return null
  return slip.remainingWeeks === 0
    ? "Il ne vous restera aucune semaine à poser après cette période."
    : `Il vous restera ${slip.remainingWeeks} semaine${slip.remainingWeeks > 1 ? "s" : ""} à poser après cette période.`
}

/**
 * Les jours de fractionnement, dits comme un DROIT et non comme un calcul.
 *
 * La renonciation est mentionnée parce qu'elle existe et qu'elle se fait par
 * écrit : ne dire que le droit laisserait croire qu'il est automatique, ne dire
 * que la renonciation reviendrait à la suggérer.
 */
export function describeFractionation(slip: PaidLeaveSlip): string | null {
  if (slip.fractionationDays <= 0) return null
  const jours = slip.fractionationDays
  return `Une partie de votre congé principal tombe hors du 1er mai – 31 octobre : `
    + `cela vous ouvre droit à ${jours} jour${jours > 1 ? "s" : ""} ouvrable${jours > 1 ? "s" : ""} `
    + `de fractionnement, auxquels vous pouvez renoncer par écrit.`
}

function formatDate(value: string | undefined): string {
  return value
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(value))
    : "date inconnue"
}
