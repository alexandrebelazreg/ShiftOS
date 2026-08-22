# Appliquer le schéma sur Supabase

Chaque commande remplit ton presse-papier. **Tu n'as jamais à ouvrir un fichier
ni à choisir quoi copier** — tu lances la commande, puis tu colles dans Supabase.

---

## 1. Terminal — récupérer la dernière version

```
git pull
```

## 2. Terminal — copier la remise à zéro

```
powershell -c "Get-Content -Raw -Encoding UTF8 supabase/reset.sql | Set-Clipboard"
```

## 3. Supabase — l'exécuter

`SQL Editor` → `New query` → **Ctrl+V** → `Run`

> Ne surligne aucun texte avant de cliquer. Si une portion est sélectionnée,
> Supabase n'exécute que celle-là.

## 4. Terminal — copier le schéma

```
powershell -c "Get-Content -Raw -Encoding UTF8 supabase/migrations/0001_socle.sql | Set-Clipboard"
```

## 5. Supabase — l'exécuter

`New query` → un onglet **neuf** → **Ctrl+V** → `Run`

Attendu : `Success. No rows returned`

## 6. Supabase — vérifier

`New query`, puis taper :

```
select count(*) from pg_tables where schemaname='public';
```

Attendu : **10**

---

## Les deux fichiers

| Fichier | Effet |
|---|---|
| `supabase/reset.sql` | **efface** les 10 tables |
| `supabase/migrations/0001_socle.sql` | **crée** les 10 tables |

L'étape 2 n'est nécessaire que si une tentative précédente s'est interrompue.
Sur une base vierge, passer directement à l'étape 4.

## Si l'étape 5 échoue

Relever le message d'erreur complet, puis reprendre à l'étape 2 : la remise à
zéro efface l'état partiel, et le schéma se rejoue proprement.
