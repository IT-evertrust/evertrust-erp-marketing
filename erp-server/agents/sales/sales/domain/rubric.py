"""The Sales Coach system message — VERBATIM from blueprint §4.

The system message is: <persona prompt text> + "\n\n---\n\n" + the technique guide +
the strict output format. The persona prompt only seeds the preamble.

KNOWN ISSUE (blueprint #1): the 4-dimension rubric and the methodology.source:"Hormozi"
examples are HARDCODED to Hormozi regardless of which persona is loaded. The persona doc
only contributes the system-message preamble; the rubric is always Hormozi. Kept
persona-agnostic for now — build_system_message is ready to source the rubric from the
persona record later (move SALES_TECHNIQUE_GUIDE into the persona prompt to do that).
"""
from __future__ import annotations

# VERBATIM §4 — the "## SALES TECHNIQUE ANALYSIS GUIDE" block.
SALES_TECHNIQUE_GUIDE = """## SALES TECHNIQUE ANALYSIS GUIDE

For the sales_technique_analysis section score each dimension 1-10 (10 = Hormozi would clip this for content; 1 = he would cringe). Ground all recommendations in the Hormozi framework.

rapport_building: warmth, mirroring, client name, shared context, human connection established BEFORE pitching.
discovery_quality: open-ended questions, listening before pitching, diagnose before prescribe, question-to-statement ratio.
pain_discovery: cost of inaction, Name the Pain better than the client can, Discover Before Pitching, Do Not Quote Price Until Cost of Status Quo is clear.
value_communication: Specificity Beats Generality (numbers/timelines/outcomes), Show Work Do Not Tell, offer tied directly to the client stated problems.

For EACH dimension output: score (1-10), quotes (array of 1-3 verbatim quotes with timestamps, empty string if no timestamp), improvement_recommendation (ONE specific Hormozi-grounded action for the next call)."""

# VERBATIM §4 — the "## OUTPUT FORMAT (STRICT)" block, including the example object.
STRICT_OUTPUT_FORMAT = """## OUTPUT FORMAT (STRICT)
Return ONLY one JSON object. No prose before or after, no markdown code fences, no comments. Use double quotes for every key and string. All scores are numbers. quotes arrays hold 1-3 verbatim transcript quotes with [mm:ss] timestamps. The object must have EXACTLY this structure (example values shown):
{"overall_summary":"x","client_company":"x","ae_name":"x","client_contact":"x","sales_technique_analysis":{"rapport_building":{"score":7,"quotes":[{"text":"x","timestamp":"00:30"}],"improvement_recommendation":"x"},"discovery_quality":{"score":6,"quotes":[{"text":"x","timestamp":"03:15"}],"improvement_recommendation":"x"},"pain_discovery":{"score":5,"quotes":[{"text":"x","timestamp":"07:22"}],"improvement_recommendation":"x"},"value_communication":{"score":8,"quotes":[{"text":"x","timestamp":"12:45"}],"improvement_recommendation":"x"} },"strengths":[{"moment":"x","timestamp":"05:42","why_effective":"x","methodology":{"source":"Hormozi","pattern":"Risk Reversal"} }],"weaknesses":[{"area":"x","timestamp":"12:08","observation":"x","evidence_quote":"x","suggestion":"x","methodology":{"source":"Hormozi","pattern":"Name the Objection"} }],"performance_score":{"overall":{"score":65,"rationale":"x"},"understanding_client_needs":{"score":60,"rationale":"x"},"communication":{"score":75,"rationale":"x"},"technical_explanation":{"score":70,"rationale":"x"},"aggressiveness":{"score":40,"rationale":"x"} },"client_analysis":{"overall":{"score":55,"rationale":"x"},"buying_intent":{"score":50,"rationale":"x"},"interest":{"score":65,"rationale":"x"},"communication":{"score":70,"rationale":"x"} } }"""


def build_system_message(persona_prompt: str) -> str:
    """Assemble the Agent system message: persona prompt + separator + guide + format.
    Matches the n8n expression that concatenated $json.data (persona text) + guide +
    strict output format (§4)."""
    persona = (persona_prompt or "").strip()
    return persona + "\n\n---\n\n" + SALES_TECHNIQUE_GUIDE + "\n\n" + STRICT_OUTPUT_FORMAT
