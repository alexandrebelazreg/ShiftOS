import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { FirstRunSetup } from "@/components/onboarding/first-run-setup"
import { StepProgress } from "@/components/onboarding/step-progress"
import { StoreForm } from "@/features/store/components/StoreForm"
import { getStore, isFirstRunComplete } from "@/features/store/services/store.repository"

export const metadata: Metadata = { title: "Configuration initiale" }

export default async function OnboardingPage() {
  const store = await getStore()
  if (store && await isFirstRunComplete()) {
    redirect("/dashboard")
  }

  if (store) return <FirstRunSetup store={store} />

  return (
    <main className="min-h-svh bg-muted/30">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 md:py-16">
        <StepProgress current={1} total={6} labels={["Magasin", "Secteurs", "Employés", "Compétences", "Contraintes", "Premier planning"]} />

        <header className="mt-8 mb-8 space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            Configurez votre magasin
          </h1>
          <p className="text-muted-foreground">
            Commençons par les informations nécessaires à votre premier planning.
          </p>
        </header>

        <StoreForm />
      </div>
    </main>
  )
}
