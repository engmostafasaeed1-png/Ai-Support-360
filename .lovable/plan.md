# Replace the old brand name in two Arabic login lines

## Verified current state (read-only, nothing changed yet)

- Arabic file: `src/i18n/locales/ar.json` — English file: `src/i18n/locales/en.json`
- `ar.json:962` — `"login_desc": "سجّل الدخول إلى حسابك في قرطبة",`
- `ar.json:964` — `"signup_desc": "انضم إلى قرطبة كعميل أو مستشار",`
- `en.json:962` / `en.json:964` already say "AI Support 360".
- The word قرطبة appears on those two lines only (2 lines in the whole Arabic file).
- The English file has one old-brand hit, `en.json:103` `"whyQurtuba": {` — a key name, not text shown to visitors; its values are brand-neutral.
- These two Arabic lines are the text under the title on the sign-in page (`LoginPage.tsx:383`) and the sign-up page (`SignupPage.tsx:295`).

## The change

Two lines in `src/i18n/locales/ar.json`, inside the `auth` section:

```text
962:    "login_desc": "سجّل الدخول إلى حسابك في AI Support 360",
964:    "signup_desc": "انضم إلى AI Support 360 كعميل أو مستشار",
```

The brand stays in Latin letters because the Arabic file already does that everywhere else it names the product (`ar.json:192`, `ar.json:1097`, `ar.json:1104`).

## Left alone on purpose

- The `whyQurtuba` key names and the file `WhyQurtubaSection.tsx`: internal identifiers that no visitor sees. Renaming them would touch four files for no visible gain.
- No database, no SQL, no generated types, no other file, no new dependency.

## Check after building

- Open the sign-in and sign-up pages in Arabic and read the two lines under the headings.
- Confirm the English pages are untouched.
