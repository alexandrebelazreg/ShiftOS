"use server"

import { redirect } from "next/navigation"

import {
  storeSchema,
  type StoreConfig,
} from "@/features/store/schemas/store.schema"
import { storeRepository } from "@/features/store/services/store.repository"

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
  redirect("/onboarding")
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
