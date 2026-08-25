# Registre des activités de traitement

Une seule activité : **planifier le temps de travail d'un magasin**. Ce document
est l'entrée de registre correspondante, remplie depuis le schéma réel de la
base et non depuis un modèle. Article 30 du RGPD.

Les champs marqués **À COMPLÉTER** ne peuvent pas être déduits du code. Ils
attendent une décision, pas une relecture.

---

## Identification

| | |
|---|---|
| Responsable du traitement | **À COMPLÉTER** — la société qui exploite le magasin, avec son SIREN et son adresse. Ce n'est pas Planiteo : l'outil ne décide ni des finalités ni des moyens, il les exécute. |
| Délégué à la protection des données | **À COMPLÉTER** — le DPO du groupe s'il existe, sinon la mention « aucun DPO désigné ». |
| Contact pour les droits | **À COMPLÉTER** — l'adresse à laquelle un salarié écrit pour demander l'accès, la rectification ou l'effacement. Doit figurer à l'identique dans la note d'information. |
| Date de rédaction | 25 août 2026 |

## Finalité

Établir les plannings hebdomadaires, tenir le décompte des absences, organiser
le tour de permanence et répartir les congés payés.

Le traitement ne sert **pas** à évaluer les salariés. Aucun champ ne porte de
note de performance, aucun écran ne classe les personnes, et le solveur optimise
la couverture d'un rayon, jamais un rendement individuel. C'est une limite du
traitement, à tenir : y ajouter un indicateur de productivité en changerait la
nature et la base légale.

## Base légale

Trois fondements, selon la donnée.

**Exécution du contrat de travail** (art. 6.1.b) pour l'identité, les
coordonnées, la durée contractuelle et les jours travaillés. Sans ces données,
il n'y a pas de planning possible.

**Obligation légale** (art. 6.1.c) pour le décompte du temps de travail et la
conservation des plannings, que le Code du travail impose à l'employeur.

**Consentement** (art. 6.1.a) pour le travail du dimanche, et pour lui seul. Les
champs `sundayWork`, `sundayCommitment`, `maxSundaysPerMonth` et
`sundayCompensation` enregistrent un accord donné, un plafond accepté et une
contrepartie choisie. Ce consentement est révocable : le retirer doit vider ces
quatre champs, pas seulement cesser de programmer la personne le dimanche.

## Personnes concernées

Les salariés du magasin, présents et passés, tant que leur fiche n'a pas été
supprimée. Environ cinq à trente personnes selon le magasin.

Les managers disposant d'un compte sont aussi concernés, au titre de la table
`profiles` (identifiant, adresse e-mail, nom, magasin de rattachement).

## Catégories de données

### Ordinaires

| Catégorie | Où | Détail |
|---|---|---|
| Identité | `employees` | nom, prénom |
| Coordonnées | `employees` | adresse e-mail, téléphone (facultatifs tous les deux) |
| Contrat | `employees` | type de contrat, durée hebdomadaire en minutes, jours travaillés, statut étudiant, forfait jour |
| Contraintes de service | `employees.profile` | jours de repos fixes, jours interdits, heures de prise et de fin de poste, aptitude à ouvrir et fermer, coupures autorisées |
| Compétences | `employees.profile` | secteurs maîtrisés et compétences par secteur |
| Permanence | `employees.profile` | participation au tour, jours imposés ou préférés, plafond de fermetures, statut de dépannage |
| Dimanche | `employees.profile` | accord, cadence acceptée, contrepartie |
| Planification | `plannings`, `permanences`, `paid_leave_campaigns` | horaires affectés semaine par semaine, tours de permanence, ordres de départ en congé |
| Comptes | `profiles` | e-mail, nom, rôle, magasin |

### Sensibles, au sens de l'article 9

Ce sont les seules qui font de ce registre autre chose qu'une formalité.

| Donnée | Où | Ce qu'elle révèle |
|---|---|---|
| Absence de motif `sick_leave` | `absences.type` | un arrêt de travail, donc l'état de santé, rattaché à une personne nommée et à des dates |
| Absence de motif `work_accident` | `absences.type` | un accident du travail ou de trajet |
| Absence de motif `maternity` | `absences.type` | une grossesse ou une naissance |
| Aménagement `therapeutic_part_time` | `employees.profile.arrangement` | un mi-temps thérapeutique, c'est-à-dire une prescription médicale en cours, avec ses dates et sa quotité |
| Absence de motif `delegation` | `absences.type` | des heures de délégation, donc un mandat de représentant du personnel ou une activité syndicale |

Le dernier point est le plus facile à manquer : les heures de délégation
ressemblent à une ligne d'organisation du temps, et elles disent en réalité
qu'une personne exerce un mandat. Cette donnée relève de l'article 9 au même
titre qu'un arrêt maladie.

### Zones de texte libre

Trois champs acceptent n'importe quoi : `employees.notes`, la note d'un
aménagement de contrat, et la précision obligatoire d'une absence de motif
« Autre ».

Ce sont les champs où une donnée sensible entre sans que personne ait décidé de
la collecter. « En arrêt jusqu'à son opération » dans une note libre est une
donnée de santé, écrite dans un champ qui n'a été déclaré nulle part. La règle à
tenir, et à rappeler dans la note d'information : ces zones décrivent une
contrainte d'organisation, jamais une situation personnelle ni un jugement.

## Destinataires

Les comptes rattachés au magasin, et eux seuls. Le cloisonnement est double :
une politique RLS par table filtre sur `store_id`, et chaque dépôt applicatif
reçoit son `store_id` d'une session vérifiée côté serveur.

**Point ouvert, à trancher.** L'énumération `app_role` ne contient qu'une
valeur, `manager`, et `session.role` n'est utilisé nulle part pour autoriser
quoi que ce soit. Tout compte du magasin voit donc tous les arrêts maladie et
tous les mandats. Tant qu'il n'existe qu'un compte par magasin, la conséquence
est nulle. Le jour où un second compte est créé, cela devient un défaut de
minimisation, et il faudra un rôle de consultation qui voit les horaires sans
voir les motifs.

## Sous-traitants et hébergement

| Rôle | Prestataire | Localisation |
|---|---|---|
| Base de données et authentification | Supabase | **À VÉRIFIER** — la région du projet se lit dans le tableau de bord Supabase. Elle doit être dans l'Union. |
| Serveur applicatif | Hetzner | Allemagne (Falkenstein ou Nuremberg), choisi pour cette raison |
| Solveur | aucun | le calcul tourne dans le même conteneur, aucune donnée ne sort |

Aucun appel à un tiers au moment de l'affichage. Les polices sont chargées par
`next/font/google`, qui les télécharge **à la compilation** et les sert depuis le
domaine du magasin : aucune requête vers Google, donc aucune adresse IP de
salarié transmise. C'est le piège classique du `<link>` vers Google Fonts, évité
ici par construction.

Aucune mesure d'audience, aucun traceur, aucun cookie autre que le cookie de
session Supabase. C'est ce qui dispense l'application de bandeau cookies.

## Durée de conservation

Portée par la table `retention_policies`, créée par la migration
`0006_conservation.sql`. Elle se lit en SQL, sans lire le code :

```sql
select subject, months, anchor, rationale from retention_policies;
```

Trente-six mois pour les absences, les plannings, les permanences et les
campagnes de congés. Ces durées sont un point de départ argumenté, pas une
vérité juridique : elles doivent être confrontées à la convention collective
applicable au magasin.

Les fiches salariés ne sont **pas** purgées automatiquement. Un planning
enregistré cite ses salariés par identifiant : supprimer une fiche viderait de
son sens chaque semaine passée où elle apparaît. Le départ d'un salarié se
traite par son statut, et son effacement définitif se décide à la main.

Rien n'est planifié pour l'instant. La purge se lance délibérément, après avoir
lu ce qu'elle emporterait. Voir [README.md](README.md).

## Mesures de sécurité

| Mesure | État |
|---|---|
| Row Level Security | active sur les onze tables, cloisonnement par `store_id` |
| Autorisation applicative | vérifiée côté serveur dans `features/auth/dal.ts`, traversée par chaque page, action et route |
| Mots de passe | gérés par Supabase Auth, jamais manipulés par le code applicatif |
| Transport | HTTPS via Let's Encrypt, terminé par Traefik |
| Secrets | aucun dans l'historique Git, vérifié ; seule la clé publiable existe côté client |
| Capture de problèmes réels | `PLANNING_V3_DUMP_DIR` produit des fichiers contenant noms et contrats. La variable n'est pas définie en production, et ne doit l'être que le temps d'un diagnostic |
| En-têtes de sécurité | HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` et `X-Robots-Tag: noindex` sur toutes les réponses (`next.config.ts`) |
| Politique de contenu | CSP à nonce, régénéré à chaque requête, posée par le proxy. `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`. Seule origine tierce ouverte : celle de Supabase, en `connect-src` |
| Indexation | interdite deux fois : `robots.txt` décourage l'exploration, l'en-tête `X-Robots-Tag` interdit l'indexation de ce qui serait trouvé autrement |
| Limitation des tentatives de connexion | cinq échecs par adresse et vingt par IP sur une fenêtre glissante de quinze minutes, comptés côté serveur avant tout appel à Supabase (`features/auth/login-throttle.ts`) |
| Conteneur | tourne sous l'utilisateur `node` (uid 1000), jamais en `root`. L'image ne porte que les dépendances de production, les outils de compilation étant retirés après le build |
