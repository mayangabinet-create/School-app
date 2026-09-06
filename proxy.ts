import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

// Named `proxy` in a file called proxy.ts: Next 16 renamed the middleware
// convention, and the old name still works but warns on every build.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except Next's own assets and static files. Images are
    // excluded by extension rather than by folder so a file dropped in
    // /public does not start costing an auth round trip.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
