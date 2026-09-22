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
    // Comme pour les salariés : l'identifiant vient de l'application. Il figure
    // dans les adresses (`?planningId=`), et une semaine qu'on rouvre par un
    // lien enregistré doit rester la même.
    id: record.id,
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

/**
 * LA CIBLE DU CONFLIT, ET POURQUOI ELLE PORTE DEUX COLONNES.
 *
 * `PlanningView` fabrique l'identifiant d'une semaine ainsi :
 * `planning_${periode.start}` — déterministe, et SANS le magasin. Tant que
 * `plannings.id` était la clé primaire globale de la table, le deuxième magasin
 * qui enregistrait la semaine du 24 août tombait sur la ligne du premier :
 * l'`upsert` tentait une mise à jour qu'aucune ligne visible ne satisfaisait, ou
 * une insertion en violation de clé. Dans les deux cas, ce magasin ne pouvait
 * PLUS JAMAIS enregistrer cette semaine.
 *
 * Invisible avec un seul magasin, et découvert le jour de la mise en service du
 * second — c'est-à-dire au pire moment possible.
 *
 * La clé primaire est donc devenue `(store_id, id)` (migration 0008). La
 * collision est impossible PAR CONSTRUCTION, et non par une convention de
 * nommage qu'il faudrait se rappeler d'appliquer.
 *
 * CETTE CONSTANTE ET LA MIGRATION NE VALENT QU'ENSEMBLE. PostgREST exige que la
 * cible du conflit corresponde à une contrainte d'unicité réelle : déployer
 * l'une sans l'autre fait échouer tout enregistrement de planning, avec un
 * message explicite. C'est la bonne façon d'échouer — la mauvaise aurait été
 * d'écraser la semaine du voisin en silence.
 */
export const PLANNING_CONFLICT_TARGET = "store_id,id"

export function createSupabasePlanningRepository(client: SupabaseClient): PlanningRepository {
  return {
    async save(record) {
      const storeId = await requireStoreId(client)
      const row = toRow(record, storeId)

      const { error } = await client
        .from("plannings")
        .upsert(row, { onConflict: PLANNING_CONFLICT_TARGET })
      if (error) throw new Error(error.message)
    },

    // POURQUOI CEUX-CI NE FILTRENT PAS SUR LE MAGASIN, alors que la clé vient de
    // devenir composite — c'est la première question qu'on se pose en relisant.
    //
    // Les politiques de cloisonnement ajoutent `store_id = …` à chaque requète :
    // une seule ligne est donc visible pour un identifiant donné, et le répéter
    // ici n'ajouterait aucune garantie, seulement un second endroit où l'oublier.
    //
    // `maybeSingle` devient même un garde-fou : si deux lignes remontaient un
    // jour — politique mal réécrite, ou clé de service utilisée par erreur — il
    // lèverait au lieu d'en choisir une au hasard.
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
