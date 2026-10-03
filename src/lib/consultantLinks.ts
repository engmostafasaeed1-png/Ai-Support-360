// The two links a consultant can give so that clients and the platform team can see who they are: LinkedIn and Credly.
// The rules are the same as in the database (guard_linkedin_url, guard_credly_username), so a mistake is shown before saving.
// A link starts as "linked" (given by the consultant). It becomes "checked" only when an administrator opened it and confirmed it.

const LINKEDIN = /^(?:https?:\/\/)?(?:www\.|m\.|[a-z]{2,3}\.)?linkedin\.com\/in\/([A-Za-z0-9_%-]{3,100})(?:\/[^?#]*)?(?:[?#].*)?$/i;
const CREDLY_PROFILE = /^(?:https?:\/\/)?(?:www\.)?credly\.com\/users\/([A-Za-z0-9._-]{1,100})(?:\/[^?#]*)?(?:[?#].*)?$/i;
const CREDLY_NAME = /^[A-Za-z0-9._-]{1,100}$/;

export const LINKEDIN_HINT = 'Enter the address of your LinkedIn profile, for example https://www.linkedin.com/in/your-name';
export const CREDLY_HINT = 'Enter your Credly username or the address of your Credly profile';

/** The clean address of a LinkedIn profile, or null when the text is blank or is not the profile of a person on linkedin.com. */
export function normalizeLinkedinUrl(input: string | null | undefined): string | null {
  const m = LINKEDIN.exec((input ?? '').trim());
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}

/** The Credly user name, from the name itself or from the address of the profile, or null when it is blank or not valid. */
export function normalizeCredlyUsername(input: string | null | undefined): string | null {
  const text = (input ?? '').trim();
  const m = CREDLY_PROFILE.exec(text);
  if (m) return m[1];
  return CREDLY_NAME.test(text) ? text : null;
}

/** The address of a Credly profile for a user name, or null when the name is not valid. */
export function credlyProfileUrl(username: string | null | undefined): string | null {
  const name = normalizeCredlyUsername(username);
  return name ? `https://www.credly.com/users/${name}` : null;
}

export type LinkState = 'none' | 'linked' | 'checked';

/** No link, a link the consultant gave, or a link that the platform team has checked. */
export function linkState(value: string | null | undefined, checkedAt: string | null | undefined): LinkState {
  if (!value || !value.trim()) return 'none';
  return checkedAt ? 'checked' : 'linked';
}
