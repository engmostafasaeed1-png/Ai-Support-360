import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listTickets from "./tools/list-tickets";
import getTicket from "./tools/get-ticket";
import createTicket from "./tools/create-ticket";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "ai-sap-support-now",
  title: "AI Support 360",
  version: "0.1.0",
  instructions:
    "Tools for AI Support 360, an SAP support portal. Use `list_my_tickets` to see the user's tickets, `get_ticket` for details, and `create_ticket` to open a new SAP support request.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listTickets, getTicket, createTicket],
});
