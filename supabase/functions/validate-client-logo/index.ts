// Validates a cropped client-logo upload server-side and stores it.
//
// Rules enforced (returns a structured error if any fail):
//   - MIME type must be image/png
//   - Decoded image must be exactly 512×512
//   - Image must be a true 1:1 square (width === height)
//   - Image must contain transparent pixels (RGBA with at least one a<255)
//   - File size <= 2 MiB
//
// On success: uploads to the `client-logos` bucket and patches
// `client_testimonials.logo_url` for the given row.
//
// Caller must be an authenticated admin or super_admin (RLS enforces
// the DB write; we additionally check the role here so we can return a
// clean 403 instead of a generic RLS error).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { decode as decodePng } from "https://deno.land/x/pngs@0.1.1/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_BYTES = 2 * 1024 * 1024; // 2 MiB
const REQUIRED_DIM = 512;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "missing_fields"
  | "bad_mime"
  | "file_too_large"
  | "unreadable_png"
  | "wrong_dimensions"
  | "not_square"
  | "not_transparent"
  | "upload_failed"
  | "db_update_failed"
  | "internal";

function fail(code: ErrorCode, message: string, status = 400, extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({ ok: false, code, message, ...extra }),
    { status, headers: { ...cors, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return fail("internal", "Method not allowed", 405);

  try {
    // ── AuthN: get the calling user from the JWT ────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return fail("unauthenticated", "Missing Authorization header", 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return fail("unauthenticated", "Invalid session", 401);
    const userId = userData.user.id;

    // ── AuthZ: must be admin or super_admin ─────────────────────────────
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roles, error: rolesErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (rolesErr) return fail("internal", "Could not read user roles", 500);

    const allowed = (roles ?? []).some((r) => r.role === "admin" || r.role === "super_admin");
    if (!allowed) return fail("forbidden", "Admin or super-admin role required", 403);

    // ── Parse multipart payload ─────────────────────────────────────────
    const form = await req.formData();
    const testimonialId = String(form.get("testimonial_id") ?? "");
    const file = form.get("file");

    if (!testimonialId || !(file instanceof File)) {
      return fail("missing_fields", "Both `testimonial_id` and `file` are required.");
    }
    // The id becomes part of the storage path: it must be a plain UUID (no path segments) and must exist.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(testimonialId)) {
      return fail("missing_fields", "`testimonial_id` must be a valid id.");
    }
    {
      const { data: existing } = await admin.from("client_testimonials").select("id").eq("id", testimonialId).maybeSingle();
      if (!existing) return fail("missing_fields", "Unknown testimonial.", 404);
    }

    // ── Cheap checks before decoding ────────────────────────────────────
    if (file.type !== "image/png") {
      return fail(
        "bad_mime",
        `Logo must be a PNG. Got "${file.type || "unknown"}".`,
      );
    }
    if (file.size === 0) return fail("unreadable_png", "Uploaded file is empty.");
    if (file.size > MAX_BYTES) {
      return fail(
        "file_too_large",
        `Logo is ${(file.size / 1024).toFixed(0)} KB, max is ${MAX_BYTES / 1024} KB.`,
        413,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // ── PNG signature sanity check (89 50 4E 47 0D 0A 1A 0A) ────────────
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 8 || sig.some((b, i) => bytes[i] !== b)) {
      return fail("unreadable_png", "File is not a valid PNG.");
    }

    // ── Decode + validate pixel data ────────────────────────────────────
    let decoded: { width: number; height: number; image: Uint8Array; colorType?: number };
    try {
      decoded = decodePng(bytes);
    } catch (_e) {
      return fail("unreadable_png", "PNG file could not be decoded.");
    }

    const { width, height, image } = decoded;

    if (width !== height) {
      return fail(
        "not_square",
        `Logo must be a 1:1 square. Got ${width}×${height}.`,
        400,
        { width, height },
      );
    }

    if (width !== REQUIRED_DIM || height !== REQUIRED_DIM) {
      return fail(
        "wrong_dimensions",
        `Logo must be exactly ${REQUIRED_DIM}×${REQUIRED_DIM}. Got ${width}×${height}.`,
        400,
        { width, height, required: REQUIRED_DIM },
      );
    }

    // The pngs decoder always returns RGBA (4 bytes per pixel). If the
    // pixel buffer length doesn't match, treat it as malformed.
    const expectedLen = width * height * 4;
    if (image.length !== expectedLen) {
      return fail(
        "unreadable_png",
        "Decoded pixel buffer has unexpected size — image is not a standard RGBA PNG.",
      );
    }

    // Require at least one transparent pixel. Sample every 4th pixel
    // (every 16th byte on the alpha channel) for speed; on a 512×512
    // image that's still 16,384 samples.
    let hasTransparency = false;
    for (let i = 3; i < image.length; i += 16) {
      if (image[i] < 255) { hasTransparency = true; break; }
    }
    if (!hasTransparency) {
      return fail(
        "not_transparent",
        "Logo must have a transparent background. Re-export the PNG with transparency.",
      );
    }

    // ── Upload to storage + patch the row ───────────────────────────────
    const path = `${testimonialId}/${Date.now()}.png`;
    const { error: upErr } = await admin
      .storage
      .from("client-logos")
      .upload(path, bytes, { contentType: "image/png", upsert: true });
    if (upErr) return fail("upload_failed", upErr.message, 500);

    const { data: pub } = admin.storage.from("client-logos").getPublicUrl(path);
    const logoUrl = `${pub.publicUrl}?t=${Date.now()}`;

    const { error: updErr } = await admin
      .from("client_testimonials")
      .update({ logo_url: logoUrl })
      .eq("id", testimonialId);
    if (updErr) return fail("db_update_failed", updErr.message, 500);

    return new Response(
      JSON.stringify({ ok: true, logo_url: logoUrl, width, height }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("validate-client-logo: unexpected error", e);
    return fail("internal", "Unexpected error", 500);
  }
});
