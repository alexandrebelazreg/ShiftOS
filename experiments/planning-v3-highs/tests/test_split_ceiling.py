"""Le droit de couper n'oblige pas à couper.

Le 11/11/2026, le Drive ouvrait de 8 h 30 à 13 h (270 min). Une personne
AUTORISÉE à couper plafonnait à 270 − 45 = 225 min — le plafond d'une journée
coupée —, sous son minimum de 240 : la cellule (240, 225) n'avait aucune valeur,
et toute la S46 était « impossible à planifier ». Une journée de 270 min sans
pause était pourtant légale.
"""

from __future__ import annotations

import unittest

from shiftos_highs.demand import _daily_ceiling

RULES = {
    "maximumShiftMinutes": 600, "maximumContinuousMinutes": 480,
    "splitShiftAllowed": True, "maximumSplitsPerDay": 1, "minimumSplitMinutes": 45,
}
SPLITTER = {"maximumDailyMinutes": 600, "canSplitShift": True}
NON_SPLITTER = {"maximumDailyMinutes": 600, "canSplitShift": False}


def _entry(start: int, end: int) -> dict:
    return {"earliestStartMinutes": start, "latestEndMinutes": end, "maximumMinutes": end - start}


class SplitCeilingTests(unittest.TestCase):
    def test_a_short_day_keeps_its_uninterrupted_ceiling(self) -> None:
        self.assertEqual(_daily_ceiling(SPLITTER, _entry(510, 780), RULES), 270)

    def test_an_ordinary_day_still_counts_the_split(self) -> None:
        # 6 h → 20 h : la journée coupée va plus loin (600) que d'un seul
        # tenant (480). Rien ne change pour les jours ordinaires.
        self.assertEqual(_daily_ceiling(SPLITTER, _entry(360, 1200), RULES), 600)

    def test_a_non_splitter_is_untouched(self) -> None:
        self.assertEqual(_daily_ceiling(NON_SPLITTER, _entry(360, 1200), RULES), 480)
        self.assertEqual(_daily_ceiling(NON_SPLITTER, _entry(510, 780), RULES), 270)


if __name__ == "__main__":
    unittest.main()
