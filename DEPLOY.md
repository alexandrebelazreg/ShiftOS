# Déploiement — Planiteo

Cible : **Hetzner CX22 (Allemagne) + Coolify**, un seul conteneur qui porte le
serveur Next et le solveur Python. ~4,40 €/mois.

## Pourquoi ce choix

Mesures faites sur la machine de développement, le 19 août 2026 :

| | Durée | RSS max |
|---|---|---|
| Drive canonique | 1,8 s | 86 Mo |
| Semaine réelle (dump 121 Ko) | 39,8 s | 137 Mo |
| Zone marché (cas le plus lourd) | 43,9 s | 249 Mo |
| `next build` | 83 s | 1 620 Mo |

Il faut donc ~1 Go en exécution et ~2 Go pour compiler. Cela exclut les offres à
512 Mo, et cela exclut surtout tout hébergement serverless : les fonctions
Netlify plafonnent à 10 s (26 s en Pro) et ne peuvent pas lancer de
sous-processus Python ; Vercel donne le temps mais fait de Python un runtime de
fonction séparé, inaccessible depuis une route Node.

Un conteneur lève les deux contraintes **sans modifier une ligne du code
existant** : le `spawn` de l'adaptateur est parfaitement légitime là où il l'est
moins en serverless.

---

## 1. Créer le serveur

1. Compte sur [console.hetzner.cloud](https://console.hetzner.cloud).
2. **New project** → **Add server**.
3. Région : **Falkenstein** ou **Nuremberg** (Allemagne, UE — voir §7).
4. Image : **Ubuntu 24.04**.
5. Type : **CX22** — 2 vCPU, 4 Go, 40 Go NVMe. 3,79 €/mois + ~0,60 € d'IPv4.
6. Ajouter sa clé SSH (ne pas choisir l'authentification par mot de passe).
7. Créer, puis noter l'adresse IP.

Le CX22 est dimensionné pour compiler ET exécuter. Une machine à 2 Go
suffirait à l'exécution mais serait tuée par l'OOM pendant `next build`.

## 2. Installer Coolify

En SSH sur le serveur :

```
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Puis ouvrir `http://<IP>:8000` et créer le compte administrateur. **Le faire
immédiatement** : tant que ce compte n'existe pas, l'écran d'inscription est
ouvert à qui trouve l'adresse.

Coolify installe Traefik comme reverse proxy. C'est exactement ce que le guide
d'auto-hébergement de Next 16 recommande : il absorbe les requêtes malformées,
les connexions lentes et les limites de charge utile, que le serveur Next n'a
pas à traiter lui-même.

## 3. Connecter le dépôt

Dans Coolify : **Sources** → **GitHub** → installer la GitHub App sur
`alexandrebelazreg/Planiteo`.

## 4. Créer la ressource

**+ New** → **Application** → dépôt `Planiteo`, branche `main`.

- Build Pack : **Dockerfile**
- Dockerfile : `./Dockerfile`
- Port exposé : `3000`
- Health check : `/api/health`

Le `Dockerfile` et le `.dockerignore` sont versionnés à la racine ; il n'y a
rien à écrire dans l'interface.

## 5. Variables d'environnement

| Variable | Valeur | Rôle |
|---|---|---|
| `TZ` | `Europe/Paris` | déjà dans l'image, à confirmer ici |
| `PLANNING_HIGHS_PYTHON` | `/app/.venv-planning-highs/bin/python3` | déjà dans l'image |
| `PLANNING_V3_DUMP_DIR` | *(ne pas définir)* | active la capture de problèmes réels, qui contiennent des noms et des contrats |

Ne définir `PLANNING_V3_DUMP_DIR` que le temps d'un diagnostic, et retirer les
fichiers ensuite.

## 6. Domaine et HTTPS

Un enregistrement DNS `A` de `planiteo.<ton-domaine>` vers l'IP du serveur, puis
le même nom dans le champ **Domains** de Coolify. Le certificat Let's Encrypt
est demandé automatiquement.

Sans domaine, `http://<IP>:3000` fonctionne mais **sans TLS** : à réserver au
premier essai, jamais à un usage réel — le cookie du magasin transiterait en
clair.

## 7. Ce qui ferme l'accès

**Cette section décrivait l'inverse jusqu'au 26 août 2026**, quand
l'authentification n'existait pas encore et qu'elle recommandait un Basic Auth
Traefik en attendant. Ce n'est plus le cas, et une doc de déploiement qui décrit
le mauvais modèle de menace est plus dangereuse qu'une doc absente.

L'application se garde désormais elle-même, sur quatre niveaux :

| Niveau | Où |
|---|---|
| Session vérifiée côté serveur, traversée par chaque page, action et route | `features/auth/dal.ts` |
| Cloisonnement par magasin dans la base, qui double la barrière applicative | politiques RLS de `0001_socle.sql` |
| Les deux routes de solveur exigent une session et refusent en JSON avec un 401, sans jamais rediriger | `app/api/*/solve/route.ts` |
| Cinq échecs de connexion par adresse et vingt par IP sur quinze minutes | `features/auth/login-throttle.ts` |

Le point que l'ancienne version visait juste reste vrai et reste traité : les
routes de solveur acceptent une charge utile de 2 Mo pour lancer un calcul de
plusieurs minutes. Ce n'est plus « de n'importe qui » — la session est vérifiée
avant même que le corps de la requête soit lu.

Un Basic Auth Traefik par-dessus tout cela n'est plus nécessaire. Il reste une
option légitime pendant une phase de test, quand on ne veut pas qu'une adresse
soit atteignable du tout, mais ce n'est plus lui qui protège les données.

## 8. Vérifier

```
curl https://planiteo.<ton-domaine>/api/health
```

Réponse attendue : `{"status":"ok","solver":"ready"}`.

Un `503` avec `"solver":"unreachable"` signifie que l'environnement Python n'est
pas là où l'adaptateur le cherche : l'application servirait toutes ses pages
tout en étant incapable de générer le moindre planning. C'est précisément la
panne silencieuse que cette sonde existe pour rendre bruyante.

Ensuite, générer une vraie semaine depuis l'interface et vérifier que la réponse
arrive en moins d'une minute.

## 9. Sauvegardes

**Cette section aussi disait le contraire jusqu'au 26 août 2026** : les données
vivaient alors dans le navigateur du manager. Elles sont maintenant dans
Postgres, et c'est là que la sauvegarde compte.

Deux choses distinctes, qui ne se remplacent pas.

**Les sauvegardes Postgres, chez Supabase.** Ce sont les seules qui protègent le
travail. Leur fréquence et leur profondeur dépendent du plan souscrit, à
vérifier dans le tableau de bord plutôt qu'à supposer. Une restauration se
répète une fois à blanc avant d'en avoir besoin : une sauvegarde jamais restaurée
n'est pas une sauvegarde, c'est une intention.

**Les snapshots Hetzner** (~20 % du prix de l'instance) ne protègent que la
machine, c'est-à-dire ce qui se reconstruit déjà depuis le dépôt et le
`Dockerfile`. Ils font gagner une heure de réinstallation, pas une ligne de
planning.

Une purge existe par ailleurs, et elle supprime pour de bon. Voir
[docs/rgpd/README.md](docs/rgpd/README.md) : `retention_preview()` avant
`retention_purge()`, toujours.

---

## Ce qui reste vrai après ce déploiement

Le conteneur règle l'hébergement, pas l'architecture. Restent, dans l'ordre :

1. ~~**Base de données et authentification**~~ — fait. Supabase porte les
   données et les comptes, les dépôts reçoivent leur `store_id` d'une session
   vérifiée, et les politiques RLS doublent la barrière. Reste à **confirmer que
   le projet Supabase est bien dans l'Union**, ce qui se lit dans son tableau de
   bord et conditionne tout le dossier `docs/rgpd/`.
2. **Les verrous**, que le moteur actuel déclare ne pas tenir.
3. **Le filet d'erreur** : `error.tsx` et `global-error.tsx` existent
   désormais. Restent le `try/catch` sur les écritures de stockage et le plafond
   de l'historique des plannings.

## Si le serveur devient une corvée

Alternative sans machine à administrer : **Fly.io**, région `cdg` (Paris),
`shared-cpu-1x` avec 1 Go, ~5,70 $/mois, et l'arrêt automatique entre deux
utilisations. Le même `Dockerfile` fonctionne tel quel ; seule la compilation
doit passer par le constructeur distant de Fly, la machine d'exécution étant
trop petite pour `next build`.
