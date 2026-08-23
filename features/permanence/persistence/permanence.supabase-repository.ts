import type { SupabaseClient } from "@supabase/supabase-js"

import { requireStoreId } from "@/features/auth/supabase/current-store"
import {
  permanenceMonthId,
  type PermanenceMonth,
} from "@/features/permanence/models/permanence-month"
import type { PermanenceRepository } from "@/features/permanence/persistence/permanence-repository"

/**
 * Les mois de permanence, en base — un par clé « 2026-08 ».
 *
 * Pas d'index, comme avant : la clé d'un mois se DÉDUIT de l'année et du mois
 * demandés. Une liste des mois existants n'apprendrait rien qu'une requête sur
 * le préfixe de l'année ne dise déjà, et un index qu'on oublie de tenir à jour
 * fait disparaître un mois qui existe pourtant.
 */

interface PermanenceRow {
  month_key: string
  state: Record<string, unknown>
}

export function createSupabasePermanenceRepository(
  client: SupabaseClient
): PermanenceRepository {
  return {
    async get(year, month) {
      const { data, error } = await client
        .from("permanences")
        .select("*")
        .eq("month_key", permanenceMonthId(year, month))
        .maybeSingle()
      if (error || !data) return null
      return (data as PermanenceRow).state as unknown as PermanenceMonth
    },

    async year(year) {
      // Les douze clés d'une année partagent son préfixe : « 2026-01 » à
      // « 2026-12 ». Une seule requête plutôt que douze.
      const { data, error } = await client
        .from("permanences")
        .select("*")
        .like("month_key", `${year}-%`)
        .order("month_key", { ascending: true })
      if (error) return []
      return (data as PermanenceRow[]).map((row) => row.state as unknown as PermanenceMonth)
    },

    async save(month) {
      const storeId = await requireStoreId(client)
      const { error } = await client
        .from("permanences")
        .upsert(
          { store_id: storeId, month_key: month.id, state: month as unknown as Record<string, unknown> },
          { onConflict: "store_id,month_key" }
        )
      if (error) throw new Error(error.message)
    },

    async remove(year, month) {
      const { error } = await client
        .from("permanences")
        .delete()
        .eq("month_key", permanenceMonthId(year, month))
      if (error) throw new Error(error.message)
    },
  }
}
