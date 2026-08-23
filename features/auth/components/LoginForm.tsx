"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { signIn, type SignInResult } from "@/features/auth/actions"

/**
 * Le formulaire de connexion.
 *
 * `useActionState` plutôt qu'un `useState` et un `fetch` : l'action tourne sur
 * le serveur, le mot de passe n'est jamais manipulé par du code de page, et
 * l'état d'envoi vient du framework au lieu d'être tenu à la main.
 */
export function LoginForm({ next }: { readonly next: string }) {
  const [state, action, pending] = useActionState<SignInResult | null, FormData>(signIn, null)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="suivant" value={next} />

      <div className="space-y-2">
        <Label htmlFor="email">Adresse e-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="vous@exemple.fr"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Mot de passe</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {state?.error ? (
        // `role="alert"` : le message doit être annoncé, pas seulement affiché —
        // celui qui se trompe de mot de passe ne regarde pas toujours l'écran.
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Connexion…" : "Se connecter"}
      </Button>
    </form>
  )
}
