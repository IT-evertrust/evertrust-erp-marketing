# Importing dependencies:
import json
from typing import Any
from openai import OpenAI
from erp_agents.settings import settings

# Single gateway for llm calls
class LlmClient:
    # Central Instance of LLM Client:
    def __init__(self) -> None:
        self.provider = settings.llm_provider
        self.model = settings.openai_model
        self.client = settings.llm_api_key
    
    # Communicating with the model
    def complete_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.2,
    ) -> dict[str, Any]:
        response = self.client.chat.completions.create(
            model = self.model,
            temperature = temperature,
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format = {"type": "json_object"},
        )
        # Returning content or empty bracket if not found
        content = response.choices[0].message.content or "{}"
        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise ValueError(f"LLM returned invalid JSON: {content}" from exc)