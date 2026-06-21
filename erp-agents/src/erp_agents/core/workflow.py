# Core contract for all workflows 

# Importing dependencies:
from abc import ABC, abstractmethod

from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult

# Defining what a workflow looks like
class Workflow(ABC):
    name: str
    @abstractmethod
    # Every workflow must implement run(input) => output
    def run(self, job: AgentJob) -> AgentResult:
        raise NotImplementedError
    
