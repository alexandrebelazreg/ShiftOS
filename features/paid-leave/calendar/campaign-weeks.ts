import type {
  PaidLeavePeriod,
  PaidLeaveWeekId,
} from "@/features/paid-leave/models/paid-leave-campaign"

export interface PaidLeaveCampaignWeek {
  readonly id: PaidLeaveWeekId
  readonly isoYear: number
  readonly weekNumber: number
  readonly start: string
  readonly end: string
  readonly shortLabel: string
  readonly rangeLabel: string
}

export function campaignWeeks(
  year: number,
  period: PaidLeavePeriod
): PaidLeaveCampaignWeek[] {
  if (period.kind === "summer") return weeksBetween(year, 18, 43)
  if (period.kind === "winter") {
    return [
      ...weeksBetween(year, 44, weeksInIsoYear(year)),
      ...weeksBetween(year + 1, 1, 17),
    ]
  }
  if (period.startWeek <= period.endWeek) {
    return weeksBetween(year, period.startWeek, period.endWeek)
  }
  return [
    ...weeksBetween(year, period.startWeek, weeksInIsoYear(year)),
    ...weeksBetween(year + 1, 1, period.endWeek),
  ]
}

export function defaultPeriod(kind: PaidLeavePeriod["kind"]): PaidLeavePeriod {
  if (kind === "summer") return { kind, startWeek: 18, endWeek: 43 }
  if (kind === "winter") return { kind, startWeek: 44, endWeek: 17 }
  return { kind, startWeek: 1, endWeek: 52 }
}

export function weekFromId(id: PaidLeaveWeekId): PaidLeaveCampaignWeek {
  const match = /^(\d{4})-W(\d{2})$/.exec(id)
  if (!match) throw new Error(`Semaine ISO invalide : ${id}`)
  return buildWeek(Number(match[1]), Number(match[2]))
}

export function weekIdForDate(date: string): PaidLeaveWeekId {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  const thursday = new Date(parsed)
  const day = thursday.getUTCDay() || 7
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day)
  const isoYear = thursday.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4))
  const firstDay = firstThursday.getUTCDay() || 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstDay)
  const weekNumber = 1 + Math.round(
    (thursday.getTime() - firstThursday.getTime()) / 604_800_000
  )
  return toWeekId(isoYear, weekNumber)
}

export function weeksInIsoYear(year: number): number {
  return Number(weekIdForDate(`${year}-12-28`).slice(-2))
}

function weeksBetween(year: number, start: number, end: number): PaidLeaveCampaignWeek[] {
  const maximum = weeksInIsoYear(year)
  const first = Math.max(1, Math.min(Math.round(start), maximum))
  const last = Math.max(first, Math.min(Math.round(end), maximum))
  return Array.from({ length: last - first + 1 }, (_, index) =>
    buildWeek(year, first + index)
  )
}

function buildWeek(isoYear: number, weekNumber: number): PaidLeaveCampaignWeek {
  const januaryFourth = new Date(Date.UTC(isoYear, 0, 4))
  const day = januaryFourth.getUTCDay() || 7
  const monday = new Date(januaryFourth)
  monday.setUTCDate(januaryFourth.getUTCDate() - day + 1 + (weekNumber - 1) * 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const start = toIsoDate(monday)
  const end = toIsoDate(sunday)

  return {
    id: toWeekId(isoYear, weekNumber),
    isoYear,
    weekNumber,
    start,
    end,
    shortLabel: `S${weekNumber}`,
    rangeLabel: formatRange(start, end),
  }
}

function toWeekId(year: number, weekNumber: number): PaidLeaveWeekId {
  return `${year}-W${String(weekNumber).padStart(2, "0")}` as PaidLeaveWeekId
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatRange(start: string, end: string): string {
  const format = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
  const value = (date: string) =>
    format.format(new Date(`${date}T00:00:00.000Z`)).replace(".", "")
  return `${value(start)} – ${value(end)}`
}
