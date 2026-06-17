"""Contract PDF generation — the irreducibly Google-Workspace part. Live-only: copies the
Template_<niche>_<LANG> Google Doc into the campaign folder, runs replaceAll for each
placeholder, exports the copy as PDF, uploads it. Returns the PDF's Drive file id.

Mirrors the n8n Copy -> Fill -> Export -> Save chain. Needs Drive + Docs scopes.
"""
from __future__ import annotations

from pathlib import Path

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/documents",
]


def _svc(settings, api: str, version: str):
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    token = Path(settings.google_token_dir) / "google.json"
    if not token.exists():
        raise SystemExit("No Google token. Run the Drive+Docs consent flow first.")
    creds = Credentials.from_authorized_user_file(str(token), SCOPES)
    return build(api, version, credentials=creds, cache_discovery=False)


def generate_contract_pdf(settings, template_name: str, folder_id: str, file_base: str, fields: dict) -> str:
    drive = _svc(settings, "drive", "v3")
    docs = _svc(settings, "docs", "v1")

    found = drive.files().list(
        q=f"name = '{template_name}' and mimeType = 'application/vnd.google-apps.document'",
        fields="files(id,name)",
    ).execute().get("files", [])
    if not found:
        raise RuntimeError(f"Template Doc '{template_name}' not found in Drive")
    template_id = found[0]["id"]

    copy = drive.files().copy(
        fileId=template_id, body={"name": file_base, "parents": [folder_id]}
    ).execute()
    doc_id = copy["id"]

    requests = [
        {"replaceAllText": {"containsText": {"text": f"{{{{{k}}}}}", "matchCase": True},
                            "replaceText": str(v)}}
        for k, v in fields.items()
    ]
    docs.documents().batchUpdate(documentId=doc_id, body={"requests": requests}).execute()

    pdf_bytes = drive.files().export(fileId=doc_id, mimeType="application/pdf").execute()
    media = _upload_media(pdf_bytes)
    saved = drive.files().create(
        body={"name": f"{file_base}.pdf", "parents": [folder_id]}, media_body=media, fields="id"
    ).execute()
    return saved["id"]


def _upload_media(data: bytes):
    import io
    from googleapiclient.http import MediaIoBaseUpload
    return MediaIoBaseUpload(io.BytesIO(data), mimetype="application/pdf")
