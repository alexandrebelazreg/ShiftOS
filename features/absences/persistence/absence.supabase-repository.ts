import type { SupabaseClient } from "@supabase/supabase-js"

import { requireStoreId } from "@/features/auth/supabase/current-store"
import { DEFAULT_ABSENCE_RULES, resolveMotive } from "@/features/absences/models/absence-rules"
import type {
  AbsenceDraft,
  AbsenceRepository,
} from "@/features/absences/persistence/absence.repository"
import type { AbsenceExtension, AbsenceRecord } from "@/features/absences/types/absence-record"

/**
 * Les absences, en base.
 *
 * Même interface que le dépôt `localStorage`, donc aucun écran ne change.
 * Le cloisonnement vient des politiques, jamais d'une clause écrite ici.
 *
 * Rien ne s'efface toujours pas : `cancel` marque. Une absence saisie puis
 * retirée est exactement ce qu'on cherche à reconstituer six mois plus tard.
 */

export interface AbsenceRow {
  id: string
  employee_id: string
  type: string
  start_date: string
  end_date: string
  status: string
  recorded_on: string
  detail: Record<string, unknown>
}

/** Promu en colonne, donc jamais redit dans le blob. */
const PROMOTED_FIELDS = [
  "id",
  "employeeId",
  "type",
  "start",
  "end",
  "status",
  "recordedOn",
] as const

export function toRecord(row: AbsenceRow): AbsenceRecord {
  return {
    ...(row.detail as unknown as AbsenceRecord),
    id: row.id,
    employeeId: row.employee_id,
    type: row.type as AbsenceRecord["type"],
    start: row.start_date,
    end: row.end_date,
    status: row.status as AbsenceRecord["status"],
    recordedOn: row.recorded_on,
  }
}

export function toRow(record: AbsenceRecord, storeId: string) {
  const detail: Record<string, unknown> = { ...(record as unknown as Record<string, unknown>) }
  for (const field of PROMOTED_FIELDS) delete detail[field]

  return {
    store_id: storeId,
    employee_id: record.employeeId,
    type: record.type,
    start_date: record.start,
    end_date: record.end,
    status: record.status,
    recorded_on: record.recordedOn,
    detail,
  }
}

export function createSupabaseAbsenceRepository(client: SupabaseClient): AbsenceRepository {
  async function fetchOne(id: string): Promise<AbsenceRecord | null> {
    const { data, error } = await client.from("absences").select("*").eq("id", id).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? toRecord(data as AbsenceRow) : null
  }

  async function change(
    id: string,
    apply: (absence: AbsenceRecord) => AbsenceRecord
  ): Promise<AbsenceRecord | null> {
    // Relue avant d'écrire : `extend` a besoin de l'ancienne fin pour garder
    // l'étape, et une écriture aveugle effacerait le blob de tout ce qu'il
    // porte — justificatifs, prolongations, annotations.
    const previous = await fetchOne(id)
    if (!previous) return null
    const storeId = await requireStoreId(client)
    const { data, error } = await client
      .from("absences")
      .update(toRow(apply(previous), storeId))
      .eq("id", id)
      .select("*")
      .single()
    if (error) throw new Error(error.message)
    return toRecord(data as AbsenceRow)
  }

  return {
    async list() {
      const { data, error } = await client
        .from("absences")
        .select("*")
        .order("start_date", { ascending: false })
      if (error) throw new Error(error.message)
      return (data as AbsenceRow[]).map(toRecord)
    },

    async create(draft, today, rules = DEFAULT_ABSENCE_RULES) {
      const definition = resolveMotive(rules, draft.type)
      const storeId = await requireStoreId(client)
      const record = {
        employeeId: draft.employeeId,
        type: draft.type,
        start: draft.start,
        end: draft.end,
        ...(draft.halfDay ? { halfDay: draft.halfDay } : {}),
        ...(draft.hours !== undefined ? { hours: draft.hours } : {}),
        ...(draft.note ? { note: draft.note } : {}),
        status: "active" as const,
        recordedOn: today,
        // Calculé ici, jamais à l'affichage : ce délai court depuis le DÉBUT de
        // l'absence, et une règle changée plus tard ne doit pas rendre soudain
        // « en retard » un papier arrivé à temps l'an dernier.
        ...(definition.proof?.dueDays != null
          ? { proofDueOn: addDays(draft.start, definition.proof.dueDays) }
          : {}),
      } as AbsenceRecord

      const { data, error } = await client
        .from("absences")
        .insert(toRow(record, storeId))
        .select("*")
        .single()
      if (error) throw new Error(error.message)
      return toRecord(data as AbsenceRow)
    },

    async extend(id, newEnd, today) {
      return change(id, (absence) => {
        const step: AbsenceExtension = {
          previousEnd: absence.end,
          newEnd,
          recordedOn: today,
        }
        return {
          ...absence,
          end: newEnd,
          extensions: [...(absence.extensions ?? []), step],
        }
      })
    },

    async cancel(id, today) {
      return change(id, (absence) => ({
        ...absence,
        status: "cancelled",
        cancelledOn: today,
      }))
    },

    async markProofReceived(id, receivedOn) {
      return change(id, (absence) => ({ ...absence, proofReceivedOn: receivedOn }))
    },
  }
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return parsed.toISOString().slice(0, 10)
}

export type { AbsenceDraft }
