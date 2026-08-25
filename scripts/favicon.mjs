/**
 * Engendre `app/favicon.ico` depuis `app/icon.svg`.
 *
 *     npm run favicon
 *
 * Pourquoi les deux fichiers existent. Le SVG est l'icône que servent les
 * navigateurs modernes, à n'importe quelle taille et sans perte. Le `.ico` ne
 * sert qu'à `/favicon.ico`, que les navigateurs demandent sans qu'on le leur
 * dise et que quantité d'outils vont chercher là et nulle part ailleurs.
 *
 * Pourquoi un script plutôt qu'un binaire déposé une fois. Les deux fichiers
 * doivent montrer la MÊME marque. Dessinés séparément, ils divergent au premier
 * ajustement, et personne ne s'en aperçoit : le `.ico` ne s'ouvre pas dans un
 * éditeur, il ne se relit pas dans une revue, et il continue d'afficher
 * l'ancienne version dans l'onglet pendant des mois. Ici, le SVG est la source,
 * et ceci le regénère.
 *
 * `sharp` arrive par Next, qui en dépend pour l'optimisation d'images. Il n'est
 * donc PAS déclaré dans `package.json` : ce script est un outil d'atelier, pas
 * une étape de compilation, et rien dans le build ni dans les tests ne
 * l'appelle. Si Next cesse un jour de l'embarquer, l'import échouera ici, au
 * moment où quelqu'un lance la commande — jamais en production.
 *
 * Un `.ico` est une enveloppe : un en-tête, une entrée par taille, puis les
 * images. Depuis Vista elles peuvent être des PNG plutôt que des bitmaps, ce
 * qui évite d'écrire un encodeur BMP pour trois icônes.
 */
import { readFile, writeFile } from "node:fs/promises"

import sharp from "sharp"

const SOURCE = "app/icon.svg"
const TARGET = "app/favicon.ico"

/**
 * 16 pour l'onglet, 32 pour les écrans à forte densité et la barre des tâches,
 * 48 pour les raccourcis Windows. Au-delà, le SVG prend le relais partout où
 * la taille compte.
 */
const SIZES = [16, 32, 48]

/** Densité de rastérisation : assez haute pour que le 48 px ne soit pas flou. */
const DENSITY = 384

const svg = await readFile(SOURCE)

const images = await Promise.all(
  SIZES.map(async (size) => ({
    size,
    data: await sharp(svg, { density: DENSITY })
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toBuffer(),
  }))
)

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // réservé
header.writeUInt16LE(1, 2) // 1 = icône, 2 = curseur
header.writeUInt16LE(images.length, 4)

const ENTRY_BYTES = 16
let offset = header.length + images.length * ENTRY_BYTES

const entries = images.map(({ size, data }) => {
  const entry = Buffer.alloc(ENTRY_BYTES)
  // 0 veut dire 256 dans ce format. Aucune de nos tailles n'y arrive, mais
  // écrire la règle évite d'avoir à la redécouvrir le jour où l'on ajoute 256.
  entry.writeUInt8(size === 256 ? 0 : size, 0)
  entry.writeUInt8(size === 256 ? 0 : size, 1)
  entry.writeUInt8(0, 2) // couleurs de la palette : aucune, l'image est en RGBA
  entry.writeUInt8(0, 3) // réservé
  entry.writeUInt16LE(1, 4) // plans de couleur
  entry.writeUInt16LE(32, 6) // bits par pixel
  entry.writeUInt32LE(data.length, 8)
  entry.writeUInt32LE(offset, 12)
  offset += data.length
  return entry
})

await writeFile(TARGET, Buffer.concat([header, ...entries, ...images.map((image) => image.data)]))

console.log(`${TARGET} : ${SIZES.join(", ")} px`)
