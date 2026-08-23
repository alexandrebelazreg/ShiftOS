import { cookies } from "next/headers"

import { supabaseConfigured } from "@/features/auth/supabase/config"
import { createSupabaseStoreRepository } from "@/features/store/services/store.supabase-repository"

import {
  storeSchema,
  type StoreConfig,
} from "@/features/store/schemas/store.schema"

/**
 * Persistence boundary for the store / onboarding state.
 *
 * This interface is the seam that isolates the rest of the app from HOW the
 * store is stored. Today it is backed by an HTTP cookie — a temporary,
 * dependency-free "application state manager". Tomorrow a
 * `SupabaseStoreRepository` implements the same contract and only the
 * `storeRepository` binding at the bottom of this file changes.
 *
 * Server-only: reads/writes cookies via `next/headers`. Never import this from
 * a Client Component — use the server actions (`onboarding.actions.ts`) to
 * mutate, and read only from Server Components (route guards).
 */
export interface StoreRepository {
  /** The configured store, or `null` when onboarding is not completed. */
  getStore(): Promise<StoreConfig | null>
  /** Whether a store exists (i.e. onboarding is completed). */
  hasStore(): Promise<boolean>
  /** Whether the guided first-run flow has been completed. */
  isFirstRunComplete(): Promise<boolean>
  /** Persist the store (marks onboarding as completed). */
  saveStore(store: StoreConfig): Promise<void>
  /** Remove the store (resets onboarding). */
  clearStore(): Promise<void>
  completeFirstRun(): Promise<void>
}

const STORE_COOKIE = "shiftos_store"
const FIRST_RUN_COOKIE = "shiftos_first_run_complete"
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

/**
 * Cookie-backed implementation. State lives in a single HTTP cookie so that
 * server-side route guards can read it on every request without a database.
 */
class CookieStoreRepository implements StoreRepository {
  async getStore(): Promise<StoreConfig | null> {
    const raw = (await cookies()).get(STORE_COOKIE)?.value
    if (!raw) return null

    try {
      // Re-validate: a corrupt or outdated cookie is treated as "no store".
      const parsed = storeSchema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  async hasStore(): Promise<boolean> {
    return (await this.getStore()) !== null
  }

  async saveStore(store: StoreConfig): Promise<void> {
    ;(await cookies()).set(STORE_COOKIE, JSON.stringify(store), {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ONE_YEAR_SECONDS,
    })
  }

  async clearStore(): Promise<void> {
    ;(await cookies()).delete(STORE_COOKIE)
    ;(await cookies()).delete(FIRST_RUN_COOKIE)
  }

  async isFirstRunComplete(): Promise<boolean> {
    return (await cookies()).get(FIRST_RUN_COOKIE)?.value === "true"
  }

  async completeFirstRun(): Promise<void> {
    ;(await cookies()).set(FIRST_RUN_COOKIE, "true", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ONE_YEAR_SECONDS,
    })
  }
}

/**
 * Active repository. Swap this single line for a `SupabaseStoreRepository`
 * (implementing `StoreRepository`) later — no call site changes required.
 */
/**
 * Le dépôt actif.
 *
 * La base quand elle est configurée, le cookie sinon — et le cookie n'est plus
 * là que pour un poste dont les variables ne sont pas posées. Résolu à chaque
 * appel : ce module est importé par des gardes de route qui s'exécutent avant
 * tout rendu, et figer le choix à l'import le figerait pour la vie du serveur.
 *
 * Le commentaire d'origine de ce fichier annonçait exactement cette ligne :
 * « seule la liaison change, aucun appelant ne bouge ». Les quatorze appelants
 * n'ont effectivement pas bougé.
 */
/**
 * Le dépôt cookie, exposé pour une seule raison : la reprise doit pouvoir lire
 * ce qu'un poste détient encore, même quand la base est déjà branchée.
 */
export const cookieStoreRepository: StoreRepository = new CookieStoreRepository()

const cookieRepository = cookieStoreRepository

function active(): StoreRepository {
  return supabaseConfigured() ? createSupabaseStoreRepository() : cookieRepository
}

export const storeRepository: StoreRepository = {
  getStore: () => active().getStore(),
  hasStore: () => active().hasStore(),
  isFirstRunComplete: () => active().isFirstRunComplete(),
  saveStore: (store) => active().saveStore(store),
  clearStore: () => active().clearStore(),
  completeFirstRun: () => active().completeFirstRun(),
}

/** Read-only convenience bindings used by the route guards. */
export const getStore = (): Promise<StoreConfig | null> =>
  storeRepository.getStore()
export const hasStore = (): Promise<boolean> => storeRepository.hasStore()
export const isFirstRunComplete = (): Promise<boolean> => storeRepository.isFirstRunComplete()
