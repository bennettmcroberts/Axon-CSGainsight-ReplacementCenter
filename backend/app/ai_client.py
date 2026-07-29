"""Real Anthropic API calls for Predictive Insights and Gmail-reply
interpretation (Test10 demo). Optional - both features fall back to the
human-in-the-loop file hand-off pattern in main.py when ANTHROPIC_API_KEY
isn't set in backend/.env.
"""
from __future__ import annotations

import json
import re

from .config import settings

_MODEL_INSIGHT = "claude-sonnet-4-5-20250929"  # better prose for the customer-facing analysis
_MODEL_REPLY = "claude-haiku-4-5-20251001"  # fast/cheap - just a short yes/no interpretation

PREDICTIVE_ALLOWED_TEMPLATES = ["cust_checkin", "cust_product", "cust_expansion"]


def _client():
    import anthropic
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def generate_predictive_insight(account_name: str, context_text: str, recent_event_summary: str) -> dict:
    """Returns {pastReview, analysis, similar:[{name,note}], timeline:[{when,action,detail,emailTemplate}]}."""
    prompt = f"""You are a Customer Success analyst drafting a forward-looking "Predictive Insight" for {account_name}, a public-safety agency using Axon's CS platform. This is deliberately NOT a problem-fixing exercise - it's about proactively fostering the relationship before anything goes wrong. Frame everything toward what's next and how to deepen the relationship, not toward diagnosing or resolving issues.

Background/history on this account (fabricated for a demo - treat it as real):
---
{context_text}
---

The account's actual current state: {recent_event_summary}

Write a predictive insight with exactly these parts, as JSON only (no markdown fences, no commentary before or after):
{{
  "pastReview": "2-3 sentences reviewing this account's history of engagement, grounded in the background above, ending on the opportunity to build a more proactive relationship-first rhythm going forward.",
  "analysis": "2-3 sentences that are explicitly forward-looking - acknowledge the current-state fact given above only briefly if it's a genuinely open risk (in which case note that it's worth resolving first), then pivot to why the relationship is well-positioned to grow. Frame progress in terms of product engagement/adoption of the account's most valuable workflows as the primary evidence - NPS/sentiment is real but only supporting context, never the headline proof that something worked.",
  "similar": [{{"name": "a plausible peer agency name you invent - not {account_name}", "note": "one sentence on a relevant relationship-building outcome"}}, {{"name": "...", "note": "..."}}],
  "timeline": [
    {{"when": "Week 1", "action": "short action title", "detail": "1 sentence", "emailTemplate": "cust_checkin"}},
    {{"when": "Week 3", "action": "...", "detail": "...", "emailTemplate": null}},
    {{"when": "Week 5", "action": "...", "detail": "...", "emailTemplate": "cust_product"}},
    {{"when": "Week 7", "action": "...", "detail": "...", "emailTemplate": null}},
    {{"when": "Week 9", "action": "...", "detail": "...", "emailTemplate": "cust_expansion"}},
    {{"when": "Week 12", "action": "...", "detail": "...", "emailTemplate": "cust_checkin"}}
  ]
}}

Rules: "emailTemplate" must be exactly one of {PREDICTIVE_ALLOWED_TEMPLATES} or null (null means an internal/no-email step, e.g. looping in another stakeholder or an internal review). Vary the actions based on this specific account's own history and current state - use the shape above as a reference only, don't restate it verbatim. Keep every field genuinely specific to {account_name}, not generic filler."""
    resp = _client().messages.create(
        model=_MODEL_INSIGHT,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )
    data = _extract_json(resp.content[0].text)
    data.setdefault("similar", [])
    data.setdefault("timeline", [])
    for t in data["timeline"]:
        if t.get("emailTemplate") not in PREDICTIVE_ALLOWED_TEMPLATES:
            t["emailTemplate"] = None
    return data


def draft_email(account_name: str, category: str, extra_context: str, background_text: str) -> dict:
    """Returns {to, subject, body} - a real drafted customer email, combining
    whatever the CSM typed in with the account's own background/history, not
    a generic template. This is the actual model doing the drafting, not a
    pre-written EMAIL_TEMPLATES fill - the CSM's typed context can meaningfully
    change tone, specifics, or the ask itself."""
    background_block = f"\n\nBackground on this account (may be fabricated for a demo - treat as real):\n---\n{background_text}\n---" if background_text else ""
    prompt = f"""You are a Customer Success Manager at Axon drafting a real, professional customer-facing email to {account_name}, a public-safety agency.

This email relates to: {category}{background_block}

The CSM gave you this specific instruction for what the email should say:
---
{extra_context or '(no additional instruction given - use your judgment based on the category and background above)'}
---

Draft the actual email now. Respond with ONLY JSON, no markdown fences, no commentary:
{{"to": "a plausible contact name/role at this account (invent one consistent with the background, e.g. a title and a realistic email address)", "subject": "a specific, non-generic subject line", "body": "the full email body as plain text, using \\n for line breaks - professional tone, specific to the instruction and background given, not boilerplate"}}"""
    resp = _client().messages.create(
        model=_MODEL_INSIGHT,
        max_tokens=800,
        messages=[{"role": "user", "content": prompt}],
    )
    return _extract_json(resp.content[0].text)


ORG_CONFIG_CATEGORIES = ["escalation", "renewal", "usage", "case_watch", "cadence", "manual"]

# Permanent business gates - per CS leadership's explicit correction: "renewal,
# adoption, risk, and NPS remain permanent system components... leaders can
# adjust thresholds, but should not be able to remove essential business gates
# entirely." One trigger stands in for each fixed pillar. This is also
# enforced in the frontend (applyOrgConfigChatDiff/setTriggerEnabled) as a
# real code-level rule - the prompt instruction below is what makes the
# model's own explanation match that rule instead of silently disabling it.
CORE_TRIGGERS = {"nps_csat_drop": "NPS", "usage_drop": "ADOPTION", "case_blocked": "RISK", "renewal_prep_stale": "RENEWAL"}


def answer_org_config_chat(message: str, current_config_json: str, org_docs: dict, history: list | None = None) -> dict:
    """Returns {matchedOrg, explanation, diff, limitation}. `org_docs` is
    {orgName: fileText} for all 5 reference docs. `diff` only ever contains
    fields in the existing config shape (trigger enabled/label/category/
    weight, or new customTriggers) - the model is instructed to never invent
    a new step shape or page, only parameterize the fixed pipeline. If the
    request doesn't fit that shape, `diff` is null and `limitation` explains
    why, optionally with a suggested alternative that does fit.

    `history` is the prior turns of this same conversation [{role, text,
    diff}] - this makes the chat continuous rather than one-shot: a
    follow-up message refines/adds to whatever diff is already on the table
    instead of the model starting over from a blank slate each time."""
    docs_block = "\n\n".join(f"=== {name} ===\n{text}" for name, text in org_docs.items())
    history_block = ""
    if history:
        lines = []
        for turn in history:
            role = turn.get("role")
            text = turn.get("text") or ""
            diff = turn.get("diff")
            if role == "user":
                lines.append(f'CSM: "{text}"')
            else:
                lines.append(f"You replied: {text}")
                if diff:
                    lines.append(f"...with this diff on the table: {json.dumps(diff)}")
        history_block = "\n\nThis is a CONTINUOUS conversation - here's what's happened so far in this session:\n" + "\n".join(lines) + "\n\nThe new message below may add to, refine, or override what's already on the table above. Your \"diff\" response must be the FULL CUMULATIVE diff (everything agreed on so far in this conversation, merged with whatever the new message asks for) - not just the delta implied by the newest message alone. If the new message contradicts an earlier turn, the newest instruction wins."
    prompt = f"""You configure a Customer Success platform for different CSM orgs. The platform has one FIXED pipeline that never changes per org: a trigger fires -> routes to exactly one category ({', '.join(ORG_CONFIG_CATEGORIES)}) -> that category has a fixed step shape. Org customization only ever changes: whether a trigger is enabled, its label, its category routing, its weight, or brand-new custom triggers (which must still declare an existing category + a weight).

Here are the 5 org reference docs (background on what each org wants and why):
{docs_block}

Here is the CURRENT active config (JSON) - only propose a DIFF from this, don't repeat unchanged values:
{current_config_json}
{history_block}

A CSM just typed this request in the Configure Org Data chat:
"{message}"

Decide which org doc's context is most relevant to this request (it may reference an org by name, or just describe a preference matching one org's known priorities). Then produce a change that fits the fixed shape above.

Respond with ONLY JSON, no markdown fences, no commentary:
{{
  "matchedOrg": "org name or 'General' if no specific org context applies",
  "explanation": "1-3 plain-English sentences: what you're changing and why (the FULL cumulative change if this is a continuing conversation, not just the newest turn), referencing the org's own reasoning where relevant",
  "diff": {{
    "triggers": {{ "trigger_key": {{ "enabled": true, "label": "...", "category": "one of {ORG_CONFIG_CATEGORIES}", "weight": 3 }} }},
    "customTriggers": [ {{ "key": "snake_case_key", "label": "...", "category": "...", "weight": 1 }} ]
  }},
  "limitation": null
}}

Only include trigger keys/customTriggers actually being changed from the ORIGINAL current config - omit anything unchanged. If the request asks for something that genuinely doesn't fit this shape (a new page, a new step type, combining multiple accounts' data in a way the pipeline doesn't support, etc.), set "diff" to null and use "limitation" to explain plainly why, and suggest a concrete alternative that DOES fit the shape if one exists.

PERMANENT GATES - these trigger keys can NEVER be set to "enabled": false, no matter how the request is phrased (even "turn it off entirely", "we don't track that", "remove it"): {', '.join(f'{k} ({v})' for k, v in CORE_TRIGGERS.items())}. If the request asks to disable one of these:
- Do NOT include "enabled": false for that key in the diff (omit the enabled field entirely for it, or leave it out of the diff if nothing else about it changed).
- Still apply any OTHER part of the request that's valid (weight changes, timing, other triggers, custom triggers) - don't null out the whole diff just because one part touched a permanent gate.
- Set "limitation" to a message in exactly this shape: "{{FEATURE}} CAN NOT BE TURNED OFF - it's a permanent business gate. You can still adjust its weight, timing/threshold, label or routing." where {{FEATURE}} is the gate's short name from the list above, in ALL CAPS (e.g. "NPS CAN NOT BE TURNED OFF - it's a permanent business gate. You can still adjust its weight, timing/threshold, label or routing.")."""
    resp = _client().messages.create(
        model=_MODEL_INSIGHT,
        max_tokens=1200,
        messages=[{"role": "user", "content": prompt}],
    )
    data = _extract_json(resp.content[0].text)
    data.setdefault("diff", None)
    data.setdefault("limitation", None)
    return data


def interpret_reply(account_name: str, sent_subject: str, reply_body: str) -> dict:
    """Returns {resolved: bool, note: str} - does this reply mean the specific
    follow-up task/CTA the email was about can be closed out?"""
    prompt = f"""A Customer Success rep at Axon sent an email to {account_name} with subject "{sent_subject}". Here is the customer's reply:
---
{reply_body}
---
This email was about ONE specific follow-up task (e.g. scheduling a TAP/hardware refresh, confirming a renewal step, acknowledging an escalation). Decide only whether THAT SPECIFIC task can now be marked done/closed based on this reply - not whether the entire account relationship is "over."

Answer resolved:true if the customer confirms, agrees, or says they've already taken the relevant action (e.g. "sounds good", "already signed it", "done", "confirmed", "yes let's do that"), even if minor logistics or a broader relationship continue afterward.
Answer resolved:false only if they are pushing back, asking to delay/reschedule, raising a new problem, or the reply doesn't actually address the ask.

Respond with ONLY JSON, no markdown fences, no commentary:
{{"resolved": true or false, "note": "one sentence summarizing what the reply said, for a CRM timeline entry"}}"""
    resp = _client().messages.create(
        model=_MODEL_REPLY,
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}],
    )
    return _extract_json(resp.content[0].text)
