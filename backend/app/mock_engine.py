"""
Deterministic, in-memory mock Salesforce dataset for the Axon CS Command Center.

The frontend issues a small, fixed set of SOQL query "shapes" (renewals, org/User
chain, open-case aggregates, lifetime-case aggregates, closed-won deal aggregates,
per-account deal/product/communication lookups). Rather than parsing SOQL for real,
this module pattern-matches those known shapes against a seeded synthetic dataset so
the whole app is fully interactive without any live Salesforce connection.

Swap to real Salesforce later by setting DATA_MODE=salesforce in backend/.env - no
frontend changes needed, since /api/soql always returns the same {"records": [...]}
shape regardless of which engine served it.
"""
from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from .config import settings

PRIORITIES = ["Low", "Medium", "High", "Urgent"]

# Segments + growth taxonomy reflect guidance from a CS-leadership interview (see
# ../../NOTES.md): accounts are worked in tiers with different required outreach
# cadence, and "growth" is split into organic/renewal, expansion (net-new product),
# and transactional (more of what they already have) rather than one lump number.
SEGMENTS = ["Strategic", "Enterprise", "Mid-Market", "SMB"]
GROWTH_TYPES = ["Renewal", "Expansion", "Transactional"]

# TAP (Technology Assurance Plan) hardware families - per Leana's stakeholder
# finding: TAP is a hardware-warranty refresh motion, due at the 2.5-year
# midpoint of a 5-year contract. SAAS/Training/COMMANDER are software, not
# hardware, so they don't carry a TAP refresh cycle.
TAP_HARDWARE_FAMILIES = ["Cart", "FLEX 2", "X26", "BODYCAM3", "FLEET", "AIR", "INTERVIEW"]

# Seat/device-based product families whose adoption a CSM actually tracks (active
# users / active devices vs. what was provisioned). Consumables (Cart) and
# one-off Training engagements aren't seat-adoption motions, so they're excluded.
ADOPTION_PRODUCTS = ["SAAS", "BODYCAM3", "FLEET", "AIR", "INTERVIEW", "COMMANDER", "FLEX 2"]
# Provisioned-seat ranges by segment - bigger agencies license far more seats.
SEAT_SCALE = {
    "Strategic": (120, 900),
    "Enterprise": (60, 400),
    "Mid-Market": (20, 140),
    "SMB": (5, 45),
}

STAGES_EARLY = ["Discovering", "Pre Sales", "Interest", "Qualifying", "Evaluation/Scoping", "Prospecting"]
STAGES_LATE = ["Value Proposition", "Proposal/Price Quote", "Negotiation/Review", "Contract Sent", "Verbal Commit"]

PRODUCT_CATALOG = {
    "SAAS": ["Evidence.com Standard License", "Evidence.com Advanced Analytics", "Evidence.com Redaction Suite"],
    "Cart": ["TASER 7 Cartridges (25-pack)", "TASER 10 Cartridges (25-pack)"],
    "Training": ["Axon Academy Training - Onsite", "De-escalation Training Bundle", "Virtual Reality Training Module"],
    "INTERVIEW": ["Axon Interview Recording System"],
    "FLEX 2": ["Axon Flex 2 Body Camera"],
    "X26": ["TASER X26P"],
    "COMMANDER": ["TASER Commander Software"],
    "BODYCAM3": ["Axon Body 3 Camera", "Axon Body 4 Camera"],
    "FLEET": ["Axon Fleet 3 In-Car Video System"],
    "AIR": ["Axon Air Drone Program"],
}

CITY_NAMES = [
    "Springfield", "Riverside", "Fairview", "Oakdale", "Georgetown", "Lakewood", "Clayton", "Milton",
    "Ashford", "Brookhaven", "Cedar Falls", "Dunmore", "Elkridge", "Franklin", "Greenville", "Hartwell",
    "Ironwood", "Jasper", "Kingsley", "Lonestar", "Marion", "Newport", "Ortega", "Pinehurst", "Quincy",
    "Ridgefield", "Sutterville", "Thornbury", "Union City", "Vernon", "Westgate", "Yardley", "Zionsville",
    "Bellmont", "Crestwood", "Deerfield", "Eastport", "Fallon", "Glenwood", "Harborview", "Ivywood",
]
AGENCY_TYPES = [
    "Police Department", "County Sheriff's Office", "Metro Transit Police", "Fire & Rescue",
    "Public Safety Dept.", "Sheriff's Department", "Highway Patrol", "Correctional Facility",
]
US_STATES = ["CA", "TX", "FL", "NY", "WA", "CO", "AZ", "OH", "GA", "NC", "MI", "PA", "IL", "OR", "TN", "VA"]

FIRST_NAMES = ["Jordan", "Casey", "Morgan", "Taylor", "Avery", "Riley", "Cameron", "Jamie", "Drew", "Skyler",
               "Reese", "Quinn", "Rowan", "Emerson", "Hayden", "Parker", "Sawyer", "Blair", "Dana", "Kendall"]
LAST_NAMES = ["Whitfield", "Marsh", "Delgado", "Nakamura", "Okafor", "Bergstrom", "Alvarado", "Choudhury",
              "Fitzgerald", "Renner", "Castellano", "Voss", "Abernathy", "Kowalski", "Larkspur", "Meszaros"]

TASK_SUBJECTS = [
    "Email: Renewal check-in", "Email: Quarterly usage recap", "Call: Onboarding kickoff",
    "Call: Escalation follow-up", "Email: Training scheduling", "Call: Executive alignment",
    "Email: Contract question", "Call: Support case follow-up", "Email: Product update announcement",
]
TASK_SUBTYPES = ["Email", "Call", "Task", "ListEmail"]
EVENT_SUBJECTS = ["QBR - Quarterly Business Review", "Onboarding kickoff meeting", "Renewal strategy session",
                   "Executive sponsor check-in", "Training session"]


def _id(prefix: str, n: int) -> str:
    return f"{prefix}{n:015d}"


@dataclass
class MockUser:
    id: str
    name: str
    title: str
    manager_id: str | None


@dataclass
class MockAccount:
    id: str
    name: str
    state: str
    owner_id: str
    last_activity_date: str | None
    segment: str = "Mid-Market"
    renewal_opps: list[dict] = field(default_factory=list)
    open_cases: dict[str, int] = field(default_factory=dict)
    lifetime_cases: dict[tuple[str, bool], int] = field(default_factory=dict)
    blocked_cases: int = 0
    aging_cases: int = 0
    nps_score: int | None = None
    nps_survey_date: str | None = None
    hw_first_purchase: str | None = None  # earliest closed-won hardware (TAP-eligible) line item date
    won_deals: list[dict] = field(default_factory=list)
    line_items: list[dict] = field(default_factory=list)
    tasks: list[dict] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)
    # Product usage / adoption. Per Beatrice's (CSM) stakeholder finding, this is
    # the single biggest gap in Gainsight today: usage/adoption data lives in the
    # product-analytics Snowflake and is surfaced through Sigma reports, not in
    # Salesforce - so it's a periodic (manual) export rather than a live feed.
    usage: dict = field(default_factory=dict)


class MockDataset:
    def __init__(self, seed: int, account_count: int):
        self.rng = random.Random(seed)
        self.today = date.today()
        self.users: dict[str, MockUser] = {}
        self.accounts: dict[str, MockAccount] = {}
        self._build_org(account_count)
        self._build_accounts(account_count)

    # ---------- construction ----------
    def _build_org(self, account_count: int) -> None:
        rng = self.rng
        uid = 1

        def mk(name, title, manager_id):
            nonlocal uid
            u = MockUser(id=_id("USR", uid), name=name, title=title, manager_id=manager_id)
            uid += 1
            self.users[u.id] = u
            return u

        vp = mk("Dana Whitfield", "VP, Global Customer Success", None)
        directors = []
        for i in range(3):
            directors.append(mk(f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}", "Director, Customer Success", vp.id))
        managers = []
        for d in directors:
            for i in range(rng.randint(2, 3)):
                managers.append(mk(f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}", "Manager, Customer Success", d.id))
        csms = []
        needed_csms = max(6, account_count // 4)
        for i in range(needed_csms):
            mgr = rng.choice(managers)
            csms.append(mk(f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}", "Customer Success Manager", mgr.id))
        self._csms = csms

    def _random_stage(self, days_to_close: int) -> str:
        rng = self.rng
        if rng.random() < 0.22:
            return rng.choice(STAGES_EARLY)
        return rng.choice(STAGES_LATE)

    def _build_accounts(self, account_count: int) -> None:
        rng = self.rng
        used_names: set[str] = set()

        def uniq_name() -> str:
            for _ in range(50):
                nm = f"{rng.choice(CITY_NAMES)} {rng.choice(AGENCY_TYPES)}"
                if nm not in used_names:
                    used_names.add(nm)
                    return nm
            return f"{rng.choice(CITY_NAMES)} {rng.choice(AGENCY_TYPES)} #{rng.randint(2,99)}"

        for i in range(1, account_count + 1):
            acc_id = _id("ACC", i)
            owner = rng.choice(self._csms)
            risk_roll = rng.random()
            risk_tier = "atrisk" if risk_roll < 0.18 else ("watch" if risk_roll < 0.45 else "healthy")

            days_out = int(rng.triangular(1, 540, 120))
            close_date = self.today + timedelta(days=days_out)
            base_amount = rng.lognormvariate(11.2, 0.9)  # centers roughly $70k, long tail
            amount = round(min(max(base_amount, 8000), 2_500_000), 2)
            stage = self._random_stage(days_out)

            if amount >= 500_000:
                segment = rng.choices(SEGMENTS, weights=[0.55, 0.35, 0.08, 0.02])[0]
            elif amount >= 150_000:
                segment = rng.choices(SEGMENTS, weights=[0.15, 0.45, 0.35, 0.05])[0]
            elif amount >= 40_000:
                segment = rng.choices(SEGMENTS, weights=[0.02, 0.18, 0.50, 0.30])[0]
            else:
                segment = rng.choices(SEGMENTS, weights=[0.0, 0.05, 0.30, 0.65])[0]

            last_active_roll = rng.random()
            if last_active_roll < 0.08:
                last_activity = None
            else:
                stale_bias = {"atrisk": 260, "watch": 140, "healthy": 40}[risk_tier]
                dback = int(rng.expovariate(1 / max(stale_bias, 1)))
                last_activity = (self.today - timedelta(days=min(dback, 900))).isoformat()

            acct = MockAccount(
                id=acc_id,
                name=uniq_name(),
                state=rng.choice(US_STATES),
                owner_id=owner.id,
                last_activity_date=last_activity,
                segment=segment,
            )
            acct.renewal_opps.append({
                "Name": f"{acct.name} - Renewal {close_date.year}",
                "Amount": amount,
                "CloseDate": close_date.isoformat(),
                "StageName": stage,
            })
            if rng.random() < 0.12:
                extra_close = close_date + timedelta(days=rng.randint(-20, 60))
                acct.renewal_opps.append({
                    "Name": f"{acct.name} - Add-on Renewal",
                    "Amount": round(amount * rng.uniform(0.15, 0.5), 2),
                    "CloseDate": extra_close.isoformat(),
                    "StageName": self._random_stage((extra_close - self.today).days),
                })

            self._build_cases(acct, risk_tier)
            self._build_deals_and_products(acct, risk_tier)
            self._build_comms(acct, owner)
            self._build_nps(acct, risk_tier)
            self._build_usage(acct, risk_tier)

            self.accounts[acc_id] = acct

    def _build_cases(self, acct: MockAccount, risk_tier: str) -> None:
        rng = self.rng
        weights = {
            "atrisk": {"Low": 0.15, "Medium": 0.30, "High": 0.35, "Urgent": 0.20},
            "watch": {"Low": 0.30, "Medium": 0.40, "High": 0.22, "Urgent": 0.08},
            "healthy": {"Low": 0.45, "Medium": 0.40, "High": 0.12, "Urgent": 0.03},
        }[risk_tier]
        lifetime_total = int(rng.gammavariate(2.0, {"atrisk": 22, "watch": 12, "healthy": 6}[risk_tier]))
        if rng.random() < 0.08:
            lifetime_total = 0

        lifetime_by_pri: dict[str, int] = {}
        for pri in PRIORITIES:
            lifetime_by_pri[pri] = int(round(lifetime_total * weights[pri]))

        esc_rate = {"atrisk": 0.22, "watch": 0.1, "healthy": 0.03}[risk_tier]
        for pri, count in lifetime_by_pri.items():
            if count <= 0:
                continue
            escalated = int(round(count * esc_rate * rng.uniform(0.5, 1.5)))
            escalated = min(escalated, count)
            not_escalated = count - escalated
            if not_escalated:
                acct.lifetime_cases[(pri, False)] = not_escalated
            if escalated:
                acct.lifetime_cases[(pri, True)] = escalated

        open_caps = {"atrisk": (0, 5), "watch": (0, 3), "healthy": (0, 1)}[risk_tier]
        for pri in ["High", "Urgent"]:
            lifetime_n = lifetime_by_pri.get(pri, 0)
            if lifetime_n <= 0:
                continue
            openc = min(lifetime_n, rng.randint(*open_caps))
            if openc > 0:
                acct.open_cases[pri] = acct.open_cases.get(pri, 0) + openc
        for pri in ["Low", "Medium"]:
            lifetime_n = lifetime_by_pri.get(pri, 0)
            if lifetime_n <= 0:
                continue
            openc = min(lifetime_n, rng.randint(0, 2))
            if openc > 0:
                acct.open_cases[pri] = acct.open_cases.get(pri, 0) + openc

        # Derek's framing: of the open cases, the two things a CSM needs to jump on
        # are cases that are BLOCKED ("it's not happening") and cases that are AGING
        # ("it's been open too long") - these can overlap with the priority buckets
        # above but are tracked as their own flags since that's how the team triages.
        total_open = sum(acct.open_cases.values())
        if total_open > 0:
            blocked_rate = {"atrisk": 0.35, "watch": 0.18, "healthy": 0.06}[risk_tier]
            aging_rate = {"atrisk": 0.45, "watch": 0.25, "healthy": 0.10}[risk_tier]
            acct.blocked_cases = min(total_open, int(round(total_open * blocked_rate * rng.uniform(0.4, 1.6))))
            acct.aging_cases = min(total_open, int(round(total_open * aging_rate * rng.uniform(0.4, 1.6))))

    def _build_deals_and_products(self, acct: MockAccount, risk_tier: str) -> None:
        rng = self.rng
        is_new_logo = rng.random() < 0.16
        n_deals = 1 if is_new_logo else rng.randint(1, 6)
        cursor = self.today - timedelta(days=rng.randint(20, 340) if is_new_logo else rng.randint(400, 1500))
        families = list(PRODUCT_CATALOG.keys())
        for d in range(n_deals):
            deal_amount = round(rng.lognormvariate(10.8, 0.8), 2)
            deal_amount = min(max(deal_amount, 5000), 1_800_000)
            deal_close = cursor if d == 0 else cursor - timedelta(days=rng.randint(90, 500) * d)
            if deal_close > self.today:
                deal_close = self.today - timedelta(days=rng.randint(30, 200))
            # First deal for a given account is the new-logo sale itself, so it isn't
            # "growth" in Derek's taxonomy - it has no GrowthType. Every deal after
            # that is Renewal (organic), Expansion (net-new product attach), or
            # Transactional (bought more of something they already had).
            growth_type = None if d == 0 else rng.choices(GROWTH_TYPES, weights=[0.40, 0.25, 0.35])[0]
            acct.won_deals.append({
                "Name": f"{acct.name} - Order {deal_close.year}-{d+1}",
                "Amount": deal_amount,
                "CloseDate": deal_close.isoformat(),
                "StageName": "Closed Won",
                "GrowthType": growth_type,
            })
            n_lines = rng.randint(1, 3)
            remaining = deal_amount
            chosen_families = rng.sample(families, k=min(n_lines, len(families)))
            if any(fam in TAP_HARDWARE_FAMILIES for fam in chosen_families):
                if acct.hw_first_purchase is None or deal_close.isoformat() < acct.hw_first_purchase:
                    acct.hw_first_purchase = deal_close.isoformat()
            for idx, fam in enumerate(chosen_families):
                portion = remaining if idx == len(chosen_families) - 1 else remaining * rng.uniform(0.3, 0.6)
                portion = round(max(portion, 500), 2)
                remaining = max(remaining - portion, 0)
                qty = rng.randint(1, 40)
                acct.line_items.append({
                    "family": fam,
                    "name": rng.choice(PRODUCT_CATALOG[fam]),
                    "total_price": portion,
                    "quantity": qty,
                })
        acct.won_deals.sort(key=lambda d: d["CloseDate"])

    def _build_comms(self, acct: MockAccount, owner: MockUser) -> None:
        rng = self.rng
        n_tasks = rng.randint(3, 10)
        for _ in range(n_tasks):
            days_ago = rng.randint(1, 700)
            dt = self.today - timedelta(days=days_ago)
            subtype = rng.choice(TASK_SUBTYPES)
            acct.tasks.append({
                "Id": _id("TSK", rng.randint(1, 10_000_000)),
                "Subject": rng.choice(TASK_SUBJECTS),
                "TaskSubtype": subtype,
                "ActivityDate": dt.isoformat(),
                "CreatedDate": dt.isoformat(),
                "OwnerName": owner.name,
                "Description": f"Body: Follow-up notes regarding {acct.name.lower()} account activity and next steps discussed with the customer team.",
            })
        n_events = rng.randint(0, 4)
        for _ in range(n_events):
            days_ago = rng.randint(1, 500)
            dt = self.today - timedelta(days=days_ago)
            acct.events.append({
                "Id": _id("EVT", rng.randint(1, 10_000_000)),
                "Subject": rng.choice(EVENT_SUBJECTS),
                "EventSubtype": "Meeting",
                "StartDateTime": dt.isoformat(),
                "OwnerName": owner.name,
                "Description": "Body: Meeting notes covering account health, open items and follow-ups.",
            })

    def _build_nps(self, acct: MockAccount, risk_tier: str) -> None:
        # Leana's framing: NPS is a real, biannual survey (10% of CSM comp) that
        # already lands in a Salesforce report - unlike CSAT, this is not a
        # placeholder. Not every account has a respondent (biannual + typical
        # survey non-response), and the score skews with account health.
        rng = self.rng
        response_rate = {"atrisk": 0.45, "watch": 0.58, "healthy": 0.68}[risk_tier]
        if rng.random() >= response_rate:
            return
        score_bias = {"atrisk": (0, 7), "watch": (2, 9), "healthy": (6, 10)}[risk_tier]
        acct.nps_score = rng.randint(*score_bias)
        days_since_survey = rng.randint(1, 180)  # biannual cadence
        acct.nps_survey_date = (self.today - timedelta(days=days_since_survey)).isoformat()

    def _build_usage(self, acct: MockAccount, risk_tier: str) -> None:
        # Per Beatrice's (CSM) finding: usage/adoption is a periodic Snowflake/Sigma
        # export, so not every account has been synced yet (~12% have no usage row).
        # Adoption, trend and commission attainment all skew with account health.
        rng = self.rng
        if rng.random() < 0.12:
            acct.usage = {}
            return

        adopt_band = {"atrisk": (0.10, 0.45), "watch": (0.40, 0.72), "healthy": (0.62, 0.96)}[risk_tier]
        base_adopt = rng.uniform(*adopt_band)

        families_owned = {li["family"] for li in acct.line_items}
        prod_families = [f for f in ADOPTION_PRODUCTS if f in families_owned]
        if not prod_families:
            prod_families = ["SAAS"]  # every agency has an Evidence.com footprint

        seat_scale = SEAT_SCALE.get(acct.segment, SEAT_SCALE["Mid-Market"])
        products = []
        tot_lic = tot_act = 0
        for fam in prod_families:
            licensed = rng.randint(*seat_scale)
            pct = max(0.0, min(1.0, base_adopt + rng.uniform(-0.12, 0.12)))
            active = int(round(licensed * pct))
            products.append({
                "family": fam,
                "licensed": licensed,
                "active": active,
                "pct": round(pct * 100),
            })
            tot_lic += licensed
            tot_act += active

        overall_pct = round(tot_act / tot_lic * 100) if tot_lic else 0
        trend_band = {"atrisk": (-18, 4), "watch": (-8, 11), "healthy": (-2, 17)}[risk_tier]
        trend = rng.randint(*trend_band)

        # CSMs carry an annual attainment target per account (expansion + renewal
        # goal that feeds their commission). Attainment skews with health.
        renewal_amt = acct.renewal_opps[0]["Amount"] if acct.renewal_opps else 50000.0
        comm_target = round(renewal_amt * rng.uniform(0.12, 0.35), -2)
        attain_band = {"atrisk": (0.25, 0.75), "watch": (0.60, 1.02), "healthy": (0.85, 1.35)}[risk_tier]
        comm_attained = round(comm_target * rng.uniform(*attain_band), -2)

        days_since_sync = rng.randint(0, 13)
        acct.usage = {
            "seats_licensed": tot_lic,
            "seats_active": tot_act,
            "adoption_pct": overall_pct,
            "trend_pct": trend,
            "commission_target": comm_target,
            "commission_attained": comm_attained,
            "last_sync": (self.today - timedelta(days=days_since_sync)).isoformat(),
            "products": products,
        }

    # ---------- query handling ----------
    def _extract_quoted(self, text: str) -> list[str]:
        return re.findall(r"'([A-Za-z0-9_]+)'", text)

    def _single_account_id(self, query: str) -> str | None:
        m = re.search(r"AccountId\s*=\s*'([A-Za-z0-9_]+)'", query)
        return m.group(1) if m else None

    def handle(self, query: str) -> list[dict]:
        q = query.strip()
        qlow = q.lower()

        if "from productusage__c" in qlow:
            return self._q_usage(q)
        if "from account" in qlow and "nps" in qlow:
            return self._q_nps(q)
        if "from opportunitylineitem" in qlow and "family__c" in qlow:
            return self._q_tap(q)
        if "from user" in qlow and " id in" in qlow:
            return self._q_users(q)
        if "from opportunity" in qlow and "type='renewal'" in qlow.replace(" ", ""):
            return self._q_renewals()
        if "from opportunitylineitem" in qlow and "product2.family" in qlow:
            return self._q_line_items_family(q)
        if "from opportunitylineitem" in qlow and "product2.name" in qlow:
            return self._q_line_items_name(q)
        if "from opportunity" in qlow and "iswon=true" in qlow.replace(" ", "") and "growthtype" in qlow:
            return self._q_growth_agg(q)
        if "from opportunity" in qlow and "iswon=true" in qlow.replace(" ", "") and "group by accountid" in qlow:
            return self._q_deal_agg(q)
        if "from opportunity" in qlow and "iswon=true" in qlow.replace(" ", ""):
            return self._q_account_deals(q)
        if "from case" in qlow and "status='blocked'" in qlow.replace(" ", ""):
            return self._q_case_blocked(q)
        if "from case" in qlow and "isaging" in qlow:
            return self._q_case_aging(q)
        if "from case" in qlow and "isescalated" in qlow:
            return self._q_lifetime_cases(q)
        if "from case" in qlow and "group by accountid" in qlow:
            return self._q_open_cases(q)
        if "from task" in qlow:
            return self._q_tasks(q)
        if "from event" in qlow:
            return self._q_events(q)
        return []

    def _q_users(self, q: str) -> list[dict]:
        ids = self._extract_quoted(q)
        out = []
        for uid in ids:
            u = self.users.get(uid)
            if u:
                out.append({"Id": u.id, "Name": u.name, "Title": u.title, "ManagerId": u.manager_id})
        return out

    def _q_renewals(self) -> list[dict]:
        out = []
        for acc in self.accounts.values():
            owner = self.users[acc.owner_id]
            for opp in acc.renewal_opps:
                out.append({
                    "Id": _id("OPP", abs(hash((acc.id, opp["Name"]))) % 10**14),
                    "Name": opp["Name"],
                    "Amount": opp["Amount"],
                    "CloseDate": opp["CloseDate"],
                    "StageName": opp["StageName"],
                    "AccountId": acc.id,
                    "Account": {
                        "Name": acc.name, "BillingState": acc.state, "LastActivityDate": acc.last_activity_date,
                        "Segment": acc.segment,
                    },
                    "OwnerId": owner.id,
                    "Owner": {"Name": owner.name, "Title": owner.title},
                })
        out.sort(key=lambda r: r["Amount"], reverse=True)
        return out[:300]

    def _q_open_cases(self, q: str) -> list[dict]:
        ids = set(self._extract_quoted(q))
        out = []
        for acc_id in ids:
            acc = self.accounts.get(acc_id)
            if not acc:
                continue
            for pri, cnt in acc.open_cases.items():
                if cnt:
                    out.append({"AccountId": acc_id, "Priority": pri, "cnt": cnt})
        return out

    def _q_lifetime_cases(self, q: str) -> list[dict]:
        ids = set(self._extract_quoted(q))
        out = []
        for acc_id in ids:
            acc = self.accounts.get(acc_id)
            if not acc:
                continue
            for (pri, escalated), cnt in acc.lifetime_cases.items():
                if cnt:
                    out.append({"AccountId": acc_id, "Priority": pri, "IsEscalated": escalated, "c": cnt})
        return out

    def _q_deal_agg(self, q: str) -> list[dict]:
        ids = set(self._extract_quoted(q))
        out = []
        for acc_id in ids:
            acc = self.accounts.get(acc_id)
            if not acc or not acc.won_deals:
                continue
            amounts = [d["Amount"] for d in acc.won_deals]
            dates = [d["CloseDate"] for d in acc.won_deals]
            out.append({
                "AccountId": acc_id,
                "c": len(acc.won_deals),
                "s": round(sum(amounts), 2),
                "mn": min(dates),
                "mx": max(dates),
            })
        return out

    def _q_growth_agg(self, q: str) -> list[dict]:
        ids = set(self._extract_quoted(q))
        out = []
        for acc_id in ids:
            acc = self.accounts.get(acc_id)
            if not acc:
                continue
            by_type: dict[str, dict] = {}
            for d in acc.won_deals:
                gt = d.get("GrowthType")
                if not gt:
                    continue
                e = by_type.setdefault(gt, {"amt": 0.0, "c": 0})
                e["amt"] += d["Amount"]
                e["c"] += 1
            for gt, v in by_type.items():
                out.append({"AccountId": acc_id, "GrowthType": gt, "amt": round(v["amt"], 2), "c": v["c"]})
        return out

    def _q_tap(self, q: str) -> list[dict]:
        ids = set(self._extract_quoted(q))
        out = []
        for acc_id in ids:
            acc = self.accounts.get(acc_id)
            if acc and acc.hw_first_purchase:
                out.append({"AccountId": acc_id, "HwFirstPurchase__c": acc.hw_first_purchase})
        return out

    def _q_usage(self, q: str) -> list[dict]:
        ids = set(self._extract_quoted(q))
        out = []
        for acc_id in ids:
            acc = self.accounts.get(acc_id)
            if not acc or not acc.usage:
                continue
            u = acc.usage
            out.append({
                "AccountId": acc_id,
                "SeatsLicensed__c": u["seats_licensed"],
                "SeatsActive__c": u["seats_active"],
                "AdoptionPct__c": u["adoption_pct"],
                "UsageTrendPct__c": u["trend_pct"],
                "CommissionTarget__c": u["commission_target"],
                "CommissionAttained__c": u["commission_attained"],
                "LastUsageSync__c": u["last_sync"],
                "Products": u["products"],
            })
        return out

    def _q_nps(self, q: str) -> list[dict]:
        ids = set(self._extract_quoted(q))
        out = []
        for acc_id in ids:
            acc = self.accounts.get(acc_id)
            if acc and acc.nps_score is not None:
                out.append({"AccountId": acc_id, "NPS_Score__c": acc.nps_score, "SurveyDate__c": acc.nps_survey_date})
        return out

    def _q_case_blocked(self, q: str) -> list[dict]:
        ids = set(self._extract_quoted(q))
        out = []
        for acc_id in ids:
            acc = self.accounts.get(acc_id)
            if acc and acc.blocked_cases:
                out.append({"AccountId": acc_id, "c": acc.blocked_cases})
        return out

    def _q_case_aging(self, q: str) -> list[dict]:
        ids = set(self._extract_quoted(q))
        out = []
        for acc_id in ids:
            acc = self.accounts.get(acc_id)
            if acc and acc.aging_cases:
                out.append({"AccountId": acc_id, "c": acc.aging_cases})
        return out

    def _q_account_deals(self, q: str) -> list[dict]:
        acc_id = self._single_account_id(q)
        acc = self.accounts.get(acc_id) if acc_id else None
        if not acc:
            return []
        deals = sorted(acc.won_deals, key=lambda d: d["CloseDate"], reverse=True)[:8]
        return [{
            "Name": d["Name"], "Amount": d["Amount"], "CloseDate": d["CloseDate"], "StageName": d["StageName"],
            "GrowthType": d.get("GrowthType"),
        } for d in deals]

    def _q_line_items_family(self, q: str) -> list[dict]:
        acc_id = self._single_account_id(q)
        acc = self.accounts.get(acc_id) if acc_id else None
        if not acc:
            return []
        agg: dict[str, dict] = {}
        for li in acc.line_items:
            e = agg.setdefault(li["family"], {"amt": 0.0, "qty": 0})
            e["amt"] += li["total_price"]
            e["qty"] += li["quantity"]
        rows = [{"fam": fam, "amt": round(v["amt"], 2), "qty": v["qty"]} for fam, v in agg.items()]
        rows.sort(key=lambda r: r["amt"], reverse=True)
        return rows[:12]

    def _q_line_items_name(self, q: str) -> list[dict]:
        acc_id = self._single_account_id(q)
        acc = self.accounts.get(acc_id) if acc_id else None
        if not acc:
            return []
        agg: dict[str, float] = {}
        for li in acc.line_items:
            agg[li["name"]] = agg.get(li["name"], 0.0) + li["total_price"]
        rows = [{"n": name, "amt": round(amt, 2)} for name, amt in agg.items()]
        rows.sort(key=lambda r: r["amt"], reverse=True)
        return rows[:8]

    def _q_tasks(self, q: str) -> list[dict]:
        acc_id = self._single_account_id(q)
        acc = self.accounts.get(acc_id) if acc_id else None
        if not acc:
            return []
        rows = sorted(acc.tasks, key=lambda t: t["CreatedDate"], reverse=True)[:12]
        return [{
            "Id": t["Id"], "Subject": t["Subject"], "TaskSubtype": t["TaskSubtype"],
            "ActivityDate": t["ActivityDate"], "CreatedDate": t["CreatedDate"],
            "Owner": {"Name": t["OwnerName"]}, "Description": t["Description"],
        } for t in rows]

    def _q_events(self, q: str) -> list[dict]:
        acc_id = self._single_account_id(q)
        acc = self.accounts.get(acc_id) if acc_id else None
        if not acc:
            return []
        rows = sorted(acc.events, key=lambda e: e["StartDateTime"], reverse=True)[:6]
        return [{
            "Id": e["Id"], "Subject": e["Subject"], "EventSubtype": e["EventSubtype"],
            "StartDateTime": e["StartDateTime"], "Owner": {"Name": e["OwnerName"]}, "Description": e["Description"],
        } for e in rows]


_dataset: MockDataset | None = None


def get_dataset() -> MockDataset:
    global _dataset
    if _dataset is None:
        _dataset = MockDataset(seed=settings.mock_seed, account_count=settings.mock_account_count)
    return _dataset


def run_mock_query(query: str) -> list[dict]:
    return get_dataset().handle(query)
