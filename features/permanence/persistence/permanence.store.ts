import { createSupabaseBrowserClient } from "@/features/auth/supabase/browser"
import { supabaseConfigured } from "@/features/auth/supabase/config"
import { browserStore } from "@/features/core/shared/key-value-store"
import {
  createPermanenceRepository,
  type PermanenceRepository,
} from "@/features/permanence/persistence/permanence-repository"
import { createSupabasePermanenceRepository } from "@/features/permanence/persistence/permanence.supabase-repository"

/** Les mois de permanence, et le choix de leur source. */
function repository(): PermanenceRepository {
  if (supabaseConfigured() && typeof window !== "undefined") {
    return createSupabasePermanenceRepository(createSupabaseBrowserClient())
  }
  return createPermanenceRepository(browserStore())
}

export const permanenceStore: PermanenceRepository = {
  get: (year, month) => repository().get(year, month),
  year: (year) => repository().year(year),
  save: (month) => repository().save(month),
  remove: (year, month) => repository().remove(year, month),
}
