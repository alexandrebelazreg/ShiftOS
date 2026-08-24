"use client"

import { useEffect, useState } from "react"
import { LoaderCircle } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"

export function PlanningGenerationLoader({ maxSeconds }: { readonly maxSeconds: number }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedSeconds((elapsed) => Math.min(maxSeconds, elapsed + 1))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [maxSeconds])

  const finalizing = elapsedSeconds >= maxSeconds

  return (
    <Card role="status" aria-live="polite">
      <CardContent className="py-8">
        <div className="mx-auto flex max-w-xl flex-col items-center text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <LoaderCircle className="size-6 animate-spin" aria-hidden="true" />
          </span>
          <p className="mt-4 font-medium">
            {finalizing ? "Finalisation du planning…" : "Création de votre planning…"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {finalizing
              ? "Le résultat est en cours de préparation."
              : "La recherche explore les plannings possibles."}
          </p>
          {/* La barre reste, le décompte part.
              Il n'annonçait pas une durée sûre : quand l'équité impose des
              plafonds, le moteur peut chercher une seconde fois, et le compteur
              atteignait sa fin bien avant le résultat — un chiffre qui se fige
              inquiète plus qu'il n'informe. La barre, elle, dit « ça travaille »
              sans rien promettre. */}
          <progress
            className="mt-5 h-2 w-full overflow-hidden rounded-full accent-primary"
            max={maxSeconds}
            value={elapsedSeconds}
            aria-label="Génération en cours"
          />
        </div>
      </CardContent>
    </Card>
  )
}
