from erp_agents.core.workflow import Workflow
from erp_agents.workflows.activate.client_research.workflow import (
    ClientResearchWorkflow,
)
from erp_agents.workflows.activate.company_research import CompanyResearchWorkflow
from erp_agents.workflows.activate.read_ai_sync import ReadAiSyncWorkflow
from erp_agents.workflows.activate.sales_agent import SalesAgentWorkflow
from erp_agents.workflows.engage.rag_agent import RagAgentWorkflow
from erp_agents.workflows.engage.refine_training import RefineTrainingWorkflow
from erp_agents.workflows.engage.reply_glock import ReplyGlockWorkflow
from erp_agents.workflows.nurture.sleeper_grenade import SleeperGrenadeWorkflow
from erp_agents.workflows.reach.ammo_forge import AmmoForgeWorkflow
from erp_agents.workflows.reach.lead_satellite import LeadSatelliteWorkflow
from erp_agents.workflows.reach.reach_bazooka import ReachBazookaWorkflow

# Maps workflow names to workflow classes. Add nurture entries as they are built.
WORKFLOW_REGISTRY: dict[str, type[Workflow]] = {
    "engage.reply_glock": ReplyGlockWorkflow,
    "engage.rag_agent": RagAgentWorkflow,
    "engage.refine_training": RefineTrainingWorkflow,
    "reach.ammo_forge": AmmoForgeWorkflow,
    "reach.lead_satellite": LeadSatelliteWorkflow,
    "reach.reach_bazooka": ReachBazookaWorkflow,
    "activate.sales_agent": SalesAgentWorkflow,
    "activate.company_research": CompanyResearchWorkflow,
    "activate.client_research": ClientResearchWorkflow,
    "activate.read_ai_sync": ReadAiSyncWorkflow,
    "nurture.sleeper_grenade": SleeperGrenadeWorkflow,
}


def get_workflow(name: str) -> Workflow:
    try:
        workflow_cls = WORKFLOW_REGISTRY[name]
    except KeyError as exc:
        available = ", ".join(sorted(WORKFLOW_REGISTRY)) or "(none)"
        raise KeyError(f"Unknown workflow '{name}'. Available: {available}") from exc
    return workflow_cls()
