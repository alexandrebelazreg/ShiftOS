"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { LogOut } from "lucide-react"

import { configurationItem, navItems } from "@/components/layout/nav-config"
import { signOut } from "@/features/auth/actions"
import { cn } from "@/lib/utils"

/** Qui est connecté, tel que le rail a besoin de le dire. */
export interface SidebarIdentity {
  /** Le nom saisi dans les Paramètres, ou `null` s'il ne l'a pas été. */
  readonly name: string | null
  readonly email: string
}

/**
 * Shared sidebar content (brand + navigation + footer).
 * Rendered by both the desktop rail and the mobile drawer so the
 * navigation stays defined in a single place.
 *
 * @param onNavigate - optional callback fired on link click (used by the
 *   mobile drawer to close itself after navigating).
 */
export function SidebarNav({
  identity,
  onNavigate,
}: {
  readonly identity: SidebarIdentity
  readonly onNavigate?: () => void
}) {
  const pathname = usePathname()

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
          S
        </div>
        <span className="text-sm font-semibold tracking-tight">Planiteo</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {navItems.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.title}
            </Link>
          )
        })}
      </nav>

      {/* QUI EST CONNECTÉ, ET COMMENT EN SORTIR.
          Ce pied portait « Planiteo · Espace de travail » : le nom du produit
          sous le nom du produit, et une notion d'espace de travail qui n'existe
          pas. Il dit maintenant sous quel compte on travaille — l'e-mail tant
          qu'aucun nom n'est saisi, parce qu'inventer un nom ici le ferait
          imprimer au bas des feuilles affichées. */}
      <div className="shrink-0 border-t border-sidebar-border p-3">
        <NavigationLink item={configurationItem} pathname={pathname} onNavigate={onNavigate} />
        <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium">
            {initialsOf(identity)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{identity.name ?? identity.email}</p>
            <p className="truncate text-xs text-sidebar-foreground/60">
              {identity.name ? identity.email : "Nom non renseigné"}
            </p>
          </div>
        </div>
        {/* Un `form` et non un `onClick` : la déconnexion est une écriture de
            session, donc une action serveur. Le cookie tombe dans la requête
            qui la demande, et rien ne transite par du JavaScript de page. */}
        <form action={signOut}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          >
            <LogOut className="size-4 shrink-0" />
            Se déconnecter
          </button>
        </form>
      </div>
    </div>
  )
}

function NavigationLink({ item, pathname, onNavigate }: { item: (typeof navItems)[number]; pathname: string; onNavigate?: () => void }) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
  const Icon = item.icon
  return <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("mb-2 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors", active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground")}><Icon className="size-4 shrink-0" />{item.title}</Link>
}

/**
 * Deux lettres pour la pastille : les initiales du nom, ou la première lettre
 * de l'e-mail à défaut. Jamais vide — une pastille creuse ferait croire à un
 * chargement qui n'arrive pas.
 */
function initialsOf({ name, email }: SidebarIdentity): string {
  const source = name?.trim()
  if (!source) return (email.trim()[0] ?? "?").toUpperCase()
  return source
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}
