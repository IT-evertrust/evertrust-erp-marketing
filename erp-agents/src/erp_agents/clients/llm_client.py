import json
import re
from typing import Any

from openai import OpenAI

from erp_agents.settings import settings


# Single gateway for LLM calls — local Hermes via the LiteLLM (OpenAI-compatible) gateway.
class LlmClient:
    def __init__(self) -> None:
        self.provider = settings.llm_provider
        self.model = settings.llm_model
        # Model used for writing reply drafts — falls back to the default model.
        self.draft_model = settings.draft_model or settings.llm_model
        # A bounded timeout so a slow/overloaded local Hermes fails fast and workflows can fall
        # back to their offline path instead of hanging (and dropping the ERP's connection).
        self.client = OpenAI(
            api_key=settings.llm_api_key or "local",
            base_url=settings.llm_base_url,
            timeout=90.0,
            max_retries=1,
        )

    # Communicating with the model — always returns parsed JSON.
    def complete_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
    ) -> dict[str, Any]:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                temperature=temperature,
                messages=messages,
                response_format={"type": "json_object"},
            )
        except Exception:
            # Some local models reject response_format — retry without it.
            response = self.client.chat.completions.create(
                model=self.model,
                temperature=temperature,
                messages=messages,
            )
        content = response.choices[0].message.content or "{}"
        return self._parse_json(content)

    # Free-form text completion — NO response_format. Small local models (Hermes)
    # reliably produce prose but frequently mangle a requested JSON SHAPE (returning
    # e.g. {"response": "..."} instead of the asked-for fields). For content that is
    # naturally text — an email body — ask for text and structure it in code.
    def complete_text(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        model: str | None = None,
    ) -> str:
        response = self.client.chat.completions.create(
            model=model or self.model,
            temperature=temperature,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return response.choices[0].message.content or ""

    @staticmethod
    def _parse_json(content: str) -> dict[str, Any]:
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            # Hermes sometimes wraps JSON in prose/fences — extract the first object.
            match = re.search(r"\{.*\}", content, flags=re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(0))
                except json.JSONDecodeError as exc:
                    raise ValueError(f"LLM returned invalid JSON: {content}") from exc
            raise ValueError(f"LLM returned invalid JSON: {content}")
