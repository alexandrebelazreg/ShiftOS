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
              : `La recherche peut prendre jusqu’à ${maxSeconds} secondes.`}
          </p>
          <progress
            className="mt-5 h-2 w-full overflow-hidden rounded-full accent-primary"
            max={maxSeconds}
            value={elapsedSeconds}
            aria-label="Temps de génération écoulé"
          />
          <p className="mt-2 text-xs tabular-nums text-muted-foreground">
            {elapsedSeconds} s / {maxSeconds} s
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
