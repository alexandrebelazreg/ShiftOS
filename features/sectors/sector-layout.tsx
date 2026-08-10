"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * The three layout primitives every sector screen is built from.
 *
 * Extracted from `SectorConfigurationView` when the « Contraintes avancées »
 * block arrived: a second file needed the same card, the same labelled field and
 * the same empty state, and a private copy of each is how two screens start
 * looking subtly different.
 */

export function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-2 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{text}</p>
}
