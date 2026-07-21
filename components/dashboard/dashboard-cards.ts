import {
  CalendarDays,
  Gauge,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react"

/**
 * Config for the dashboard overview tiles. Add an entry to render another
 * card — no page changes required.
 */
export type DashboardCardConfig = {
  title: string
  icon: LucideIcon
  description: string
}

export const dashboardCards: DashboardCardConfig[] = [
  {
    title: "Planning",
    icon: CalendarDays,
    description: "Upcoming shifts and coverage",
  },
  {
    title: "Employees",
    icon: Users,
    description: "Team members and availability",
  },
  {
    title: "Alerts",
    icon: TriangleAlert,
    description: "Conflicts needing attention",
  },
  {
    title: "Planning Score",
    icon: Gauge,
    description: "Overall schedule health",
  },
]
