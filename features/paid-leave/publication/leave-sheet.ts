import type { EmployeeRecord } from "@/features/employees/types/employee.types"
import { nameWithUppercaseFamily } from "@/features/planning/board/model/labels"
import { campaignWeeks } from "@/features/paid-leave/calendar/campaign-weeks"
import { campaignWeekIds, effectiveRequestedWeeks, preferenceRank } from "@/features/paid-leave/domain/campaign"
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
  const weekIds = campaignWeekIds(campaign)
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
    rows: (bySector.get(sector.id) ?? [])
      .map((employee) => buildRow(campaign, employee, columns, weekIds))
      // Le nom de famille commande le tri, comme sur toute liste affichée : on
      // cherche « Martin », pas « Luca ».
      .sort((left, right) => left.name.localeCompare(right.name, "fr-FR")),
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

function buildRow(
  campaign: PaidLeaveCampaign,
  employee: EmployeeRecord,
  columns: readonly LeaveSheetColumn[],
  weekIds: ReadonlySet<PaidLeaveWeekId>
): LeaveSheetRow {
  const request = campaign.requests[employee.id]
  const granted = new Set(campaign.grants[employee.id] ?? [])
  return {
    employeeId: employee.id,
    // Nom de famille en capitales, comme sur la feuille du planning : c'est ce
    // que l'œil cherche sur un mur.
    name: nameWithUppercaseFamily(`${employee.firstName} ${employee.lastName}`.trim()),
    grantedCount: granted.size,
    requestedCount: effectiveRequestedWeeks(request, weekIds),
    cells: columns.map((column) => ({
      weekId: column.weekId,
      granted: granted.has(column.weekId),
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
