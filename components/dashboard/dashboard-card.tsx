import type { LucideIcon } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type DashboardCardProps = {
  title: string
  icon: LucideIcon
  description?: string
  /** Body content. Falls back to an empty-state placeholder when omitted. */
  children?: React.ReactNode
}

/**
 * Reusable dashboard tile: icon + title + optional description, with a
 * content slot. Empty by default so pages stay free of business logic.
 */
export function DashboardCard({
  title,
  icon: Icon,
  description,
  children,
}: DashboardCardProps) {
  return (
    <Card className="transition-colors hover:ring-foreground/20">
      <CardHeader>
        <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4.5" />
        </div>
        <CardTitle className="mt-3">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {children ?? (
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
            No data yet
          </div>
        )}
      </CardContent>
    </Card>
  )
}
