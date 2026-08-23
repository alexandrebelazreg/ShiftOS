import type { SupabaseClient } from "@supabase/supabase-js"

import { requireStoreId } from "@/features/auth/supabase/current-store"
import type { PaidLeaveCampaign } from "@/features/paid-leave/models/paid-leave-campaign"
import type { PaidLeaveRepository } from "@/features/paid-leave/persistence/paid-leave-repository"

/**
 * Les campagnes de congés, en base.
 *
 * L'identifiant vient de l'application (`leave_<uuid>`) et vit dans
 * `campaign_key`, non dans la clé primaire : une campagne est citée par les
 * écrans qui la lisent, et lui laisser prendre un nouvel identifiant à la
 * première écriture aurait rompu ces liens.
 *
 * La campagne active est un DRAPEAU sur la ligne, pas une clé à part. Une
 * valeur unique rangée ailleurs peut désigner une campagne supprimée ; un
 * drapeau disparaît avec sa ligne.
 */

interface CampaignRow {
  campaign_key: string
  label: string | null
  status: string
  is_active: boolean
  state: Record<string, unknown>
}

function toCampaign(row: CampaignRow): PaidLeaveCampaign {
  return {
    ...(row.state as unknown as PaidLeaveCampaign),
    id: row.campaign_key,
  }
}

function toRow(campaign: PaidLeaveCampaign, storeId: string) {
  const state: Record<string, unknown> = { ...(campaign as unknown as Record<string, unknown>) }
  delete state.id

  return {
    store_id: storeId,
    campaign_key: campaign.id,
    label: (campaign as unknown as { name?: string }).name ?? null,
    status: (campaign as unknown as { status?: string }).status ?? "editing",
    state,
  }
}

export function createSupabasePaidLeaveRepository(client: SupabaseClient): PaidLeaveRepository {
  return {
    async list() {
      const { data, error } = await client
        .from("paid_leave_campaigns")
        .select("*")
        .order("updated_at", { ascending: false })
      if (error) throw new Error(error.message)
      return (data as CampaignRow[]).map(toCampaign)
    },

    async get(id) {
      const { data, error } = await client
        .from("paid_leave_campaigns")
        .select("*")
        .eq("campaign_key", id)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? toCampaign(data as CampaignRow) : null
    },

    async save(campaign) {
      const storeId = await requireStoreId(client)
      const { error } = await client
        .from("paid_leave_campaigns")
        .upsert(toRow(campaign, storeId), { onConflict: "store_id,campaign_key" })
      if (error) throw new Error(error.message)
    },

    async remove(id) {
      const { error } = await client
        .from("paid_leave_campaigns")
        .delete()
        .eq("campaign_key", id)
      if (error) throw new Error(error.message)
    },

    async activeId() {
      const { data, error } = await client
        .from("paid_leave_campaigns")
        .select("campaign_key")
        .eq("is_active", true)
        .maybeSingle()
      if (error) return null
      return (data?.campaign_key as string | undefined) ?? null
    },

    async setActiveId(id) {
      const storeId = await requireStoreId(client)
      // Éteindre les autres AVANT d'allumer celle-ci : l'ordre inverse laisserait
      // deux campagnes actives le temps d'un aller-retour, et une lecture tombée
      // pile là rendrait la mauvaise.
      const { error: cleared } = await client
        .from("paid_leave_campaigns")
        .update({ is_active: false })
        .eq("store_id", storeId)
        .neq("campaign_key", id)
      if (cleared) throw new Error(cleared.message)

      const { error } = await client
        .from("paid_leave_campaigns")
        .update({ is_active: true })
        .eq("campaign_key", id)
      if (error) throw new Error(error.message)
    },
  }
}
