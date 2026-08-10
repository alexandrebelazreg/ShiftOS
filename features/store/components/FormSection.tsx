import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * Card-based wrapper for one section of the store form.
 * Keeps section spacing and headings consistent across the wizard.
 */
export function FormSection({
  id,
  step,
  title,
  description,
  children,
}: {
  id?: string
  step?: number
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card id={id} className="scroll-mt-6">
      <CardHeader>
        <div className="flex items-start gap-3">
          {step ? (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {step}
            </span>
          ) : null}
          <div>
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}
