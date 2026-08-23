import { DEFAULT_ABSENCE_RULES, type AbsenceRules } from "@/features/absences/models/absence-rules"
import { createAbsenceRulesRepository } from "@/features/absences/persistence/absence-rules.repository"
import type { AbsenceRulesRepository } from "@/features/absences/persistence/absence-rules.repository"
import { createSupabaseBrowserClient } from "@/features/auth/supabase/browser"
import { supabaseConfigured } from "@/features/auth/supabase/config"
import { browserStore } from "@/features/core/shared/key-value-store"
import { createSupabaseBlobStore } from "@/features/core/shared/supabase-blob"

/**
 * Les écarts au tableau des motifs, et le choix de leur source.
 *
 * Les écrans importaient ce dépôt en le construisant eux-mêmes avec
 * `window.localStorage`. Ils tiennent désormais ce point unique, qui décide —
 * et la bascule vers la base ne les regarde plus.
 */
function repository(): AbsenceRulesRepository {
  if (supabaseConfigured() && typeof window !== "undefined") {
    return createSupabaseBlobStore<AbsenceRules>(
      createSupabaseBrowserClient(),
      "absence_rules",
      "rules",
      DEFAULT_ABSENCE_RULES
    )
  }
  return createAbsenceRulesRepository(browserStore())
}

export const absenceRulesStore: AbsenceRulesRepository = {
  read: () => repository().read(),
  save: (rules) => repository().save(rules),
  reset: () => repository().reset(),
}
