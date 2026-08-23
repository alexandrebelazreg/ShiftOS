import { createSupabaseBrowserClient } from "@/features/auth/supabase/browser"
import { supabaseConfigured } from "@/features/auth/supabase/config"
import { browserStore } from "@/features/core/shared/key-value-store"
import { createSupabaseBlobStore } from "@/features/core/shared/supabase-blob"
import { createHolidayRepository } from "@/features/planning/holidays/holiday.repository"
import type {
  HolidayRepository,
  StoredHolidays,
} from "@/features/planning/holidays/holiday.repository"

/**
 * Les décisions du magasin sur les jours fériés, et le choix de leur source.
 *
 * Rangées à plat, une entrée par date, toutes années confondues : les dates
 * d'un férié se recalculent et ne bougent jamais pour une année donnée, donc la
 * date est une clé stable. La table suit cette forme — c'est elle qui a dû
 * changer, pas le code.
 */
function repository(): HolidayRepository {
  if (supabaseConfigured() && typeof window !== "undefined") {
    return createSupabaseBlobStore<StoredHolidays>(
      createSupabaseBrowserClient(),
      "holidays",
      "days",
      {}
    )
  }
  return createHolidayRepository(browserStore())
}

export const holidayStore: HolidayRepository = {
  read: () => repository().read(),
  save: (holidays) => repository().save(holidays),
}
