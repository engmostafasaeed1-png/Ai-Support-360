# Solution Architecture (hidden)

Status (2026-10-25): the owner cancelled making this page real and decided to HIDE it for now. No tables, functions
or SQL exist for architecture documents; the earlier prepared build was removed.

- The page `/client/solution-architecture` stays in the code as the existing preview with example data
  (unchanged, with its "Preview with example data" banner).
- Owner switch: `platform_settings.solution_architecture_visible` (boolean, default OFF), in Admin settings > General
  ("Show Solution Architecture to clients").
- While off: the item is removed from the client sidebar, mobile menu, "Customize menu" and global search
  (command palette); the address redirects clients to `/client` without showing the page. Administrators can still
  open it by address for review.
- `docs/sql/solution-architecture-flag.sql` (prepared, not applied) adds the default row and lets signed-in users
  read this one key. Until it is applied clients cannot read the switch, so the page stays hidden even if an admin
  turns it on.
- The page's example data appears nowhere else: not in other pages, search, the knowledge base, the AI assistants'
  knowledge, the sitemap (client pages are not listed and robots.txt disallows /client) or e-mails.
