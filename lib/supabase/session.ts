import { schoolSupabaseURL, schoolPublishableKey } from "./project";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresh the session on every request and decide who may pass.
 *
 * The refresh has to happen here rather than in a page, because a Server
 * Component cannot write the rotated cookie back. Without it a student who
 * leaves the tab open overnight comes back to a page that renders, fetches
 * nothing, and shows an empty list — which reads as "my homework is gone".
 */
export async function updateSession(request: NextRequest) {
  if (["/scan", "/progress", "/signin"].includes(request.nextUrl.pathname) || request.nextUrl.pathname.startsWith("/assignments/")) {
    const home = request.nextUrl.clone(); home.pathname = "/";
    return NextResponse.redirect(home);
  }
  let response = NextResponse.next({ request });

  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || schoolSupabaseURL);
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || schoolPublishableKey);

  // Unconfigured is not unauthorised. The pages already show a setup notice
  // that says what is missing; redirecting to a sign-in that also cannot work
  // would replace an explanation with a loop.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser, not getSession: it verifies the token with the auth server rather
  // than trusting a cookie the browser handed us.
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path === "/" || path === "/planner" || path.startsWith("/signin") || path.startsWith("/auth");

  if (!user && !isPublic) {
    const signin = request.nextUrl.clone();
    signin.pathname = "/signin";
    // Come back to where they were trying to go, not to the home screen.
    signin.searchParams.set("next", path);
    return NextResponse.redirect(signin);
  }

  if (user && path.startsWith("/signin")) {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}
