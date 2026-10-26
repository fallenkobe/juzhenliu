"""Adversarial design scenarios; stdlib only, no real external operations."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import unittest

from scenario_model import (
    AccountRegistry, BudgetLedger, Metric, Publisher, Rejected,
    promotion_eligible, sum_metrics,
)


class ArchitectureScenarios(unittest.TestCase):
    def test_S01_concurrent_binding_cannot_exceed_quota(self):
        registry = AccountRegistry(limit=2)
        def bind(i):
            try:
                registry.bind("w", str(i))
                return True
            except Rejected:
                return False
        with ThreadPoolExecutor(max_workers=20) as pool:
            self.assertEqual(sum(pool.map(bind, range(20))), 2)
        self.assertEqual(len(registry.accounts), 2)

    def test_S02_cross_workspace_account_rejected(self):
        p = Publisher()
        with self.assertRaises(Rejected):
            p.submit("w", "k", [("other", "v1")])
        self.assertFalse(p.jobs)

    def test_S03_viewer_cannot_publish(self):
        p = Publisher()
        with self.assertRaises(Rejected):
            p.submit("w", "k", [("a", "v1")], can_write=False)
        self.assertFalse(p.commands)

    def test_S04_same_key_reuses_batch(self):
        p = Publisher()
        first = p.submit("w", "k", [("a", "v1")])
        self.assertEqual(first, p.submit("w", "k", [("a", "v1")]))
        self.assertEqual(len(p.jobs), 1)

    def test_S05_same_key_changed_content_conflicts(self):
        p = Publisher()
        p.submit("w", "k", [("a", "v1")])
        with self.assertRaises(Rejected):
            p.submit("w", "k", [("a", "v2")])
        self.assertEqual(len(p.jobs), 1)

    def test_S06_foreign_asset_rejected(self):
        p = Publisher()
        with self.assertRaises(Rejected):
            p.submit("w", "k", [("a", "foreign")])
        self.assertFalse(p.jobs)

    def test_S07_unknown_capability_blocks_real_write(self):
        p = Publisher()
        p.accounts["a"].capability = "unknown"
        with self.assertRaises(Rejected):
            p.submit("w", "k", [("a", "v1")])
        self.assertFalse(p.provider.calls)

    def test_S08_mock_capability_is_not_real_capability(self):
        p = Publisher()
        p.accounts["a"].capability = "mock"
        with self.assertRaises(Rejected):
            p.submit("w", "k", [("a", "v1")])

    def test_S09_revoked_queued_task_never_dispatches(self):
        p = Publisher()
        job, = p.submit("w", "k", [("a", "v1")])
        p.accounts["a"].active = False
        self.assertEqual(p.dispatch(job), "BLOCKED")
        self.assertFalse(p.provider.calls)

    def test_S10_new_authorization_does_not_revive_old_task(self):
        p = Publisher()
        job, = p.submit("w", "k", [("a", "v1")])
        p.accounts["a"].epoch += 1
        self.assertEqual(p.dispatch(job), "BLOCKED")
        self.assertFalse(p.provider.calls)

    def test_S11_timeout_does_not_trigger_second_write(self):
        p = Publisher()
        job, = p.submit("w", "k", [("a", "v1")])
        self.assertEqual(p.dispatch(job, "timeout"), "UNKNOWN")
        self.assertEqual(p.dispatch(job), "UNKNOWN")
        self.assertEqual(p.provider.calls, [job])

    def test_S12_new_key_cannot_bypass_unresolved_intent(self):
        p = Publisher()
        job, = p.submit("w", "k", [("a", "v1")])
        p.dispatch(job, "timeout")
        with self.assertRaises(Rejected):
            p.submit("w", "different-key", [("a", "v1")])
        self.assertEqual(len(p.provider.calls), 1)

    def test_S13_partial_batch_does_not_republish_success(self):
        p = Publisher()
        first, second = p.submit("w", "k", [("a", "v1"), ("b", "v2")])
        p.dispatch(first)
        p.observe(first, "ok", 2, "SUCCEEDED")
        p.dispatch(second, "rejected")
        self.assertEqual(p.summary((first, second)), "PARTIAL")
        p.dispatch(first)
        self.assertEqual(p.provider.calls.count(first), 1)

    def test_S14_stale_event_cannot_regress_success(self):
        p = Publisher()
        job, = p.submit("w", "k", [("a", "v1")])
        p.dispatch(job)
        p.observe(job, "new", 2, "SUCCEEDED")
        p.observe(job, "old", 1, "ACCEPTED")
        self.assertEqual(p.jobs[job].state, "SUCCEEDED")

    def test_S15_duplicate_event_processed_once(self):
        p = Publisher()
        job, = p.submit("w", "k", [("a", "v1")])
        p.dispatch(job)
        p.observe(job, "event", 2, "SUCCEEDED")
        p.observe(job, "event", 3, "FAILED_CONFIRMED")
        self.assertEqual(p.jobs[job].state, "SUCCEEDED")
        self.assertEqual(len(p.events), 1)

    def test_S16_untrusted_event_cannot_mutate_state(self):
        p = Publisher()
        job, = p.submit("w", "k", [("a", "v1")])
        with self.assertRaises(Rejected):
            p.observe(job, "forged", 1, "SUCCEEDED", trusted=False)
        self.assertEqual(p.jobs[job].state, "QUEUED")
        self.assertFalse(p.events)

    def test_S17_unversioned_notification_only_requests_query(self):
        p = Publisher()
        job, = p.submit("w", "k", [("a", "v1")])
        p.dispatch(job)
        p.observe(job, "notice", None, "SUCCEEDED")
        self.assertEqual(p.jobs[job].state, "ACCEPTED")
        self.assertEqual(p.queries, [job])

    def test_S18_crash_after_send_intent_recovers_as_unknown(self):
        p = Publisher()
        job, = p.submit("w", "k", [("a", "v1")])
        p.jobs[job].state = "SUBMITTING"
        p.recover(job)
        self.assertEqual(p.dispatch(job), "UNKNOWN")
        self.assertFalse(p.provider.calls)

    def test_S19_rollback_leaves_no_orphan_command_or_job(self):
        p = Publisher()
        with self.assertRaises(Rejected):
            p.submit("w", "k", [("a", "v1")], fault=True)
        self.assertFalse(p.commands)
        self.assertFalse(p.jobs)
        self.assertFalse(p.intents)

    def test_S20_valid_batch_has_separate_outcomes(self):
        p = Publisher()
        ids = p.submit("w", "k", [("a", "v1"), ("b", "v2")])
        for i, job in enumerate(ids):
            p.dispatch(job)
            p.observe(job, str(i), 1, "SUCCEEDED")
        self.assertEqual(p.summary(ids), "SUCCEEDED")
        self.assertEqual(len(p.provider.calls), 2)

    def test_S21_concurrent_budget_admission_respects_cap(self):
        ledger = BudgetLedger()
        def reserve(i):
            try:
                ledger.reserve("w", str(i), [30])
                return True
            except Rejected:
                return False
        with ThreadPoolExecutor(max_workers=20) as pool:
            self.assertEqual(sum(pool.map(reserve, range(20))), 3)
        self.assertEqual(ledger.daily_used("w", "2026-10-27"), 90)
        self.assertEqual(len(ledger.commands), 3)

    def test_S22_duplicate_budget_command_does_not_double_reserve(self):
        ledger = BudgetLedger()
        ids = ledger.reserve("w", "k", [60])
        self.assertEqual(ledger.reserve("w", "k", [60]), ids)
        self.assertEqual(ledger.outstanding_used("w"), 60)

    def test_S23_changed_budget_same_key_conflicts(self):
        ledger = BudgetLedger()
        ledger.reserve("w", "k", [60])
        with self.assertRaises(Rejected):
            ledger.reserve("w", "k", [70])
        self.assertEqual(ledger.outstanding_used("w"), 60)

    def test_S24_invalid_money_rejected(self):
        for amount in [0, -1, 1.5, True, "10"]:
            with self.subTest(amount=amount):
                ledger = BudgetLedger()
                with self.assertRaises(Rejected):
                    ledger.reserve("w", "k", [amount])
                self.assertFalse(ledger.reservations)

    def test_S25_per_order_and_per_batch_caps(self):
        for amounts in [[101], [60, 60]]:
            with self.subTest(amounts=amounts):
                ledger = BudgetLedger()
                with self.assertRaises(Rejected):
                    ledger.reserve("w", "k", amounts)
                self.assertFalse(ledger.reservations)

    def test_S26_stop_request_does_not_release_budget(self):
        ledger = BudgetLedger()
        order, = ledger.reserve("w", "k", [80])
        ledger.mark_unresolved(order, "STOP_REQUESTED")
        with self.assertRaises(Rejected):
            ledger.reserve("w", "new", [30])
        self.assertEqual(ledger.outstanding_used("w"), 80)

    def test_S27_unknown_payment_does_not_release_budget(self):
        ledger = BudgetLedger()
        order, = ledger.reserve("w", "k", [80])
        ledger.mark_unresolved(order, "UNKNOWN")
        self.assertEqual(ledger.daily_used("w", "2026-10-27"), 80)
        with self.assertRaises(Rejected):
            ledger.settle(order, 0, final=False)
        self.assertEqual(ledger.outstanding_used("w"), 80)

    def test_S28_midnight_does_not_clear_outstanding_risk(self):
        ledger = BudgetLedger()
        ledger.reserve("w", "day1", [80], day="2026-10-27")
        with self.assertRaises(Rejected):
            ledger.reserve("w", "day2", [30], day="2026-10-28")
        self.assertEqual(ledger.outstanding_used("w"), 80)

    def test_S29_final_spend_releases_only_unused_budget(self):
        ledger = BudgetLedger()
        order, = ledger.reserve("w", "k", [80])
        ledger.settle(order, 30, final=True)
        self.assertEqual(ledger.daily_used("w", "2026-10-27"), 30)
        self.assertEqual(ledger.outstanding_used("w"), 0)
        ledger.reserve("w", "new", [70])
        self.assertEqual(ledger.daily_used("w", "2026-10-27"), 100)

    def test_S30_repeated_or_old_settlement_does_not_release_twice(self):
        ledger = BudgetLedger()
        order, = ledger.reserve("w", "k", [80])
        ledger.settle(order, 30, final=True, revision=2)
        ledger.settle(order, 0, final=True, revision=1)
        ledger.settle(order, 0, final=True, revision=2)
        self.assertEqual(ledger.daily_used("w", "2026-10-27"), 30)

    def test_S31_external_overspend_is_recorded_and_freezes_new_orders(self):
        ledger = BudgetLedger()
        order, = ledger.reserve("w", "k", [80])
        ledger.settle(order, 120, final=True)
        self.assertEqual(ledger.daily_used("w", "2026-10-27"), 120)
        with self.assertRaises(Rejected):
            ledger.reserve("w", "next", [1], day="2026-10-28")

    def test_S32_invalid_target_rejects_entire_publish_batch(self):
        p = Publisher()
        p.accounts["b"].capability = "unknown"
        with self.assertRaises(Rejected):
            p.submit("w", "k", [("a", "v1"), ("b", "v2")])
        self.assertFalse(p.jobs)
        self.assertFalse(p.provider.calls)

    def test_S33_budget_rollback_leaves_no_reservation_or_command(self):
        ledger = BudgetLedger()
        with self.assertRaises(Rejected):
            ledger.reserve("w", "k", [40, 40], fault=True)
        self.assertFalse(ledger.reservations)
        self.assertFalse(ledger.commands)

    def test_S34_workspace_budget_and_keys_are_isolated(self):
        ledger = BudgetLedger()
        ledger.reserve("w", "same", [100])
        ledger.reserve("other", "same", [100])
        self.assertEqual(ledger.outstanding_used("w"), 100)
        self.assertEqual(ledger.outstanding_used("other"), 100)

    def test_S35_promotion_requires_owner_visibility_capability_and_mapping(self):
        valid = dict(workspace="w", owner="w", public=True,
                     capability="verified_real", mapping=True)
        self.assertTrue(promotion_eligible(**valid))
        for change in [dict(owner="other"), dict(public=False),
                       dict(capability="unknown"), dict(mapping=False)]:
            with self.subTest(change=change), self.assertRaises(Rejected):
                promotion_eligible(**(valid | change))
        ledger = BudgetLedger()
        with self.assertRaises(Rejected):
            ledger.reserve("w", "k", [10], eligible=False)
        self.assertFalse(ledger.reservations)

    def test_S36_missing_metric_is_not_zero(self):
        zero = Metric("a", "plays", "organic", "day1", "count", 0)
        self.assertEqual(sum_metrics([zero]), 0)
        self.assertIsNone(sum_metrics([zero, replace(zero, subject="b", value=None)]))

    def test_S37_incompatible_or_overlapping_metrics_cannot_be_added(self):
        metric = Metric("a", "plays", "work-total", "day1", "count", 10)
        for second in [replace(metric, subject="b", source="ad-attributed"),
                       replace(metric, subject="b", window="day2"),
                       replace(metric, subject="b", unit="percent"), metric]:
            with self.subTest(second=second), self.assertRaises(Rejected):
                sum_metrics([metric, second])
        with self.assertRaises(Rejected):
            sum_metrics([replace(metric, kind="ratio")])

    def test_S38_final_spend_correction_is_not_lost(self):
        ledger = BudgetLedger()
        order, = ledger.reserve("w", "k", [80])
        ledger.settle(order, 30, final=True, revision=1)
        ledger.settle(order, 45, final=True, revision=2)
        self.assertEqual(ledger.daily_used("w", "2026-10-27"), 45)

    def test_S39_lowered_budget_blocks_new_authorization(self):
        ledger = BudgetLedger()
        ledger.reserve("w", "old", [80])
        ledger.policy.per_day = 50
        with self.assertRaises(Rejected):
            ledger.reserve("w", "new", [1])
        self.assertEqual(ledger.outstanding_used("w"), 80)

    def test_S40_duplicate_bind_is_idempotent_but_cannot_change_owner(self):
        registry = AccountRegistry(limit=1)
        registry.bind("w", "a")
        registry.bind("w", "a")
        with self.assertRaises(Rejected):
            registry.bind("other", "a")
        self.assertEqual(registry.accounts, {"a": "w"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
