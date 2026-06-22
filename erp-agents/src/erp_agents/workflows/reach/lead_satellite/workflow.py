"""Lead Satellite workflow — finds REAL prospect leads for a campaign.

Funnel: validate config -> plan locale-aware queries -> discover (web search) ->
resolve to unique company domains -> scrape contact/imprint pages -> extract +
verify emails -> qualify with the LLM (judge, not author) -> dedup + rank -> compose.

Every network stage degrades gracefully: if search is unavailable or yields nothing,
the run falls back to the deterministic offline generator, so a campaign always gets
leads it can store and display. The LLM only SCORES scraped companies; it never
invents them, so leads are real and contactable.
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any

from erp_agents.clients.llm_client import LlmClient
from erp_agents.clients.search_client import SearchClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.settings import settings
from erp_agents.workflows.reach.lead_satellite.locale import LocaleProfile, profile_for
from erp_agents.workflows.reach.lead_satellite.models import (
    LeadCandidate,
    LeadSatelliteInput,
    LeadSatelliteOutput,
)
from erp_agents.workflows.reach.lead_satellite.prompts import (
    QUALIFY_SYSTEM_PROMPT,
    QUALIFY_USER_PROMPT_TEMPLATE,
    format_companies_block,
)
from erp_agents.workflows.reach.lead_satellite.scrape import SiteContacts, scrape_site
from erp_agents.workflows.reach.lead_satellite.tools import (
    dedup_leads,
    offline_leads,
    plan_search_queries,
)
from erp_agents.workflows.reach.lead_satellite.verify import (
    canonical_domain,
    is_noise_domain,
    rank_emails,
    verify_email,
)

_QUALIFY_BATCH = 20  # companies scored per LLM call (kind to a small local model)
_TITLE_SPLIT = re.compile(r"\s*[|–—:·]\s*|\s+[-]\s+")


@dataclass
class _Candidate:
    """A lead under construction, carrying scraped context the qualifier needs."""

    lead: LeadCandidate
    text_sample: str  # scraped site text — input to the LLM judge, not persisted


class LeadSatelliteWorkflow(Workflow):
    name = "reach.lead_satellite"

    def __init__(self, llm: LlmClient | None = None) -> None:
        self._llm = llm
        self._llm_attempted = False

    @property
    def llm(self) -> LlmClient | None:
        if self._llm is None and not self._llm_attempted:
            self._llm_attempted = True
            try:
                self._llm = LlmClient()
            except Exception:
                self._llm = None
        return self._llm

    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        notes: list[str] = []
        metrics: dict[str, Any] = {}
        try:
            data = LeadSatelliteInput.model_validate(job.input)
            trace.append(self._step("validate_input", job.input, data.model_dump()))

            locale = profile_for(data.country)
            queries = plan_search_queries(data, locale)
            trace.append(
                self._step("plan_search", None, {"queries": queries, "lang": locale.language})
            )

            leads, used_path = self._find_leads(data, locale, queries, trace, notes, metrics)

            leads = dedup_leads(leads)
            leads = self._rank(leads)[: data.max_leads]
            trace.append(self._step("dedup_rank", None, {"count": len(leads)}))

            output = LeadSatelliteOutput(
                campaign_id=data.campaign_id,
                search_strategy=queries,
                leads=leads,
                generated_by="llm" if used_path == "search" else "offline",
                notes=notes,
            )
            trace.append(self._step("compose_output", None, output.model_dump()))

            metrics.update(
                {
                    "leads_found": len(leads),
                    "queries": len(queries),
                    "path": used_path,
                    "verified_emails": sum(1 for x in leads if x.email_verified),
                }
            )
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="success",
                output=output.model_dump(),
                metrics=metrics,
                trace=trace,
            )
        except Exception as exc:
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="failed",
                errors=[str(exc)],
                trace=trace,
            )

    # ---- pipeline ----
    def _find_leads(
        self,
        data: LeadSatelliteInput,
        locale: LocaleProfile,
        queries: list[str],
        trace: list[AgentTraceStep],
        notes: list[str],
        metrics: dict[str, Any],
    ) -> tuple[list[LeadCandidate], str]:
        """Run the real funnel; fall back to offline if search is unavailable/empty."""
        search = SearchClient()
        if not search.is_available():
            notes.append("no search provider configured; using offline generator.")
            return offline_leads(data), "offline"

        domains = self._discover_domains(search, queries, trace)  # 1 discover + 2 resolve
        metrics["domains"] = len(domains)
        if not domains:
            notes.append("search returned no usable domains; using offline generator.")
            return offline_leads(data), "offline"

        sites = self._scrape(domains, locale)  # 3 scrape (concurrent)
        metrics["sites_scraped"] = len(sites)

        candidates = self._build_candidates(data, domains, sites, trace, metrics)  # 4 verify
        if not candidates:
            notes.append("no contactable emails scraped; using offline generator.")
            return offline_leads(data), "offline"

        self._qualify(data, candidates, trace, notes)  # 5 qualify (LLM judge)
        leads = [c.lead for c in candidates]
        kept = [x for x in leads if x.confidence >= settings.lead_min_confidence]
        metrics["qualified"] = len(kept)
        if not kept:
            notes.append("all candidates scored below threshold; returning best-effort.")
            kept = leads
        return kept, "search"

    def _discover_domains(
        self, search: SearchClient, queries: list[str], trace: list[AgentTraceStep]
    ) -> dict[str, dict[str, str]]:
        """Map unique non-noise domain -> {title, snippet} from the first hit seen."""
        domains: dict[str, dict[str, str]] = {}
        hits = 0
        for q in queries:
            if len(domains) >= settings.scrape_max_sites:
                break
            for r in search.search(q):
                hits += 1
                domain = canonical_domain(r.get("url", ""))
                if not domain or is_noise_domain(domain) or domain in domains:
                    continue
                domains[domain] = {
                    "title": r.get("title", ""),
                    "snippet": r.get("snippet", ""),
                }
                if len(domains) >= settings.scrape_max_sites:
                    break
        trace.append(
            self._step("discover", {"queries": len(queries)}, {"hits": hits, "domains": len(domains)})
        )
        return domains

    def _scrape(
        self, domains: dict[str, dict[str, str]], locale: LocaleProfile
    ) -> dict[str, SiteContacts]:
        out: dict[str, SiteContacts] = {}
        with ThreadPoolExecutor(max_workers=settings.scrape_concurrency) as pool:
            for site in pool.map(lambda d: scrape_site(d, locale), list(domains)):
                out[site.domain] = site
        return out

    def _build_candidates(
        self,
        data: LeadSatelliteInput,
        domains: dict[str, dict[str, str]],
        sites: dict[str, SiteContacts],
        trace: list[AgentTraceStep],
        metrics: dict[str, Any],
    ) -> list[_Candidate]:
        candidates: list[_Candidate] = []
        emails_found = 0
        for domain, site in sites.items():
            if not site.emails:
                continue
            emails_found += len(site.emails)
            best = rank_emails(site.emails, domain)[0]
            verified = verify_email(best)
            title = (domains.get(domain) or {}).get("title", "")
            snippet = (domains.get(domain) or {}).get("snippet", "")
            lead = LeadCandidate(
                company=self._company_name(title, domain),
                website=f"https://{domain}",
                contact_name=site.contact_name,
                contact_title=None,
                email=best,
                email_verified=verified,
                phone=site.phone,
                location=data.region,
                source=(settings.search_provider or "search"),
                contact_page=site.contact_page,
                qualification_reason=f"{data.niche} company in {data.region}",
                confidence=0.5,  # placeholder until qualified
            )
            candidates.append(_Candidate(lead=lead, text_sample=site.text_sample or snippet))
        metrics["emails_found"] = emails_found
        trace.append(self._step("build_candidates", None, {"count": len(candidates)}))
        return candidates

    def _qualify(
        self,
        data: LeadSatelliteInput,
        candidates: list[_Candidate],
        trace: list[AgentTraceStep],
        notes: list[str],
    ) -> None:
        """Score candidates in place. LLM if available, else keyword heuristic."""
        if self.llm is None:
            for c in candidates:
                c.lead.confidence = self._heuristic_conf(data, c)
                c.lead.qualification_reason = f"{data.niche} fit (heuristic) — {c.lead.company}"
            notes.append("LLM unavailable; scored with keyword heuristic.")
            return

        scored = 0
        for start in range(0, len(candidates), _QUALIFY_BATCH):
            chunk = candidates[start : start + _QUALIFY_BATCH]
            block = format_companies_block(
                [
                    {
                        "index": i,
                        "company": c.lead.company,
                        "domain": (c.lead.website or "").replace("https://", ""),
                        "text_sample": c.text_sample,
                    }
                    for i, c in enumerate(chunk)
                ]
            )
            user = QUALIFY_USER_PROMPT_TEMPLATE.format(
                name=data.name or "(unnamed campaign)",
                niche=data.niche,
                region=data.region,
                segment=data.segment or "(none)",
                companies_block=block,
            )
            try:
                raw = self.llm.complete_json(
                    system_prompt=QUALIFY_SYSTEM_PROMPT, user_prompt=user, temperature=0.2
                )
                for item in raw.get("leads") or []:
                    idx = int(item.get("index", -1))
                    if 0 <= idx < len(chunk):
                        conf = float(item.get("confidence", 0.5))
                        chunk[idx].lead.confidence = max(0.0, min(1.0, conf))
                        reason = str(item.get("qualification_reason") or "").strip()
                        if reason:
                            chunk[idx].lead.qualification_reason = reason
                        title = item.get("contact_title")
                        if title:
                            chunk[idx].lead.contact_title = str(title)
                        scored += 1
            except Exception as exc:
                for c in chunk:
                    c.lead.confidence = self._heuristic_conf(data, c)
                notes.append(f"qualify batch fell back to heuristic: {exc}")
        trace.append(self._step("qualify", None, {"scored": scored, "total": len(candidates)}))

    # ---- helpers ----
    @staticmethod
    def _company_name(title: str, domain: str) -> str:
        """Clean company name from the search title, else a domain root fallback."""
        if title:
            first = _TITLE_SPLIT.split(title.strip())[0].strip()
            if 2 <= len(first) <= 60:
                return first
        return domain.split(".")[0].replace("-", " ").strip().title() or domain

    @staticmethod
    def _heuristic_conf(data: LeadSatelliteInput, cand: _Candidate) -> float:
        tokens = set(re.findall(r"[a-zà-ÿ0-9]{3,}", f"{data.niche} {data.segment or ''}".lower()))
        if not tokens:
            return 0.5
        text = f"{cand.lead.company} {cand.text_sample}".lower()
        hits = sum(1 for t in tokens if t in text)
        base = 0.4 + 0.12 * hits
        if cand.lead.email_verified:
            base += 0.1
        return round(max(0.3, min(0.9, base)), 2)

    @staticmethod
    def _rank(leads: list[LeadCandidate]) -> list[LeadCandidate]:
        return sorted(
            leads,
            key=lambda x: (
                0 if x.email_verified else 1,
                -x.confidence,
                0 if x.contact_name else 1,
            ),
        )

    @staticmethod
    def _step(
        name: str,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
    ) -> AgentTraceStep:
        return AgentTraceStep(name=name, input=input, output=output)
