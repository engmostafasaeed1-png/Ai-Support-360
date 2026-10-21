# Prepared SQL rules

- Prepared SQL files that redefine shared gate functions (hidden_consultant_ids, critical_alert_targets) carry one identical combined body that probes optional helpers with to_regprocedure, checked by a test, so files can be applied in any order without dropping another feature's rule.
- Consultant profile submission (Feature V) is set only by submit_consultant_profile (guard trigger on consultants.profile_submitted_at) using consultant_submission_missing = consultant_missing_fields + hard-required fields + policy for new registrations; the browser only displays that list, so the gate cannot be bypassed and follows admin rule changes.
- Feature X name privacy: consultant names for another person go through consultant_name_for(consultant, viewer) (internal, recipient for notifications) or consultant_public_name (browser); stored notification texts use the context-free team_consultant_name (public format), so later NDA changes never leave a full name in old texts.
