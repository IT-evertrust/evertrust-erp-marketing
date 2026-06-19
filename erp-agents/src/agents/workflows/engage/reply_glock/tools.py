import re
from erp_agents.workflows.engage.reply_glock.models import (
    RecommendedAction,
    ReplyGlockStatus
)

def clean_email_body(body: str) -> tuple[str, dict]:
    """"""""
    original = body or ""
    cleaned = original.strip()
    
    removed_quoted_text = False
    removed_signature = False
    
    quote_patterns = [
        r"\nOn .+ wrote:\n",
        r"\nFrom: .+\nSent: .+\n",
        r"\n-{2,} Original Message -{2,}\n",
    ]
    
    for pattern in quote_patterns:
        match = re.search(pattern, cleaned, flags=re.IGNORECASE | re.DOTALL)
        removed_quoted_text = True
        break
    
    signature_patterns = [
        
    ]
    
    for pattern in signature_patterns:
        match = re.search(pattern, cleaned, flag=re.IGNORECASE | re.DOTALL)
        if match and len(cleaned[: match.start().strip()]) > 20:
            cleaned = cleaned[: match.start()].strip()
            removed_signature = True
            break
        
    return cleaned, {
        "removed_quoted_text": removed_quoted_text,
        "removed_signature": removed_signature,
    }

def recommended_action_for_status(status: ReplyGlockStatus) -> RecommendedAction:
    if status == "INTERESTED":
        return "SEND_REPLY"
    if status == "UNSURE":
        return "SAVE_DRAFT"
    if status == "TEMPORARY":
        return "SNOOZE_FOLLOW_UP"
    if status == "UNINTERESTED":
        return "MARK_CLOSED"
    return "MANUAL_REVIEW"

def ui_bucket_for_status(status: ReplyGlockStatus) -> dict:
    mapping = {
        "INTERESTED": {
            "label": 'Interested',
            "bucket": "interested",
            "priority": "high"
        },
        "UNSURE": {
            "label": "Unsure",
            "bucket": "unsure",
            "priority": "medium",
        },
        "TEMPORARY": {
            "label": "Temporary",
            "bucket": "temporary",
            "priority": "medium"
        },
        "UNINTERESTED": {
            "label": "Uninterested",
            "bucket": "uninterested",
            "priority": "low"
        }
    }
    return mapping[status]