from __future__ import annotations

import json
import unittest
from pathlib import Path

from shiftos_highs.evaluate import evaluate
from shiftos_highs.fingerprint import fingerprint_problem

ROOT = Path(__file__).resolve().parents[1]


class DriveFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.problem = json.loads((ROOT / "fixtures/drive-canonical-problem.json").read_text())
        cls.reference = json.loads(
            (ROOT / "fixtures/drive-canonical-reference-solution.json").read_text()
        )

    def test_problem_fingerprint_matches_typescript(self) -> None:
        # The point of this assertion is CROSS-LANGUAGE agreement: the value is
        # the one `DRIVE_CANONICAL_FINGERPRINT` pins on the TypeScript side, and
        # the two implementations must reach it independently. Re-pin both or
        # neither — a Python-only edit would hide exactly the drift it exists to
        # catch.
        self.assertEqual(fingerprint_problem(self.problem), "p3_773bce83cf527f2f")

    def test_reference_solution_is_zero_deficit(self) -> None:
        report = evaluate(self.problem, self.reference)
        self.assertTrue(report["validHardConstraints"], report["violations"])
        self.assertEqual(report["underCoveredSlots"], 0)
        self.assertEqual(report["totalDeficitMinutes"], 0)

    def test_generated_result_is_zero_deficit_when_present(self) -> None:
        result_path = ROOT / "results/drive-canonical-highs-result.json"
        if not result_path.exists():
            self.skipTest("Run solve.py first.")
        result = json.loads(result_path.read_text())
        self.assertEqual(result["status"], "feasible")
        self.assertEqual(result["problemFingerprint"], "p3_b114fe2b5b80e957")
        self.assertTrue(result["evaluation"]["validHardConstraints"])
        self.assertEqual(result["evaluation"]["underCoveredSlots"], 0)
        self.assertEqual(result["evaluation"]["totalDeficitMinutes"], 0)


if __name__ == "__main__":
    unittest.main()
