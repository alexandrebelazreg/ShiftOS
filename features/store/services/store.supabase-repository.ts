import "server-only"

import { createSupabaseServerClient } from "@/features/auth/supabase/server"
import { storeSchema, type StoreConfig } from "@/features/store/schemas/store.schema"
import type { StoreRepository } from "@/features/store/services/store.repository"

/**
 * Le magasin, en base — la dernière entité qui vivait encore dans un cookie.
 *
 * Elle avait été oubliée de la reprise, et cela se voyait à l'usage : le garde
 * de route lisait un cookie, donc se connecter depuis un autre appareil
 * renvoyait vers « complétez votre magasin » alors qu'il était configuré depuis
 * des semaines. Le compte était partagé, la configuration ne l'était pas.
 *
 * Serveur uniquement. Ce dépôt est lu par les gardes de route, qui s'exécutent
 * avant tout rendu : lire la base ici évite qu'un écran s'affiche à moitié puis
 * se ravise.
 *
 * Le cloisonnement vient de la politique posée en phase 1 : une requête sans
 * clause `where` ne rend que le magasin du compte connecté. Il n'y en a qu'un
 * par compte aujourd'hui, et c'est `maybeSingle` qui le dit.
 */

/** Les champs promus en colonnes ; le reste du schéma part dans `config`. */
const PROMOTED = [
  "name",
  "brand",
  "address",
  "city",
  "postalCode",
  "country",
  "timezone",
] as const

interface StoreRow {
  name: string
  brand: string | null
  address: string
  city: string
  postal_code: string
  country: string
  timezone: string
  config: Record<string, unknown>
  first_run_completed_at: string | null
}

export function toStoreConfig(row: StoreRow): StoreConfig | null {
  const candidate = {
    ...(row.config as Record<string, unknown>),
    name: row.name,
    ...(row.brand ? { brand: row.brand } : {}),
    address: row.address,
    city: row.city,
    postalCode: row.postal_code,
    country: row.country,
    timezone: row.timezone,
  }

  // Revalidé à la lecture, comme le faisait le cookie. Une ligne écrite par une
  // version antérieure du schéma vaut « pas de magasin » plutôt qu'un objet
  // à moitié conforme que chaque écran devrait ensuite se méfier de lire.
  const parsed = storeSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export function toStoreRow(store: StoreConfig) {
  const config: Record<string, unknown> = { ...(store as unknown as Record<string, unknown>) }
  for (const field of PROMOTED) delete config[field]

  return {
    name: store.name,
    brand: store.brand ?? null,
    address: store.address,
    city: store.city,
    postal_code: store.postalCode,
    country: store.country,
    timezone: store.timezone,
    config,
  }
}

export function createSupabaseStoreRepository(): StoreRepository {
  async function row(): Promise<StoreRow | null> {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.from("stores").select("*").maybeSingle()
    if (error || !data) return null
    return data as StoreRow
  }

  async function current(): Promise<StoreConfig | null> {
    const found = await row()
    return found ? toStoreConfig(found) : null
  }

  return {
    getStore: current,

    // « Y a-t-il un magasin » veut dire « un magasin UTILISABLE ». La ligne
    // créée par le rattachement initial porte des valeurs de remplissage et
    // aucun horaire d'ouverture : la valider ici est ce qui envoie le gérant
    // terminer sa configuration, au lieu de le laisser entrer sur des écrans
    // qui tomberaient plus loin.
    async hasStore() {
      return (await current()) !== null
    },

    async saveStore(store) {
      const supabase = await createSupabaseServerClient()
      const { data: profile } = await supabase.from("profiles").select("store_id").maybeSingle()
      const storeId = profile?.store_id as string | undefined
      if (!storeId) throw new Error("Aucun magasin rattaché à ce compte.")

      const { error } = await supabase.from("stores").update(toStoreRow(store)).eq("id", storeId)
      if (error) throw new Error(error.message)
    },

    async clearStore() {
      // Le magasin ne se supprime pas : tout y est rattaché — l'équipe, les
      // plannings, les absences — et l'effacer emporterait l'historique entier.
      // Refaire l'onboarding réécrit la ligne, il ne la retire pas.
      throw new Error("Un magasin ne se supprime pas ; il se reconfigure.")
    },

    async isFirstRunComplete() {
      return (await row())?.first_run_completed_at !== null
    },

    async completeFirstRun() {
      const supabase = await createSupabaseServerClient()
      const { data: profile } = await supabase.from("profiles").select("store_id").maybeSingle()
      const storeId = profile?.store_id as string | undefined
      if (!storeId) return
      await supabase
        .from("stores")
        .update({ first_run_completed_at: new Date().toISOString() })
        .eq("id", storeId)
    },
  }
}
