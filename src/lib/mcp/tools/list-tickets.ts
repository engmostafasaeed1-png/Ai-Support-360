import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_my_tickets",
  title: "List my tickets",
  description: "List the SAP support tickets you can see, newest first.",
  inputSchema: {
    status: z.string().optional().describe("Optional status filter, e.g. new, in_progress, resolved."),
    limit: z.number().int().min(1).max(50).optional().describe("Max tickets to return (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = supabaseForUser(ctx)
      .from("tickets")
      .select("id, title, status, sap_module, ticket_type, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const tickets = (data ?? []).map((t) => ({
      id: t.id, title: t.title, status: t.status ?? null, sap_module: t.sap_module,
      ticket_type: t.ticket_type, created_at: t.created_at, updated_at: t.updated_at,
    }));
    return { content: [{ type: "text", text: JSON.stringify(tickets) }], structuredContent: { tickets } };
  },
});
