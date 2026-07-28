# Résultats — solveur ShiftOS Python/SciPy/HiGHS

## Parité canonique Drive

- Empreinte problème : `p3_f5a81f5b6eacfcff`
- Empreinte solution : `s3_e9c6e98a1700d926`
- Créneaux sous-couverts : **0**
- Déficit : **0 minute**
- Contraintes dures : **valides**
- Candidats générés : **28 542**
- Temps MILP : **14.82 s**
- Temps total : **15.73 s**

Le validateur TypeScript officiel a recalculé : `validHardConstraints=true`, `underCoveredSlots=0`, `totalDeficitMinutes=0`, sans violation.

## Planning produit

| Salarié | 2026-07-20 | 2026-07-21 | 2026-07-22 | 2026-07-23 | 2026-07-24 | 2026-07-25 |
|---|---|---|---|---|---|---|
| arthur | 06:00-11:15 | 14:00-20:00 | 12:00-20:00 | Repos | 06:30-11:00 / 12:30-18:00 | 06:00-13:30 |
| dylan | 08:00-12:00 | 08:00-12:00 | 10:00-17:00 | 09:45-17:00 | 12:00-20:00 | 13:30-20:00 |
| erwan | 06:00-12:00 | 06:00-10:15 | 06:00-12:15 | 06:00-12:15 | 06:00-14:00 | 06:00-12:00 |
| luca | 13:30-20:00 | 09:45-17:00 | Repos | 12:15-20:00 | 09:00-17:00 | 06:00-13:15 |
| valentin | 11:15-17:00 | 06:00-12:00 | 06:00-12:15 | 06:00-12:15 | 06:00-12:30 | 06:00-12:00 |

## Déterminisme

Trois processus séparés ont produit la même empreinte `s3_e9c6e98a1700d926`.

| Exécution | Temps | Créneaux | Déficit | Empreinte |
|---:|---:|---:|---:|---|
| 1 | 14.06 s | 0 | 0 | `s3_e9c6e98a1700d926` |
| 2 | 15.24 s | 0 | 0 | `s3_e9c6e98a1700d926` |
| 3 | 14.26 s | 0 | 0 | `s3_e9c6e98a1700d926` |
