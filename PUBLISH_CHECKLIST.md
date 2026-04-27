# Publish Checklist

Run **before every release** to catch broken flows.

## 1. Automated smoke tests

```bash
# Public-only (no credentials needed)
bun run smoke

# Full suite (set credentials for authenticated flows)
SMOKE_CLIENT_EMAIL=... SMOKE_CLIENT_PASSWORD=... \
SMOKE_CONSULTANT_EMAIL=... SMOKE_CONSULTANT_PASSWORD=... \
SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... \
bun run smoke
```

Coverage (`e2e/publish-smoke.spec.ts`):

| # | Flow | Auth |
|---|---|---|
| 1 | Landing page renders | – |
| 2 | Login page interactive | – |
| 3 | Client login → dashboard | client |
| 4 | Request support form loads | client |
| 5 | AI matching — consultants page | client |
| 6 | Booking — sessions page | client |
| 7 | Payment page reachable | client |
| 8 | Rating / satisfaction page | client |
| 9 | Admin KPIs render | admin |
| 10 | Admin analytics loads | admin |
| 11 | Consultant dashboard | consultant |
| 12 | Consultant requests inbox | consultant |

Tests are **read-only** — they verify pages render and primary widgets are present. No real tickets, payments, or data are created.

## 2. Manual checks

- [ ] Run `bun run build` — zero errors
- [ ] Run `bun run test` — all unit tests pass
- [ ] Check Lovable Cloud → Backend status is `ACTIVE_HEALTHY`
- [ ] Verify no console errors on `/`, `/login`, `/client`, `/admin`
- [ ] Test Guest/Explore mode from login page
- [ ] Confirm i18n switch (EN ↔ AR with RTL) works on landing
- [ ] Click "Publish" → "Update" in the Lovable editor
