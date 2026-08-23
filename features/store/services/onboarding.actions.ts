"use server"

import { redirect } from "next/navigation"

import {
  storeSchema,
  type StoreConfig,
} from "@/features/store/schemas/store.schema"
import { storeRepository } from "@/features/store/services/store.repository"
import { supabaseConfigured } from "@/features/auth/supabase/config"
import { createSupabaseServerClient } from "@/features/auth/supabase/server"

export type CompleteOnboardingResult = { ok: false; error: string }

/**
 * Persist the configured store and enter the app.
 *
 * The store is re-validated server-side so the persistence boundary stays
 * trustworthy regardless of the client. On success we redirect to the
 * dashboard; on failure we return an error for the form to display.
 *
 * (`redirect` throws internally, so the success path never returns a value.)
 */
export async function saveStoreConfiguration(
  input: StoreConfig
): Promise<CompleteOnboardingResult> {
  const parsed = storeSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: "La configuration du magasin est invalide." }
  }

  await storeRepository.saveStore(parsed.data)

  // Un espace qui contient déjà une équipe et des secteurs n'est pas une
  // première installation, même si la marque manque : c'est un magasin qui
  // travaille depuis des semaines et dont la configuration vient d'être
  // ressaisie. Lui imposer les six étapes de découverte serait faux, et
  // surtout décourageant — il les a déjà toutes franchies.
  //
  // La marque est posée ici, à partir de ce qui EXISTE, plutôt que réclamée à
  // un gérant qui n'a rien à découvrir.
  if (await workspaceAlreadyInUse()) {
    await storeRepository.completeFirstRun()
    redirect("/dashboard")
  }

  redirect("/onboarding")
}

/**
 * L'espace porte-t-il déjà le travail d'un magasin en activité ?
 *
 * Mesuré sur la base, jamais supposé : des secteurs ET des salariés, c'est-à-dire
 * les deux choses que l'installation initiale sert à créer. L'un sans l'autre ne
 * suffit pas — un secteur seul peut venir d'un essai.
 */
async function workspaceAlreadyInUse(): Promise<boolean> {
  if (!supabaseConfigured()) return false
  try {
    const supabase = await createSupabaseServerClient()
    const [sectors, employees] = await Promise.all([
      supabase.from("sectors").select("id", { count: "exact", head: true }),
      supabase.from("employees").select("id", { count: "exact", head: true }),
    ])
    return (sectors.count ?? 0) > 0 && (employees.count ?? 0) > 0
  } catch {
    // Ne pas savoir vaut « installation neuve » : au pire le gérant traverse
    // six étapes de trop, ce qui est moins grave que de sauter une préparation
    // dont il avait besoin.
    return false
  }
}

/** Update the persisted store configuration without interrupting daily work. */
export async function updateStoreConfiguration(input: StoreConfig): Promise<CompleteOnboardingResult | { ok: true }> {
  const parsed = storeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "La configuration du magasin est invalide." }
  await storeRepository.saveStore(parsed.data)
  return { ok: true }
}

/** Mark the six-step product setup complete and open the first planning. */
export async function completeFirstRun(): Promise<void> {
  if (!(await storeRepository.hasStore())) {
    throw new Error("La configuration du magasin est requise.")
  }
  await storeRepository.completeFirstRun()
  redirect("/planning")
}
