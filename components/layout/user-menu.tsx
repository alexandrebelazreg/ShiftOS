/**
 * Compact user identity shown in the header. Display-only.
 */
export function UserMenu({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm font-medium sm:inline">{name}</span>
      <div className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
        {initials}
      </div>
    </div>
  )
}
