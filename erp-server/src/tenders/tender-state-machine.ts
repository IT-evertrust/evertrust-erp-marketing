// The tender state machine now lives in @evertrust/shared so the API
// (enforcement) and the web UI (transition affordances) share ONE authority and
// cannot drift. This module re-exports it unchanged so existing API imports
// (`./tender-state-machine`) keep working with identical behavior.
export {
  STATE_MACHINE,
  canTransition,
  nextStates,
  isSubmissionBlocked,
} from '@evertrust/shared';
