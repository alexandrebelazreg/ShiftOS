import type { SupabaseClient } from "@supabase/supabase-js"

import { requireStoreId } from "@/features/auth/supabase/current-store"
import type { LocalSnapshot } from "@/features/migration/local-data"

/**
 * La reprise : ce que ce navigateur détient part en base, tel quel.
 *
 * Trois règles gouvernent tout ce fichier.
 *
 * 1. LES IDENTIFIANTS SONT PRÉSERVÉS. Un planning enregistré cite ses salariés
 *    par leur identifiant dans tout son état ; laisser la base en attribuer de
 *    nouveaux romprait chaque semaine passée. C'est pour cela que les colonnes
 *    `id` sont passées en texte.
 *
 * 2. L'ORDRE SUIT LES DÉPENDANCES. Les salariés avant les absences, qui les
 *    référencent. L'inverse ferait échouer la contrainte, et sur une reprise
 *    partiellement écrite il est très difficile de savoir où l'on en est.
 *
 * 3. TOUT EST `upsert`. Relancer la reprise doit écraser, jamais dupliquer :
 *    c'est ce qui permet de la refaire après une coupure de réseau sans se
 *    demander ce qui était déjà passé.
 */

export interface ImportStep {
  readonly label: string
  readonly written: number
  readonly error?: string
}

type Row = Record<string, unknown>

const PROMOTED_EMPLOYEE = [
  "id",
  "firstName",
  "lastName",
  "email",
  "phone",
  "status",
  "contractType",
  "weeklyMinutes",
  "createdAt",
  "updatedAt",
] as const

const PROMOTED_ABSENCE = [
  "id",
  "employeeId",
  "type",
  "start",
  "end",
  "status",
  "recordedOn",
] as const

function without(value: Row, fields: readonly string[]): Row {
  const copy: Row = { ...value }
  for (const field of fields) delete copy[field]
  return copy
}

/** La semaine ISO d'une date, pour ranger un planning repris. */
function weekKeyOf(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  const day = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000))
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

export async function importSnapshot(
  client: SupabaseClient,
  snapshot: LocalSnapshot,
  onStep?: (step: ImportStep) => void
): Promise<ImportStep[]> {
  const storeId = await requireStoreId(client)
  const steps: ImportStep[] = []

  async function write(
    label: string,
    table: string,
    rows: Row[],
    conflict: string
  ): Promise<void> {
    if (rows.length === 0) {
      const step = { label, written: 0 }
      steps.push(step)
      onStep?.(step)
      return
    }
    const { error } = await client.from(table).upsert(rows, { onConflict: conflict })
    const step: ImportStep = error
      ? { label, written: 0, error: error.message }
      : { label, written: rows.length }
    steps.push(step)
    onStep?.(step)
  }

  // 1. Les secteurs : rien ne les référence par contrainte, mais tout les cite.
  await write(
    "Secteurs",
    "sectors",
    snapshot.sectors.map((raw, index) => {
      const sector = raw as Row
      return {
        id: String(sector.id),
        store_id: storeId,
        name: String(sector.name ?? "Secteur"),
        status: String(sector.status ?? "active"),
        market_zone: sector.marketZone === true,
        position: index,
        config: without(sector, ["id", "name", "status", "marketZone"]),
      }
    }),
    "id"
  )

  // 2. Les salariés, avant tout ce qui les référence.
  await write(
    "Salariés",
    "employees",
    snapshot.employees.map((raw) => {
      const employee = raw as Row
      return {
        id: String(employee.id),
        store_id: storeId,
        first_name: String(employee.firstName ?? ""),
        last_name: String(employee.lastName ?? ""),
        email: (employee.email as string) || null,
        phone: (employee.phone as string) || null,
        status: String(employee.status ?? "active"),
        contract_type: (employee.contractType as string) ?? null,
        weekly_minutes: (employee.weeklyMinutes as number) ?? null,
        profile: without(employee, PROMOTED_EMPLOYEE),
      }
    }),
    "id"
  )

  // 3. Les absences, qui citent un salarié par contrainte.
  await write(
    "Absences",
    "absences",
    snapshot.absences.map((raw) => {
      const absence = raw as Row
      return {
        id: String(absence.id),
        store_id: storeId,
        employee_id: String(absence.employeeId),
        type: String(absence.type),
        start_date: String(absence.start),
        end_date: String(absence.end),
        status: String(absence.status ?? "active"),
        recorded_on: String(absence.recordedOn ?? absence.start),
        detail: without(absence, PROMOTED_ABSENCE),
      }
    }),
    "id"
  )

  // 4. Les plannings, qui citent les deux dans leur état.
  await write(
    "Plannings",
    "plannings",
    snapshot.plannings.map((raw) => {
      const record = raw as Row
      const start = String(record.periodStart)
      return {
        id: String(record.id),
        store_id: storeId,
        week_key: weekKeyOf(start),
        week_start: start,
        period_end: String(record.periodEnd ?? start),
        label: (record.label as string) ?? null,
        status: String(record.status ?? "draft"),
        sector_ids: Array.isArray(record.sectorIds) ? record.sectorIds : [],
        state: (record.state as Row) ?? {},
        saved_at: (record.savedAt as string) ?? null,
      }
    }),
    "id"
  )

  await write(
    "Mois de permanence",
    "permanences",
    snapshot.permanences.map((raw) => {
      const month = raw as Row
      return { store_id: storeId, month_key: String(month.id), state: month }
    }),
    "store_id,month_key"
  )

  await write(
    "Campagnes de congés",
    "paid_leave_campaigns",
    snapshot.campaigns.map((raw) => {
      const campaign = raw as Row
      return {
        store_id: storeId,
        campaign_key: String(campaign.id),
        label: (campaign.name as string) ?? null,
        status: String(campaign.status ?? "editing"),
        is_active: snapshot.activeCampaignId === campaign.id,
        state: without(campaign, ["id"]),
      }
    }),
    "store_id,campaign_key"
  )

  await write(
    "Règles d'absence",
    "absence_rules",
    snapshot.absenceRules ? [{ store_id: storeId, rules: snapshot.absenceRules }] : [],
    "store_id"
  )

  await write(
    "Décisions sur les fériés",
    "holidays",
    snapshot.holidays ? [{ store_id: storeId, days: snapshot.holidays }] : [],
    "store_id"
  )

  return steps
}
