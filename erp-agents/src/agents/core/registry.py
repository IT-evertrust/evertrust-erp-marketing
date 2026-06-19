# importing workflow:
from erp_agents.workflows.engage.reply_glock import ReplyGlockWorkflow

# Intended purpose of registry.py is to map the workflow names to the workflow classes:
WORKFLOW_REGISTRY = {
    "reach.lead_satellite": LeadSatelliteWorkflow,
    "reach.reach_bazooka": ReachBazookaWorkflow,
    "reach.reply_glock": ReplyGlockWorkflow,
    "reach.snooze_grenade": SnoozeGrenadeWorkflow,
    "reach.rag_agent": RagAgentWorkflow,
    "reach.crm_customers":CRMCustomerWorkflow,
    "reach.crm_hot_leads":CRMHotLeadsWorjflow,
}