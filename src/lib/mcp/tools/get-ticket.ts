import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_ticket",
  title: "Get ticket",
  description: "Get the details of one support ticket by its ID.",
  inputSchema: { ticket_id: z.string().uuid().describe("The ticket ID.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ ticket_id }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("tickets")
      .select("id, title, description, status, sap_module, ticket_type, resolution_notes, sla_deadline, created_at, updated_at, resolved_at")
      .eq("id", ticket_id)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) throw new ToolError("Ticket not found or not accessible.");
    const ticket = {
      id: data.id, title: data.title, description: data.description, status: data.status ?? null,
      sap_module: data.sap_module, ticket_type: data.ticket_type, resolution_notes: data.resolution_notes,
      sla_deadline: data.sla_deadline, created_at: data.created_at, updated_at: data.updated_at, resolved_at: data.resolved_at,
    };
    return { content: [{ type: "text", text: JSON.stringify(ticket) }], structuredContent: { ticket } };
  },
});
