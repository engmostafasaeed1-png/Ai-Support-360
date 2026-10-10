// Where the team is told about new requests from the website, and where the replies of visitors go.
// The address can be changed without a code change with the secret TEAM_NOTIFY_EMAIL.
export const TEAM_EMAIL = Deno.env.get('TEAM_NOTIFY_EMAIL') || 'notify@aisupport360.com'
