"""Le même problème rend le même résultat.

Aucun étage ne fige les attributions une à une : ils figent des VALEURS. Ce
qu'ils laissent équivalent, le DERNIER le tranche — et tant que ce dernier était
« consommer le moins de renfort », il le tranchait au hasard du chemin numérique
suivi par HiGHS. Mesuré avant correction : les mêmes données présentées dans un
autre ordre déplaçaient les semaines de deux salariés sur vingt-deux.

Ce n'est pas un défaut d'affichage. Un gérant qui relance un calcul et obtient
une autre répartition, sans avoir rien changé, cesse de croire l'outil — et il a
raison, puisque rien à l'écran ne distingue alors une décision d'un tirage.

Le départage final est « au plus tôt », et le critère n'est pas neutre à dessein :
à qualité rigoureusement égale, placer les congés tôt arrête le calendrier plus
vite et laisse la fin de période disponible pour les ajustements.
"""

from __future__ import annotations

import copy
import random
import unittest

from paid_leave_solver import carries_quality, main

WEEKS = [f"2026-W{number:02d}" for number in range(26, 40)]


def _campagne(nombre: int = 18) -> dict:
    """Une équipe dont les vœux se chevauchent assez pour laisser du jeu.

    Le chevauchement est ce qui compte : sans concurrence, il n'existe qu'une
    seule attribution possible et la stabilité ne prouverait rien.

    DIX-HUIT, ET PAS NEUF. La première écriture de ce fichier en prenait neuf, et
    les deux tests de stabilité passaient AUSSI sans le départage final — le
    problème était assez contraint pour n'avoir qu'un optimum. Mesuré sur la
    version sans départage : rien ne bouge à neuf ni à quatorze, deux à quatre
    salariés changent de semaines à dix-huit. Un test de stabilité qui ne peut
    pas être instable ne prouve rien.
    """
    employes = []
    for index in range(nombre):
        depart = 28 + (index % 4)
        cible = 2 + (index % 2)
        employes.append(
            {
                "id": f"e{index}",
                "name": f"Salarié {index}",
                "sectorId": "drive",
                "contractHours": [35.0, 30.0, 24.0][index % 3],
                "targetWeeks": cible,
                "linkedEmployeeId": None,
                "seniorityOrder": nombre - index,
                "firstChoiceHistory": index % 3,
                "plans": [
                    {
                        "rank": 1,
                        "weekIds": [f"2026-W{n:02d}" for n in range(depart, depart + cible)],
                    },
                    {
                        "rank": 2,
                        "weekIds": [f"2026-W{n:02d}" for n in range(34 + (index % 3), 34 + (index % 3) + cible)],
                    },
                ],
            }
        )
    base = sum(employe["contractHours"] for employe in employes)
    return {
        "campaignId": "test-stabilite",
        "timeoutSeconds": 60,
        "weeks": WEEKS,
        "sectors": [{"id": "drive", "name": "Drive"}],
        "employees": employes,
        "coverage": [
            {
                "sectorId": "drive",
                "weekId": week,
                "baseContractHours": base,
                # Assez serré pour que tout le monde ne parte pas quand il veut.
                "minimumHours": round(base * 0.70, 2) if 28 <= int(week[-2:]) <= 35 else 0.0,
                "toleratedDeficitHours": round(base * 0.10, 2),
            }
            for week in WEEKS
        ],
        "reinforcementPools": [],
    }


def _attributions(response: dict) -> dict:
    return {identifiant: sorted(weeks) for identifiant, weeks in response["grants"].items()}


class Determinism(unittest.TestCase):
    def test_lordre_de_presentation_ne_change_rien(self) -> None:
        """Salariés et couverture mélangés : la réponse ne bouge pas d'une semaine.

        L'ordre d'entrée est le seul levier dont dispose un test pour faire
        varier le chemin du solveur sans changer le problème. S'il déplace une
        attribution, c'est qu'un étage tranche au hasard.
        """
        reference = _campagne()
        attendu = _attributions(main(copy.deepcopy(reference)))

        for graine in range(4):
            melange = copy.deepcopy(reference)
            random.Random(100 + graine).shuffle(melange["employees"])
            random.Random(200 + graine).shuffle(melange["coverage"])
            self.assertEqual(
                _attributions(main(melange)),
                attendu,
                f"le mélange {graine} a changé la répartition",
            )

    def test_deux_executions_identiques_rendent_la_meme_chose(self) -> None:
        """Le cas le plus simple, et celui qu'un gérant vérifie en premier."""
        probleme = _campagne()
        premier = main(copy.deepcopy(probleme))
        second = main(copy.deepcopy(probleme))
        self.assertEqual(_attributions(premier), _attributions(second))
        self.assertEqual(premier["objectiveValues"], second["objectiveValues"])

    def test_a_qualite_egale_les_semaines_les_plus_tot(self) -> None:
        """Deux paires également bonnes : c'est la première du calendrier.

        Éprouvé au niveau du SOLVEUR, où une cible plus courte que le plan est
        parfaitement licite. L'écran, lui, déduit la cible de la taille du plan —
        mais le solveur ne doit pas s'appuyer sur cette coïncidence pour savoir
        quoi faire.
        """
        probleme = _campagne(nombre=1)
        probleme["employees"][0]["targetWeeks"] = 2
        probleme["employees"][0]["plans"] = [
            {
                "rank": 1,
                "weekIds": ["2026-W30", "2026-W31", "2026-W34", "2026-W35"],
            },
        ]
        for cellule in probleme["coverage"]:
            cellule["minimumHours"] = 0.0
            cellule["toleratedDeficitHours"] = 0.0

        response = main(probleme)
        self.assertEqual(response["status"], "optimal")
        self.assertEqual(response["grants"]["e0"], ["2026-W30", "2026-W31"])

    def test_le_passage_d_annee_ne_renverse_pas_lordre(self) -> None:
        """S52 précède S01 dans une campagne d'hiver, et le numéro ISO ment.

        Le départage lit la POSITION dans les semaines de la campagne. Lu sur le
        numéro, il placerait « au plus tôt » en janvier de l'année suivante.
        """
        hiver = [f"2026-W{n:02d}" for n in range(50, 53)] + [
            f"2027-W{n:02d}" for n in range(1, 5)
        ]
        probleme = _campagne(nombre=1)
        probleme["weeks"] = hiver
        probleme["employees"][0]["targetWeeks"] = 2
        probleme["employees"][0]["plans"] = [
            {
                "rank": 1,
                "weekIds": ["2026-W51", "2026-W52", "2027-W02", "2027-W03"],
            },
        ]
        probleme["coverage"] = [
            {
                "sectorId": "drive",
                "weekId": week,
                "baseContractHours": 35.0,
                "minimumHours": 0.0,
                "toleratedDeficitHours": 0.0,
            }
            for week in hiver
        ]

        response = main(probleme)
        self.assertEqual(response["grants"]["e0"], ["2026-W51", "2026-W52"])

    def test_seuls_les_departages_peuvent_manquer_de_temps_sans_tout_perdre(self) -> None:
        """Quels étages peuvent être abandonnés, et lesquels jamais.

        Les deux derniers ne portent aucune qualité : ni semaines servies, ni
        rangs de vœux, ni couverture, ni équité. Les laisser faire échouer un
        calcul entièrement prouvé par ailleurs serait absurde. Tous les autres
        doivent au contraire faire échouer : une campagne dont la couverture n'a
        pas été prouvée n'est pas une campagne.

        Éprouvé sur la règle elle-même, sans MILP : la branche ne se déclenche
        que sur une campagne assez lourde pour épuiser son budget, ce qu'un test
        unitaire ne peut provoquer sans devenir instable.
        """
        for etage in ("calendar_position", "tie_break"):
            self.assertFalse(carries_quality(etage), etage)
        for etage in (
            "unserved_weeks",
            "priority_common_weeks",
            "priority_seniority",
            "extra_plans",
            "first_choice_served",
            "waiting_cleared",
            "plan_rank",
            "coverage_deficit",
            "leave_blocks",
            "reinforcement_used",
        ):
            self.assertTrue(carries_quality(etage), etage)

    def test_un_calcul_complet_annonce_son_departage_prouve(self) -> None:
        """Le cas normal : le drapeau vaut un, et la réponse est reproductible."""
        response = main(_campagne())
        self.assertEqual(response["objectiveValues"]["tie_break_proven"], 1.0)


if __name__ == "__main__":
    unittest.main()
