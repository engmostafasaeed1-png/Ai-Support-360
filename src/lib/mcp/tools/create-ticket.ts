import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "create_ticket",
  title: "Create ticket",
  description: "Open a new SAP support ticket for the signed-in client.",
  inputSchema: {
    title: z.string().trim().min(3).max(200).describe("Short summary of the issue."),
    description: z.string().trim().max(5000).optional().describe("Detailed description of the issue."),
    sap_module: z.string().trim().min(1).describe("SAP module, e.g. FI, MM, SD, S/4HANA, BTP."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ title, description, sap_module }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await supabaseForUser(ctx)
      .from("tickets")
      .insert({ client_id: ctx.getUserId(), title, description: description ?? null, sap_module })
      .select("id, title, status, sap_module, created_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const ticket = { id: data.id, title: data.title, status: data.status ?? null, sap_module: data.sap_module, created_at: data.created_at };
    return { content: [{ type: "text", text: JSON.stringify(ticket) }], structuredContent: { ticket } };
  },
});
