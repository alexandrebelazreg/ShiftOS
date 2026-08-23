import { createSupabaseBrowserClient } from "@/features/auth/supabase/browser"
import { supabaseConfigured } from "@/features/auth/supabase/config"
import { browserStore } from "@/features/core/shared/key-value-store"
import { createSectorRepository, type SectorRepository } from "@/features/sectors/sector.repository"
import { createSupabaseSectorRepository } from "@/features/sectors/sector.supabase-repository"

/**
 * Les secteurs, et le choix de leur source.
 *
 * La clé locale s'appelle toujours `shiftos_first_run_setup`, héritée du
 * premier parcours d'installation. Le nom ne dit plus ce qu'il contient, mais
 * le changer perdrait la configuration des magasins qui l'utilisent encore —
 * et la base, elle, nomme sa table correctement.
 */
function repository(): SectorRepository {
  if (supabaseConfigured() && typeof window !== "undefined") {
    return createSupabaseSectorRepository(createSupabaseBrowserClient())
  }
  return createSectorRepository(browserStore())
}

export const sectorStore: SectorRepository = {
  list: () => repository().list(),
  save: (sectors) => repository().save(sectors),
}
