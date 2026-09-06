// Re-export only. The canonical module lives under supabase/functions/_shared/
// because that directory is inside the Edge Function deploy unit, and the whole
// point of these modules is that the server and the browser read the same file
// rather than two copies that drift apart.
//
// A re-export has no content, so it cannot drift. This file exists purely so
// application code can write `@/lib/order` instead of a path through the
// Supabase directory.
export * from "../supabase/functions/_shared/order.mjs";
