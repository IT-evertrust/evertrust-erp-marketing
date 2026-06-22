from typing import Any

from googleapiclient.discovery import build

from erp_agents.clients.google_auth import build_google_credentials
from erp_agents.settings import settings

DOCS_SCOPES = [
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive",
]


# Creates/updates Google Docs (ContractMaker etc.). Side-effect client only.
class GoogleDocsClient:
    def __init__(self) -> None:
        credentials = build_google_credentials(DOCS_SCOPES)
        self.docs = build("docs", "v1", credentials=credentials)
        self.drive = build("drive", "v3", credentials=credentials)
        self.parent_folder_id = settings.google_docs_parent_folder_id

    def create_document(self, *, title: str, body_text: str | None = None) -> dict[str, Any]:
        doc = self.docs.documents().create(body={"title": title}).execute()
        document_id = doc["documentId"]
        if self.parent_folder_id:
            self.drive.files().update(
                fileId=document_id,
                addParents=self.parent_folder_id,
                fields="id, parents",
            ).execute()
        if body_text:
            self.append_text(document_id, body_text)
        return doc

    def append_text(self, document_id: str, text: str) -> dict[str, Any]:
        requests = [{"insertText": {"endOfSegmentLocation": {}, "text": text}}]
        return (
            self.docs.documents()
            .batchUpdate(documentId=document_id, body={"requests": requests})
            .execute()
        )
