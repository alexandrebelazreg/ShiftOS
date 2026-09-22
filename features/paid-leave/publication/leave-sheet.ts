import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { nameWithUppercaseFamily } from "@/features/planning/board/model/labels"
import { campaignWeeks } from "@/features/paid-leave/calendar/campaign-weeks"
import {
  activeClosureWeeks,
  paidLeaveTargets,
  preferenceRank,
} from "@/features/paid-leave/domain/campaign"
import type { PaidLeaveCampaign, PaidLeaveWeekId } from "@/features/paid-leave/models/paid-leave-campaign"
import type { SectorDemandConfiguration } from "@/features/sectors"

/**
 * Le tableau des congés tel qu'il part au mur.
 *
 * Un salarié par ligne, une semaine par colonne, groupé PAR RAYON et rangé
 * alphabétiquement dans chaque rayon. C'est la seule organisation qui permette
 * de chercher un nom : sur une feuille où l'ordre est celui de la base, on lit
 * les trente lignes une par une.
 *
 * La couleur du rayon porte le groupe. Sur un mur, c'est elle qui dit d'un coup
 * d'œil « cette moitié de feuille me concerne » — un titre en gras ne le fait
 * pas de loin.
 */

export interface LeaveSheetCell {
  readonly weekId: PaidLeaveWeekId
  readonly granted: boolean
  /**
   * Le magasin ferme cette semaine-là, et tout le monde est absent.
   *
   * À PART de `granted`, et pas fondu dedans. Ce n'est pas la même chose pour
   * celui qui lit la feuille au mur : une case accordée répond à ce qu'il a
   * demandé, une case fermée s'impose à toute la colonne. Les confondre ferait
   * croire à vingt personnes qu'elles ont obtenu la même semaine — et à chacune
   * qu'elle la doit à l'arbitrage.
   */
  readonly closed: boolean
  /** Le rang du vœu servi. `null` sur une semaine posée hors de tout vœu. */
  readonly rank: 1 | 2 | 3 | null
}

export interface LeaveSheetRow {
  readonly employeeId: string
  readonly name: string
  readonly grantedCount: number
  readonly requestedCount: number
  readonly cells: readonly LeaveSheetCell[]
}

export interface LeaveSheetGroup {
  readonly sectorId: string
  readonly sectorName: string
  /** La couleur réglée pour ce rayon, ou `null` s'il n'en déclare pas. */
  readonly color: string | null
  readonly rows: readonly LeaveSheetRow[]
}

export interface LeaveSheetColumn {
  readonly weekId: PaidLeaveWeekId
  readonly weekNumber: number
  readonly rangeLabel: string
}

/** Un bandeau de mois au-dessus des semaines : sans lui, on compte les colonnes. */
export interface LeaveSheetMonthBand {
  readonly label: string
  readonly span: number
}

export interface LeaveSheetVM {
  readonly campaignName: string
  readonly storeName: string
  readonly periodLabel: string
  readonly statusLabel: string
  /** Vrai tant que la campagne n'est pas validée : la feuille le dira. */
  readonly draft: boolean
  readonly months: readonly LeaveSheetMonthBand[]
  readonly columns: readonly LeaveSheetColumn[]
  readonly groups: readonly LeaveSheetGroup[]
  readonly printedAtLabel: string
  /** Le nombre total de semaines accordées, pour le pied de feuille. */
  readonly grantedTotal: number
}

const MONTHS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
]

/** Le rayon des salariés qu'aucun secteur actif ne réclame. */
const UNASSIGNED = "__sans_rayon__"

export function buildLeaveSheet({
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
}): LeaveSheetVM {
  const weeks = campaignWeeks(campaign.year, campaign.period)
  // Les semaines ATTRIBUABLES, pour que « x / y » compare des choses de même
  // nature : une demande dont une semaine tombe sur la fermeture ne peut pas
  // recevoir d'attribution pour celle-là, et la compter ferait lire « 2 / 3 »
  // à quelqu'un qui a tout ce qu'il pouvait avoir.
  const targetOf = paidLeaveTargets(campaign)
  const closed = activeClosureWeeks(campaign)
  const activeSectors = sectors.filter((sector) => sector.status === "active")
  const sectorByName = new Map(activeSectors.map((sector) => [sector.name, sector]))

  const columns: LeaveSheetColumn[] = weeks.map((week) => ({
    weekId: week.id,
    weekNumber: week.weekNumber,
    rangeLabel: week.rangeLabel,
  }))

  // Groupé par rayon, chaque rayon rangé alphabétiquement, et « sans rayon » en
  // dernier — c'est une anomalie de fiche, pas un rayon du magasin.
  const bySector = new Map<string, EmployeeRecord[]>()
  for (const employee of employees.filter((item) => item.status === "active")) {
    const sector = sectorByName.get(employee.sectors?.[0] ?? "")
    const key = sector?.id ?? UNASSIGNED
    bySector.set(key, [...(bySector.get(key) ?? []), employee])
  }

  const ordered = [
    ...activeSectors
      .filter((sector) => bySector.has(sector.id))
      .sort((left, right) => left.name.localeCompare(right.name, "fr-FR")),
    ...(bySector.has(UNASSIGNED)
      ? [{ id: UNASSIGNED, name: "Sans rayon", color: undefined } as SectorDemandConfiguration]
      : []),
  ]

  const groups: LeaveSheetGroup[] = ordered.map((sector) => ({
    sectorId: sector.id,
    sectorName: sector.name,
    color: sector.color ?? null,
    rows: [...(bySector.get(sector.id) ?? [])]
      .sort(byFamilyName)
      .map((employee) => buildRow(campaign, employee, columns, targetOf(employee.id), closed)),
  }))

  return {
    campaignName: campaign.name,
    storeName,
    periodLabel:
      weeks.length > 0
        ? `Semaine ${weeks[0].weekNumber} → semaine ${weeks[weeks.length - 1].weekNumber} · ${weeks.length} semaines`
        : "Aucune semaine",
    statusLabel:
      campaign.status === "validated"
        ? `Validé le ${formatDate(campaign.validatedSnapshot?.validatedAt)}`
        : "Proposition — non validée",
    draft: campaign.status !== "validated",
    months: monthBands(weeks),
    columns,
    groups,
    printedAtLabel,
    grantedTotal: groups.reduce(
      (sum, group) => sum + group.rows.reduce((rows, row) => rows + row.grantedCount, 0),
      0
    ),
  }
}

/**
 * Le tri des noms sur un document imprimé : FAMILLE d'abord.
 *
 * Il se faisait sur le nom MIS EN FORME, qui commence par le prénom
 * (« Luca MARTIN »). La feuille était donc rangée par prénom — exactement ce que
 * son propre commentaire disait de ne pas faire. Sur un mur de trente lignes,
 * on cherche MARTIN, et on le cherchait ligne à ligne.
 *
 * Trié sur les champs BRUTS plutôt que sur la chaîne affichée : découper un nom
 * composé pour en extraire la famille marche jusqu'au premier « de la Tour »,
 * et la fiche porte déjà les deux champs séparément.
 *
 * Le prénom départage : deux MARTIN doivent rester dans le même ordre d'une
 * impression à l'autre.
 */
export function byFamilyName(left: EmployeeRecord, right: EmployeeRecord): number {
  return (
    left.lastName.localeCompare(right.lastName, "fr-FR")
    || left.firstName.localeCompare(right.firstName, "fr-FR")
  )
}

function buildRow(
  campaign: PaidLeaveCampaign,
  employee: EmployeeRecord,
  columns: readonly LeaveSheetColumn[],
  grantable: number,
  closed: ReadonlySet<PaidLeaveWeekId>
): LeaveSheetRow {
  const request = campaign.requests[employee.id]
  const granted = new Set(campaign.grants[employee.id] ?? [])
  return {
    employeeId: employee.id,
    // Nom de famille en capitales, comme sur la feuille du planning : c'est ce
    // que l'œil cherche sur un mur.
    name: nameWithUppercaseFamily(`${employee.firstName} ${employee.lastName}`.trim()),
    grantedCount: granted.size,
    // CE QU'ON POUVAIT LUI ACCORDER, et non ce qu'elle a demandé.
    //
    // « 3 / 5 » se lit comme un échec de l'arbitrage. Si les deux semaines
    // manquantes sont refusées par son SOLDE, l'arbitrage n'y est pour rien et
    // la personne restera « incomplète » à vie sur toutes les feuilles. C'est
    // le même choix que le compte rendu de génération a dû faire, et le billet
    // individuel le refait : trois endroits, une seule définition.
    requestedCount: grantable,
    cells: columns.map((column) => ({
      weekId: column.weekId,
      granted: granted.has(column.weekId),
      closed: closed.has(column.weekId),
      rank: granted.has(column.weekId) && request ? preferenceRank(request, column.weekId) : null,
    })),
  }
}

/**
 * Les mois qui coiffent les semaines, chacun avec sa largeur.
 *
 * Le mois d'une semaine est celui de son JEUDI — la règle ISO — sans quoi une
 * semaine à cheval basculerait selon son lundi et l'on verrait « juillet »
 * au-dessus d'une semaine qui est d'août pour tout le monde.
 */
function monthBands(
  weeks: readonly { readonly start: string }[]
): readonly LeaveSheetMonthBand[] {
  const bands: LeaveSheetMonthBand[] = []
  for (const week of weeks) {
    const [year, month, day] = week.start.split("-").map(Number)
    const thursday = new Date(Date.UTC(year, month - 1, day + 3))
    const label = `${MONTHS[thursday.getUTCMonth()]}`
    const last = bands[bands.length - 1]
    if (last && last.label === label) bands[bands.length - 1] = { label, span: last.span + 1 }
    else bands.push({ label, span: 1 })
  }
  return bands
}

function formatDate(value: string | undefined): string {
  if (!value) return "date inconnue"
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(new Date(value))
}
