# Prepared SQL rules

- Prepared SQL files that redefine shared gate functions (hidden_consultant_ids, critical_alert_targets) carry one identical combined body that probes optional helpers with to_regprocedure, checked by a test, so files can be applied in any order without dropping another feature's rule.
