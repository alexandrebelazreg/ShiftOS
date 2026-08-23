import type { SupabaseClient } from "@supabase/supabase-js"

import { requireStoreId } from "@/features/auth/supabase/current-store"
import type { EditorState } from "@/features/planning/editor"
import type { PlanningRecord, PlanningStatus } from "@/features/planning/persistence/planning-record"
import type { PlanningRepository } from "@/features/planning/persistence/planning-repository"

/**
 * Les plannings, en base.
 *
 * Le plus lourd des neuf : un enregistrement porte l'état COMPLET de l'éditeur,
 * de sorte que rouvrir une semaine la restitue exactement telle qu'elle a été
 * laissée. Cet état part en `jsonb` sans être découpé — il n'existe aucune
 * requête qui voudrait fouiller dedans, et le morceler exposerait à en perdre
 * un pan sans que rien ne le dise.
 *
 * Ce qui est promu en colonne l'est parce qu'on cherche dessus : la semaine, le
 * statut, la date. Le reste suit l'état.
 *
 * `sector_ids` est du texte et non de l'uuid, parce que les identifiants de
 * secteur sont préfixés (`sector_<uuid>`). Le découvrir à l'écriture aurait
 * produit une erreur de type illisible sur une sauvegarde de planning.
 */

export interface PlanningRow {
  id: string
  week_key: string
  week_start: string
  period_end: string | null
  label: string | null
  status: string
  sector_ids: string[] | null
  state: Record<string, unknown>
  saved_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

/** La semaine ISO, telle que les écrans la cherchent. */
export function weekKeyOf(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  // Jeudi de la semaine courante : c'est lui qui porte l'année ISO, et l'ignorer
  // fait basculer d'un an les semaines à cheval sur janvier.
  const day = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDay = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3)
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000))
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

export function toRecord(row: PlanningRow): PlanningRecord {
  return {
    id: row.id,
    status: row.status as PlanningStatus,
    label: row.label ?? row.week_key,
    periodStart: row.week_start,
    periodEnd: row.period_end ?? row.week_start,
    ...(row.sector_ids ? { sectorIds: row.sector_ids } : {}),
    state: row.state as unknown as EditorState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    savedAt: row.saved_at ?? row.updated_at,
  }
}

export function toRow(record: PlanningRecord, storeId: string) {
  return {
    store_id: storeId,
    week_key: weekKeyOf(record.periodStart),
    week_start: record.periodStart,
    period_end: record.periodEnd,
    label: record.label,
    status: record.status,
    sector_ids: record.sectorIds ? [...record.sectorIds] : [],
    state: record.state as unknown as Record<string, unknown>,
    saved_at: record.savedAt,
    // Renseigné le jour où le planning est publié, et jamais effacé ensuite :
    // rouvrir un publié pour le modifier crée un brouillon distinct, il ne
    // dépublie pas celui qui est affiché en salle de pause.
    ...(record.status === "published" ? { published_at: new Date().toISOString() } : {}),
  }
}

export function createSupabasePlanningRepository(client: SupabaseClient): PlanningRepository {
  return {
    async save(record) {
      const storeId = await requireStoreId(client)
      const row = toRow(record, storeId)

      // Un identifiant venu de `localStorage` (`planning_xxx`) n'est pas un
      // uuid : la base en fabrique un à l'insertion, et l'ancien ne sert plus.
      // Un identifiant déjà en base est réutilisé pour écraser la même ligne.
      const isDatabaseId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(record.id)
      const { error } = isDatabaseId
        ? await client.from("plannings").upsert({ id: record.id, ...row })
        : await client.from("plannings").insert(row)

      if (error) throw new Error(error.message)
    },

    async get(id) {
      const { data, error } = await client.from("plannings").select("*").eq("id", id).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? toRecord(data as PlanningRow) : null
    },

    async list() {
      const { data, error } = await client
        .from("plannings")
        .select("*")
        .order("updated_at", { ascending: false })
      if (error) throw new Error(error.message)
      return (data as PlanningRow[]).map(toRecord)
    },

    async delete(id) {
      const { error } = await client.from("plannings").delete().eq("id", id)
      if (error) throw new Error(error.message)
    },
  }
}
