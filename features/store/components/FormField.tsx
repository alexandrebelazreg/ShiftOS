import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * Reusable field wrapper: label + control slot + optional description and
 * validation error. Purely presentational — the control is passed as children.
 */
export function FormField({
  label,
  htmlFor,
  error,
  description,
  required,
  className,
  children,
}: {
  label?: string
  htmlFor?: string
  error?: string
  description?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("grid gap-2", className)}>
      {label ? (
        <Label htmlFor={htmlFor}>
          {label}
          {required ? <span className="text-destructive"> *</span> : null}
        </Label>
      ) : null}
      {children}
      {description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : null}
    </div>
  )
}
