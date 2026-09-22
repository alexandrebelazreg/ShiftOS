import copy
import unittest

from test_market_zone import _zone
from shiftos_highs.quality import Quality
from shiftos_highs.evaluate import evaluate
from shiftos_highs.fingerprint import fingerprint_problem
from shiftos_highs.sequence import streak_windows
from shiftos_highs_fast.shifts import Segment, _sector_patterns
from shiftos_highs_fast.pipeline import solve_fast


def assignment(employee='c0-1', start=540, end=780, sector='c0', day='2026-07-20'):
    return {'employeeId': employee, 'date': day,
            'segments': [{'startMinutes': start, 'endMinutes': end}],
            'sectorAssignments': [{'sectorId': sector, 'startMinutes': start, 'endMinutes': end}]}


class QualityPolicyTests(unittest.TestCase):
    def test_window_splitting_does_not_change_quality(self):
        problem = _zone(1)
        assignments = [assignment()]
        before = Quality(problem).score(assignments)
        slot = problem['demandSlots'][0]
        problem['demandSlots'] = [dict(slot, id='morning', endMinutes=780),
                                  dict(slot, id='evening', startMinutes=780)]
        self.assertEqual(before, Quality(problem).score(assignments))

    def test_opening_darkness_costs_more_than_afternoon_darkness(self):
        quality = Quality(_zone(1))
        self.assertLess(quality.score([assignment()]), quality.score([assignment(start=780, end=1020)]))

    def test_fairness_is_active_per_sector_and_preserves_coverage_priority(self):
        problem = _zone(1)
        problem['sectors'][0]['closingFairness'] = {'balanceClosings': True, 'balanceSaturdayClosings': True, 'lookbackWeeks': 4}
        problem['closingHistory'] = [{'sectorId': 'c0', 'employeeId': 'c0-1', 'closings': 12,
                                     'opportunities': 20, 'saturdayClosings': 0, 'saturdayOpportunities': 20}]
        quality = Quality(problem)
        fair = [assignment(), assignment('c0-2', 780, 1020)]
        unfair = [assignment('c0-2'), assignment('c0-1', 780, 1020)]
        self.assertLess(quality.score(fair), quality.score(unfair))
        result = solve_fast(problem, time_limit_seconds=5)
        self.assertIsNotNone(result['solution'])
        assignments = result['solution']['assignments']
        self.assertTrue(evaluate(problem, assignments)['validHardConstraints'])
        self.assertLessEqual(quality.score(assignments)[0], quality.score(unfair)[0])

    def test_sector_cap_filters_only_worked_sectors(self):
        problem = _zone(2)
        problem['sectors'][1]['workRules'] = {'minimumShiftMinutes': 240, 'maximumDailyMinutes': 240,
                                             'maximumContinuousMinutes': 480, 'minimumRestMinutes': 720}
        patterns = _sector_patterns(problem, problem['employees'][0], problem['days'][0], (Segment(540, 1020),), 15)
        self.assertTrue(patterns)
        self.assertTrue(all(all(block.sector_id == 'c0' for block in blocks) for blocks, _, _ in patterns))

    def test_maximum_presence_and_floor_are_independently_audited(self):
        problem = _zone(1)
        problem['demandSlots'][0]['maximumEmployees'] = 1
        problem['demandSlots'][0]['hardMinimumEmployees'] = 1
        report = evaluate(problem, [assignment(), assignment('c0-2')])
        self.assertTrue(any(v.startswith('maximum-presence') for v in report['violations']))
        self.assertTrue(any(v.startswith('hard-coverage-floor') for v in report['violations']))

    def test_previous_week_rest_filters_candidates_before_placement(self):
        problem = _zone(1)
        problem['previousWork'] = [{'employeeId': 'c0-1', 'date': '2026-07-19', 'endMinutes': 1380, 'consecutiveDays': 4}]
        early = _sector_patterns(problem, problem['employees'][0], problem['days'][0], (Segment(540, 780),), 15)
        late = _sector_patterns(problem, problem['employees'][0], problem['days'][0], (Segment(660, 900),), 15)
        self.assertFalse(early)
        self.assertTrue(late)
        self.assertTrue(any(v.startswith('rest:') for v in evaluate(problem, [assignment()])['violations']))

    def test_history_counts_only_for_configured_consecutive_day_limits(self):
        problem = _zone(1)
        problem['previousWork'] = [{'employeeId': 'c0-1', 'date': '2026-07-19', 'endMinutes': 1000, 'consecutiveDays': 6}]
        self.assertEqual(list(streak_windows(problem, 'c0-1')), [])
        problem['rules']['maximumConsecutiveWorkedDaysSource'] = 'configured'
        problem['rules']['maximumConsecutiveWorkedDays'] = 6
        self.assertEqual(list(streak_windows(problem, 'c0-1')), [(['2026-07-20'], 0)])

    def test_baseline_and_fixed_rules_change_problem_identity(self):
        problem = _zone(1)
        before = fingerprint_problem(problem)
        problem['employeeDays'][0]['fixedStartMinutes'] = 600
        self.assertNotEqual(before, fingerprint_problem(problem))
        problem['stabilityAssignments'] = [assignment()]
        quality = Quality(problem)
        self.assertLess(quality.score([assignment()]), quality.score([assignment('c0-2')]))


if __name__ == '__main__':
    unittest.main()
