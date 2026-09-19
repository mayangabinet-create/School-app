"use client";

import { schoolSupabaseURL, schoolPublishableKey } from "./project";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The browser's Supabase client, or null when the app has not been configured.
 *
 * Null rather than a thrown error on purpose: a missing environment variable is
 * a deployment mistake, and the screen it produces should say so in a sentence
 * a person can act on, not a stack trace or a blank page. Every caller treats
 * null the same way it treats any other failure — by showing something.
 */
let cached: SupabaseClient | null | undefined;

export function supabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || schoolSupabaseURL);
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || schoolPublishableKey);
  cached = url && key ? createBrowserClient(url, key) : null;
  return cached;
}

export function isConfigured(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || schoolSupabaseURL) && (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || schoolPublishableKey),
  );
}
