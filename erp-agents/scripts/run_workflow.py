import argparse
import json
import sys
import uuid
from pathlib import Path

# Run without installing: make `erp_agents` importable from src/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from erp_agents.core.job import AgentJob
from erp_agents.core.registry import get_workflow


def main() -> int:
    parser = argparse.ArgumentParser(description="Run an erp-agents workflow on a JSON input.")
    parser.add_argument("--workflow", required=True, help="e.g. engage.reply_glock")
    parser.add_argument("--input", required=True, help="path to a JSON input file")
    parser.add_argument("--mode", choices=["dry_run", "live"], default="dry_run")
    parser.add_argument("--job-id", default=None)
    args = parser.parse_args()

    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    job = AgentJob(
        job_id=args.job_id or f"job_{uuid.uuid4().hex[:8]}",
        workflow=args.workflow,
        mode=args.mode,
        input=payload,
    )

    workflow = get_workflow(args.workflow)
    result = workflow.run(job)
    print(json.dumps(result.model_dump(), indent=2, ensure_ascii=False))
    return 0 if result.status == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
