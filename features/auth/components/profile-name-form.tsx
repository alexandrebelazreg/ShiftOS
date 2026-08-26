"use client"

import { useState, useTransition } from "react"

import { saveProfileName } from "@/features/auth/actions"
import { Button } from "@/components/ui/button"

/**
 * Le nom qui signe les feuilles affichées au mur.
 *
 * Il ne sert PAS à s'identifier — la session s'en charge, et l'e-mail du compte
 * est juste au-dessus. Il sert à répondre à une question qui se pose devant le
 * panneau d'affichage : qui a imprimé ça, et à qui je demande pourquoi mon
 * samedi a changé. D'où le libellé qui annonce l'effet plutôt que le champ.
 *
 * Le vider est permis et retire la signature : personne n'est obligé de signer.
 */
export function ProfileNameForm({
  initialName,
  email,
}: {
  readonly initialName: string
  readonly email: string
}) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const dirty = name.trim() !== initialName.trim()

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await saveProfileName(name)
      if (result?.error) {
        setError(result.error)
        return
      }
      setSaved(true)
    })
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="profile-name" className="block text-sm font-medium">
          Votre nom
        </label>
        <input
          id="profile-name"
          name="name"
          type="text"
          value={name}
          maxLength={80}
          autoComplete="name"
          placeholder="Alexandre Belazreg"
          onChange={(event) => {
            setName(event.target.value)
            setSaved(false)
          }}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          Il signe les plannings, les congés et les permanences que vous imprimez :
          « Édité le 27/08/2026 à 09:12 par {name.trim() || "…"} ». Laissez vide pour
          n’en signer aucun.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={pending || !dirty}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {error ? (
          <span role="alert" className="text-sm text-destructive">
            {error}
          </span>
        ) : saved && !dirty ? (
          <span className="text-sm text-muted-foreground">Enregistré.</span>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        Compte connecté : <span className="font-medium text-foreground">{email}</span>
      </p>
    </form>
  )
}
