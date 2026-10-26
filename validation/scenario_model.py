"""Executable design model only: no application, database, network or real funds.

RLock stands in for a transactional boundary. Its tests do not verify PostgreSQL
isolation, durable recovery, real authorization, webhook signatures or providers.
"""

from dataclasses import dataclass
from threading import RLock


class Rejected(Exception):
    pass


class AccountRegistry:
    def __init__(self, limit=2):
        self.limit = limit
        self.accounts = {}
        self.lock = RLock()

    def bind(self, workspace, account):
        with self.lock:
            existing = self.accounts.get(account)
            if existing:
                if existing != workspace:
                    raise Rejected("account belongs to another workspace")
                return account
            if sum(w == workspace for w in self.accounts.values()) >= self.limit:
                raise Rejected("account quota")
            self.accounts[account] = workspace
            return account


@dataclass
class Account:
    workspace: str
    active: bool = True
    epoch: int = 1
    capability: str = "verified_real"


@dataclass
class PublishJob:
    workspace: str
    account: str
    asset: str
    epoch: int
    state: str = "QUEUED"
    version: int = -1


class FakeProvider:
    def __init__(self):
        self.calls = []

    def submit(self, job_id, outcome):
        self.calls.append(job_id)
        return {"accepted": "ACCEPTED", "timeout": "UNKNOWN",
                "rejected": "FAILED_CONFIRMED"}[outcome]


class Publisher:
    def __init__(self):
        self.accounts = {"a": Account("w"), "b": Account("w"),
                         "other": Account("other")}
        self.assets = {"v1": "w", "v2": "w", "foreign": "other"}
        self.commands = {}
        self.jobs = {}
        self.intents = set()
        self.events = set()
        self.queries = []
        self.provider = FakeProvider()
        self.lock = RLock()

    def submit(self, workspace, key, targets, *, can_write=True, fault=False):
        with self.lock:
            if not can_write:
                raise Rejected("read-only role")
            targets = tuple(sorted(targets))
            if not targets or len({a for a, _ in targets}) != len(targets):
                raise Rejected("empty or duplicate account targets")
            for account, asset in targets:
                if (account not in self.accounts
                        or self.accounts[account].workspace != workspace
                        or self.assets.get(asset) != workspace):
                    raise Rejected("ownership")
            command_key = (workspace, key)
            if command_key in self.commands:
                old_targets, ids = self.commands[command_key]
                if old_targets != targets:
                    raise Rejected("idempotency conflict")
                return ids
            for account, asset in targets:
                a = self.accounts[account]
                if not a.active or a.capability != "verified_real":
                    raise Rejected("authorization or capability")
                if (workspace, account, asset) in self.intents:
                    raise Rejected("existing publication intent needs resolution")
            # Validate the entire batch before committing any records.
            ids = tuple(f"job-{len(self.jobs) + i}" for i in range(len(targets)))
            staged = {job_id: PublishJob(workspace, a, v, self.accounts[a].epoch)
                      for job_id, (a, v) in zip(ids, targets)}
            if fault:
                raise Rejected("injected transaction rollback")
            self.jobs.update(staged)
            self.commands[command_key] = (targets, ids)
            self.intents.update((workspace, a, v) for a, v in targets)
            return ids

    def dispatch(self, job_id, outcome="accepted"):
        with self.lock:
            job = self.jobs[job_id]
            if job.state != "QUEUED":
                return job.state
            account = self.accounts[job.account]
            if (not account.active or account.epoch != job.epoch
                    or account.capability != "verified_real"):
                job.state = "BLOCKED"
                return job.state
            job.state = "SUBMITTING"
            job.state = self.provider.submit(job_id, outcome)
            return job.state

    def recover(self, job_id):
        with self.lock:
            job = self.jobs[job_id]
            if job.state == "SUBMITTING":
                job.state = "UNKNOWN"

    def observe(self, job_id, event_id, version, state, *, trusted=True):
        """trusted is an input assumption, NOT a signature implementation."""
        with self.lock:
            if not trusted:
                raise Rejected("untrusted observation")
            job = self.jobs[job_id]
            event_key = ("connection-1", event_id)
            if event_key in self.events:
                return
            if version is None:
                self.events.add(event_key)
                self.queries.append(job_id)
                return
            if version <= job.version:
                self.events.add(event_key)
                return
            if state not in {"ACCEPTED", "SUCCEEDED", "FAILED_CONFIRMED"}:
                raise Rejected("unmapped external state")
            if job.state in {"SUCCEEDED", "FAILED_CONFIRMED", "BLOCKED"}:
                # Terminal contradictions require reconciliation, never replay.
                self.events.add(event_key)
                if job.state != state:
                    self.queries.append(job_id)
                return
            self.events.add(event_key)
            job.version, job.state = version, state

    def summary(self, ids):
        states = [self.jobs[i].state for i in ids]
        if any(s not in {"SUCCEEDED", "FAILED_CONFIRMED", "BLOCKED"}
               for s in states):
            return "PENDING"
        if all(s == "SUCCEEDED" for s in states):
            return "SUCCEEDED"
        return "PARTIAL" if "SUCCEEDED" in states else "FAILED"


@dataclass
class Policy:
    per_order: int = 100
    per_batch: int = 100
    per_day: int = 100
    outstanding: int = 100


@dataclass
class Reservation:
    workspace: str
    day: str
    amount: int
    state: str = "HELD"
    actual: int | None = None
    revision: int = -1


class BudgetLedger:
    def __init__(self):
        self.policy = Policy()
        self.reservations = {}
        self.commands = {}
        self.frozen = set()
        self.lock = RLock()

    def daily_used(self, workspace, day):
        return sum(r.amount if r.actual is None else r.actual
                   for r in self.reservations.values()
                   if r.workspace == workspace and r.day == day)

    def outstanding_used(self, workspace):
        return sum(r.amount for r in self.reservations.values()
                   if r.workspace == workspace and r.actual is None)

    def reserve(self, workspace, key, amounts, day="2026-10-27", *,
                eligible=True, fault=False):
        # day is a server-computed fixture here, never a client-selected bucket.
        with self.lock:
            amounts = tuple(amounts)
            if not eligible:
                raise Rejected("promotion mapping, authorization or capability")
            if not amounts or any(type(n) is not int or n <= 0 for n in amounts):
                raise Rejected("amount must be positive integer cents")
            request = (amounts, day)
            command_key = (workspace, key)
            if command_key in self.commands:
                old_request, ids = self.commands[command_key]
                if old_request != request:
                    raise Rejected("idempotency conflict")
                return ids
            if workspace in self.frozen:
                raise Rejected("reconciliation freeze")
            p = self.policy
            total = sum(amounts)
            if (max(amounts) > p.per_order or total > p.per_batch
                    or self.daily_used(workspace, day) + total > p.per_day
                    or self.outstanding_used(workspace) + total > p.outstanding):
                raise Rejected("budget cap")
            ids = tuple(f"order-{len(self.reservations) + i}"
                        for i in range(len(amounts)))
            staged = {oid: Reservation(workspace, day, amount)
                      for oid, amount in zip(ids, amounts)}
            if fault:
                raise Rejected("injected transaction rollback")
            self.reservations.update(staged)
            self.commands[command_key] = (request, ids)
            return ids

    def mark_unresolved(self, order_id, state):
        with self.lock:
            if state not in {"UNKNOWN", "STOP_REQUESTED"}:
                raise Rejected("invalid unresolved state")
            r = self.reservations[order_id]
            if r.actual is not None:
                raise Rejected("already settled")
            r.state = state

    def settle(self, order_id, actual, *, final=False, revision=1):
        with self.lock:
            if not final or type(actual) is not int or actual < 0:
                raise Rejected("need confirmed final integer-cent spend")
            r = self.reservations[order_id]
            if revision <= r.revision:
                return
            r.actual, r.revision, r.state = actual, revision, "SETTLED"
            if actual > r.amount or self.daily_used(r.workspace, r.day) > self.policy.per_day:
                self.frozen.add(r.workspace)


def promotion_eligible(*, workspace, owner, public, capability, mapping):
    if (workspace != owner or not public or capability != "verified_real"
            or not mapping):
        raise Rejected("promotion precondition")
    return True


@dataclass(frozen=True)
class Metric:
    subject: str
    definition: str
    source: str
    window: str
    unit: str
    value: int | None
    kind: str = "count"


def sum_metrics(rows):
    if not rows:
        return None
    signatures = {(r.definition, r.source, r.window, r.unit, r.kind) for r in rows}
    if (len(signatures) != 1 or len({r.subject for r in rows}) != len(rows)
            or any(r.kind != "count" for r in rows)):
        raise Rejected("incomparable or overlapping observations")
    return None if any(r.value is None for r in rows) else sum(r.value for r in rows)
