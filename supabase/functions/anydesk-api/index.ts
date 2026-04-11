import { createClient } from "https://esm.sh/@supabase/supabase-js@2.101.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.101.1/cors";

const ANYDESK_API_BASE = "https://v1.api.anydesk.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify user is authenticated
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const ANYDESK_API_KEY = Deno.env.get("ANYDESK_API_KEY");

    if (action === "status") {
      return new Response(
        JSON.stringify({
          configured: Boolean(ANYDESK_API_KEY),
          missing: ANYDESK_API_KEY ? [] : ["ANYDESK_API_KEY"],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!ANYDESK_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AnyDesk integration not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers = {
      Authorization: `Bearer ${ANYDESK_API_KEY}`,
      "Content-Type": "application/json",
    };

    let result;

    switch (action) {
      case "clients": {
        // List all registered AnyDesk clients
        const offset = url.searchParams.get("offset") || "0";
        const limit = url.searchParams.get("limit") || "50";
        const sort = url.searchParams.get("sort") || "last-session";
        const order = url.searchParams.get("order") || "desc";
        const online = url.searchParams.get("online"); // "true" to filter online only

        let endpoint = `${ANYDESK_API_BASE}/clients?offset=${offset}&limit=${limit}&sort=${sort}&order=${order}`;
        if (online === "true") endpoint += "&online=true";

        const res = await fetch(endpoint, { headers });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`AnyDesk API error [${res.status}]: ${errBody}`);
        }
        result = await res.json();
        break;
      }

      case "client-detail": {
        // Get details for a specific client
        const clientId = url.searchParams.get("clientId");
        if (!clientId) throw new Error("clientId is required");

        const res = await fetch(`${ANYDESK_API_BASE}/clients/${clientId}`, { headers });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`AnyDesk API error [${res.status}]: ${errBody}`);
        }
        result = await res.json();
        break;
      }

      case "sessions": {
        // Get session history
        const from = url.searchParams.get("from") || "";
        const to = url.searchParams.get("to") || "";
        const clientId = url.searchParams.get("clientId") || "";
        const limit = url.searchParams.get("limit") || "50";

        let endpoint = `${ANYDESK_API_BASE}/sessions?limit=${limit}`;
        if (from) endpoint += `&from=${from}`;
        if (to) endpoint += `&to=${to}`;
        if (clientId) endpoint += `&cid=${clientId}`;

        const res = await fetch(endpoint, { headers });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`AnyDesk API error [${res.status}]: ${errBody}`);
        }
        result = await res.json();
        break;
      }

      case "session-detail": {
        // Get detail for specific session
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) throw new Error("sessionId is required");

        const res = await fetch(`${ANYDESK_API_BASE}/sessions/${sessionId}`, { headers });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`AnyDesk API error [${res.status}]: ${errBody}`);
        }
        result = await res.json();
        break;
      }

      case "set-alias": {
        // Set alias for a client
        if (req.method !== "POST") throw new Error("POST required");
        const body = await req.json();
        const { clientId, alias } = body;
        if (!clientId) throw new Error("clientId is required");

        const res = await fetch(`${ANYDESK_API_BASE}/clients/${clientId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ alias: alias || "" }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`AnyDesk API error [${res.status}]: ${errBody}`);
        }
        result = { success: true };
        break;
      }

      case "connection-link": {
        // Generate AnyDesk connection URI
        const clientId = url.searchParams.get("clientId");
        if (!clientId) throw new Error("clientId is required");
        result = {
          uri: `anydesk:${clientId}`,
          clientId,
          instructions: "Click the link or paste the AnyDesk ID into your AnyDesk app to connect.",
        };
        break;
      }

      case "license": {
        // Get license info
        const res = await fetch(`${ANYDESK_API_BASE}/license`, { headers });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`AnyDesk API error [${res.status}]: ${errBody}`);
        }
        result = await res.json();
        break;
      }

      default:
        return new Response(
          JSON.stringify({
            error: "Invalid action",
            validActions: ["status", "clients", "client-detail", "sessions", "session-detail", "set-alias", "connection-link", "license"],
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("AnyDesk API error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
