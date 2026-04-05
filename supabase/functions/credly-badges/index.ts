import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "@supabase/supabase-js/cors";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const UsernameSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const username = url.searchParams.get("username") ?? "";

    const parsed = UsernameSchema.safeParse(username);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid Credly username" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const credlyUrl = `https://www.credly.com/users/${parsed.data}/badges.json`;
    const response = await fetch(credlyUrl, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const status = response.status;
      await response.text();
      return new Response(
        JSON.stringify({ error: status === 404 ? "Credly profile not found" : "Failed to fetch Credly data" }),
        { status: status === 404 ? 404 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();

    // Extract relevant badge info
    const badges = (data.data || []).map((badge: any) => ({
      id: badge.id,
      name: badge.badge_template?.name ?? badge.name ?? "Unknown",
      issuer: badge.issuer?.entities?.[0]?.entity?.name ?? badge.badge_template?.issuer?.name ?? "Unknown",
      image_url: badge.image_url ?? badge.badge_template?.image_url ?? null,
      issued_at: badge.issued_at ?? badge.issued_at_date ?? null,
      expires_at: badge.expires_at ?? badge.expires_at_date ?? null,
      badge_url: badge.badge_url ?? `https://www.credly.com/badges/${badge.id}`,
      is_active: badge.state === "accepted",
    }));

    return new Response(
      JSON.stringify({ badges, username: parsed.data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Credly fetch error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
