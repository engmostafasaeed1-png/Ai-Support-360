// Decrypts a stored *_ciphertext value after verifying the caller owns the
// underlying record. Supports environment_credentials, vmware_settings, and
// integrations.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { z } from "https://esm.sh/zod@3.23.8";

const BodySchema = z.object({
  resource: z.enum(["environment_credentials", "vmware_settings", "integrations"]),
  field: z.string().min(1).max(100),
  record_id: z.string().uuid(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function getKey(): Promise<CryptoKey> {
  const raw = Deno.env.get("CREDENTIALS_ENCRYPTION_KEY");
  if (!raw) throw new Error("CREDENTIALS_ENCRYPTION_KEY not configured");
  const hashed = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return crypto.subtle.importKey("raw", hashed, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Resource =
  | { kind: "environment_credentials"; field: "password_ciphertext" }
  | { kind: "vmware_settings"; field: "vcenter_password_ciphertext" | "cloud_api_key_ciphertext" }
  | { kind: "integrations"; field: "api_key_ciphertext" };

const ALLOWED: Record<string, string[]> = {
  environment_credentials: ["password_ciphertext"],
  vmware_settings: ["vcenter_password_ciphertext", "cloud_api_key_ciphertext"],
  integrations: ["api_key_ciphertext"],
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const sbAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid session" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = parsed.data;
    if (!ALLOWED[body.resource]?.includes(body.field)) {
      return new Response(JSON.stringify({ error: "Invalid resource/field" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use a user-scoped client so RLS enforces ownership on the SELECT.
    const sbUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Service role for fetching the column itself (REVOKE blocks anon/authenticated).
    const sbAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // First check the user can SEE the row at all (RLS). If not, 403.
    const { data: visible } = await sbUser
      .from(body.resource)
      .select("id")
      .eq("id", body.record_id)
      .maybeSingle();
    if (!visible) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Now fetch the ciphertext column with service role (bypasses REVOKE).
    const { data: row, error: rowErr } = await sbAdmin
      .from(body.resource)
      .select(body.field)
      .eq("id", body.record_id)
      .single();
    if (rowErr || !row) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ciphertextB64 = (row as unknown as Record<string, string | null>)[body.field];
    if (!ciphertextB64) {
      return new Response(JSON.stringify({ plaintext: "" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const key = await getKey();
    const buf = b64ToBytes(ciphertextB64);
    const iv = buf.slice(0, 12);
    const cipher = buf.slice(12);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipher,
    );
    const plaintext = new TextDecoder().decode(plain);

    return new Response(JSON.stringify({ plaintext }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("credentials-decrypt error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
