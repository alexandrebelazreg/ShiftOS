# ShiftOS — image unique : le serveur Next et le solveur Python dans le même
# conteneur.
#
# Pourquoi les deux ensemble et non deux services : l'adaptateur `highs-fast`
# lance Python par `spawn` et résout ses chemins depuis `process.cwd()`. Dans un
# conteneur, c'est légitime et cela ne coûte AUCUNE modification du code — alors
# qu'en serverless c'est impossible. Le jour où le solveur devra tenir plusieurs
# magasins en parallèle, on le sortira derrière HTTP ; le contrat neutre
# `PlanningSolveAdapter` est déjà la couture pour ça.
#
# Bookworm porte Python 3.11, qui reçoit les roues manylinux de numpy 2.3 et
# scipy 1.17 : aucune compilation, donc pas de chaîne de build C dans l'image.
FROM node:22-bookworm-slim

# Le magasin raisonne en Europe/Paris (ouvertures, fériés, semaines ISO). Sans
# ça le conteneur serait en UTC et une génération lancée après 22 h basculerait
# de jour.
ENV TZ=Europe/Paris

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# L'environnement Python d'abord, et seul `requirements.txt` est copié à cette
# étape : la couche des dépendances scientifiques (~200 Mo) ne se reconstruit
# alors que si les versions épinglées changent, jamais parce qu'un composant
# React a bougé.
#
# Hors de /app, et c'est une CORRECTION, pas un rangement. Placé dans le dossier
# du projet, `bin/python` est un lien symbolique vers le Python du système :
# Turbopack analyse l'arborescence du projet en construisant, suit ce lien, le
# voit sortir de la racine et abandonne la compilation entière sur
#   « Symlink .venv-planning-highs/bin/python is invalid ».
# L'emplacement ne se devine plus, il se déclare — voir PLANNING_HIGHS_PYTHON
# plus bas, que `resolveHighsFastPython()` lit avant toute recherche.
COPY experiments/planning-v3-highs/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /opt/shiftos-venv \
 && /opt/shiftos-venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/shiftos-venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

# Même raisonnement côté npm. `npm ci` installe AUSSI les devDependencies :
# TypeScript, Tailwind et eslint-config-next sont requis par `next build`.
# C'est pourquoi NODE_ENV n'est pas encore à "production" ici — le poser avant
# cette ligne ferait sauter les devDependencies et le build échouerait.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# `output: "standalone"` n'est délibérément PAS utilisé. Il déplace le serveur
# dans `.next/standalone`, donc `process.cwd()` n'est plus la racine du projet —
# et `resolveWorkingDirectory()` cherche `experiments/planning-v3-highs` à
# partir de là. L'image est plus grosse, le solveur trouve ses fichiers.
ENV NODE_ENV=production
# Explicite plutôt que déduit : `resolveHighsFastPython()` lit cette variable en
# premier et ne retombe sur une recherche de venv qu'à défaut. Nommer
# l'interpréteur ici, c'est garantir qu'une image qui démarre est une image dont
# le solveur est joignable.
ENV PLANNING_HIGHS_PYTHON=/opt/shiftos-venv/bin/python3
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

# `-H 0.0.0.0` explicite : lié à la seule boucle locale, le conteneur
# répondrait à l'intérieur et resterait muet pour le reverse proxy.
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
