"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Mail } from "lucide-react";
import { Shell, SetupNotice, Spinner } from "@/components/Shell";
import { isConfigured, supabase } from "@/lib/supabase/client";

export default function SignInPage() {
  return (
    <Suspense fallback={<Shell><Spinner label="טוען…" /></Shell>}>
      <SignIn />
    </Suspense>
  );
}

function SignIn() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (!isConfigured()) return <Shell><SetupNotice /></Shell>;

  /**
   * A link in an email, and no password.
   *
   * It also happens to be the cheapest abuse protection there is: an account
   * cannot exist until somebody has opened a message at that address, so a
   * script cannot stack accounts the way it can against a signup form that
   * takes a password and confirms nothing.
   */
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const client = supabase();
    if (!client) return;

    setState("sending");
    setError(null);

    const { error: err } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (err) {
      console.error(err);
      setState("idle");
      setError("לא הצלחנו לשלוח את המייל. בדוק את הכתובת ונסה שוב.");
      return;
    }
    setState("sent");
  };

  if (state === "sent") {
    return (
      <Shell>
        <div className="card stack rise">
          <h1>שלחנו לך מייל</h1>
          <p className="soft">
            יש בו קישור שמחבר אותך. אפשר לסגור את הדף הזה.
          </p>
          <p className="faint">לא הגיע? בדוק בספאם, או נסה כתובת אחרת.</p>
          <button className="btn" onClick={() => setState("idle")}>נסה כתובת אחרת</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1>התחברות</h1>
      <p className="soft">נשלח לך קישור למייל. אין סיסמה לזכור.</p>

      <form className="card stack" onSubmit={send}>
        <div>
          <label htmlFor="email">כתובת מייל</label>
          <input
            id="email"
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        {error && <div className="notice notice-danger" role="alert">{error}</div>}

        <button className="btn btn-primary btn-block" type="submit"
                disabled={state === "sending" || !email.trim()}>
          {state === "sending" ? <Spinner label="שולח…" /> : (<><Mail size={18} aria-hidden />שלח לי קישור</>)}
        </button>
      </form>
    </Shell>
  );
}
