import type { SupabaseClient } from "@supabase/supabase-js"

import { requireStoreId } from "@/features/auth/supabase/current-store"
import type { SectorRepository } from "@/features/sectors/sector.repository"
import type { SectorDemandConfiguration } from "@/features/sectors/sector-demand"

/**
 * Les secteurs, en base — une ligne chacun.
 *
 * `save` reçoit la liste ENTIÈRE, comme avant : l'écran de configuration édite
 * un tableau et l'enregistre d'un bloc. La traduction en lignes fait donc deux
 * gestes, dans cet ordre : écrire ce qui reste, puis retirer ce qui a disparu.
 *
 * L'ordre compte. Supprimer d'abord ouvrirait une fenêtre — courte, mais réelle
 * — pendant laquelle un secteur existant n'existe plus, et une génération
 * lancée à cet instant depuis un autre onglet planifierait une semaine sans lui.
 *
 * L'identifiant vient de l'application (`sector_<uuid>`) et non de la base : les
 * plannings déjà enregistrés le citent, et le laisser changer romprait le lien
 * avec chaque semaine passée.
 */

interface SectorRow {
  id: string
  name: string
  status: string
  market_zone: boolean
  position: number
  config: Record<string, unknown>
}

const PROMOTED_FIELDS = ["id", "name", "status", "marketZone"] as const

function toSector(row: SectorRow): SectorDemandConfiguration {
  return {
    ...(row.config as unknown as SectorDemandConfiguration),
    id: row.id,
    name: row.name,
    status: row.status as SectorDemandConfiguration["status"],
    marketZone: row.market_zone,
  }
}

function toRow(sector: SectorDemandConfiguration, storeId: string, position: number) {
  const config: Record<string, unknown> = { ...(sector as unknown as Record<string, unknown>) }
  for (const field of PROMOTED_FIELDS) delete config[field]

  return {
    id: sector.id,
    store_id: storeId,
    name: sector.name,
    status: sector.status ?? "active",
    market_zone: sector.marketZone === true,
    position,
    config,
  }
}

export function createSupabaseSectorRepository(client: SupabaseClient): SectorRepository {
  return {
    async list() {
      const { data, error } = await client
        .from("sectors")
        .select("*")
        .order("position", { ascending: true })
      if (error) throw new Error(error.message)
      return (data as SectorRow[]).map(toSector)
    },

    async save(sectors) {
      const storeId = await requireStoreId(client)
      const rows = sectors.map((sector, index) => toRow(sector, storeId, index))

      if (rows.length > 0) {
        const { error } = await client.from("sectors").upsert(rows, { onConflict: "id" })
        if (error) throw new Error(error.message)
      }

      // Ce qui n'est plus dans la liste a été supprimé par le gérant. Le filtre
      // porte sur les identifiants restants : sans lui, `delete` sans clause
      // effacerait les secteurs de CE magasin dans leur totalité — la politique
      // de cloisonnement empêche d'atteindre ceux des autres, elle ne protège
      // pas d'une requête trop large chez soi.
      const kept = rows.map((row) => row.id)
      const query = client.from("sectors").delete()
      const { error } = await (kept.length > 0
        ? query.not("id", "in", `(${kept.map((id) => `"${id}"`).join(",")})`)
        : query.eq("store_id", storeId))
      if (error) throw new Error(error.message)
    },
  }
}
