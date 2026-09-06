import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Where the link in the email lands.
 *
 * Every failure here goes back to /signin with a reason, never to a blank page
 * — an expired link is the single most common way anyone arrives at this route,
 * and it needs to read as "ask for another one", not as a broken site.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  // Only a path, never an absolute URL: a `next` a stranger controls is an
  // open redirect, and a sign-in flow is exactly where one gets used.
  const requested = searchParams.get("next") ?? "/";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!code || !url || !key) {
    return NextResponse.redirect(`${origin}/signin?error=link`);
  }

  const store = await cookies();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("sign-in exchange failed:", error);
    return NextResponse.redirect(`${origin}/signin?error=expired`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
