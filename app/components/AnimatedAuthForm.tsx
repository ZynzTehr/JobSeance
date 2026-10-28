"use client";

import { useRef, useState, type CSSProperties, type SubmitEvent, type ReactNode } from "react";
import { passwordRules } from "@/lib/auth/password-rules";
import styles from "./AnimatedAuthForm.module.css";

export type AuthValues =
  | { mode: "login"; username: string; password: string }
  | { mode: "signup"; username: string; email: string; password: string };

type Props = {
  /** Connect this callback to your authentication provider or API. Throw an Error to show its message. */
  onAuthenticate?: (values: AuthValues) => void | Promise<void>;
  /** Which side the card opens on (`/signup` opens Register). */
  initialMode?: Mode;
  /** A message to show on load, e.g. after a failed Google or GitHub sign-in. */
  initialStatus?: string;
  /** Social sign-in buttons; each one shows only when its provider is configured. */
  oauth?: { google: boolean; github: boolean };
  /** Shown just below the card, e.g. the age and Terms notice. */
  footer?: ReactNode;
};

type Mode = AuthValues["mode"];

// Outgoing items use --out; incoming items use --in. Delays are in tenths of a second.
const timing = (out: number, incoming: number) => ({ "--out": out, "--in": incoming }) as CSSProperties;

function ProviderIcon({ provider }: { provider: "google" | "github" }) {
  if (provider === "google") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z"
      />
    </svg>
  );
}

function OAuthButtons({
  oauth,
  active,
  style,
}: {
  oauth: NonNullable<Props["oauth"]>;
  active: boolean;
  style: CSSProperties;
}) {
  const providers = (["google", "github"] as const).filter((p) => oauth[p]);
  if (providers.length === 0) return null;
  return (
    <div className={`${styles.oauth} ${styles.animate}`} style={style}>
      <span className={styles.oauthDivider}>or continue with</span>
      <div className={styles.oauthRow}>
        {providers.map((p) => (
          <a key={p} className={styles.oauthButton} href={`/api/auth/${p}`} tabIndex={active ? 0 : -1}>
            <ProviderIcon provider={p} />
            {p === "google" ? "Google" : "GitHub"}
          </a>
        ))}
      </div>
    </div>
  );
}

function Icon({ name }: { name: "user" | "email" | "lock" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "user" && (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
        </>
      )}
      {name === "email" && (
        <>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m3 7 9 6 9-6" />
        </>
      )}
      {name === "lock" && (
        <>
          <rect x="4" y="10" width="16" height="11" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3M12 15v2" />
        </>
      )}
    </svg>
  );
}

export default function AnimatedAuthForm({
  onAuthenticate,
  initialMode = "login",
  initialStatus = "",
  oauth = { google: false, github: false },
  footer,
}: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const hasOAuth = oauth.google || oauth.github;
  // With social sign-in each form has one more row, so the items after it shift one step later.
  const extra = hasOAuth ? 1 : 0;
  const loginForm = useRef<HTMLFormElement>(null);
  const signupForm = useRef<HTMLFormElement>(null);
  // Register side: the welcome text gives way to the password checklist while it's in use.
  const [password, setPassword] = useState("");
  const [passwordFocused, setPasswordFocused] = useState(false);
  const showRules = mode === "signup" && (passwordFocused || password !== "");
  const rules = passwordRules(password);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setStatus("");
    // Keep keyboard users in the new form without focusing a field: a focused
    // username would float its label and show a caret before anyone asked for it.
    requestAnimationFrame(() => {
      const form = nextMode === "login" ? loginForm : signupForm;
      form.current?.focus({ preventScroll: true });
    });
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>, formMode: Mode) {
    event.preventDefault();
    if (pending) return;

    const data = new FormData(event.currentTarget);
    const credentials = {
      username: String(data.get("username") ?? "").trim(),
      password: String(data.get("password") ?? ""),
    };
    const values: AuthValues =
      formMode === "signup"
        ? { ...credentials, mode: "signup", email: String(data.get("email") ?? "").trim() }
        : { ...credentials, mode: "login" };

    if (!onAuthenticate) {
      setStatus("Demo only. Connect onAuthenticate to enable authentication.");
      return;
    }

    setPending(true);
    setStatus("");
    try {
      await onAuthenticate(values);
      setStatus("Signed in. Taking you to the scanner…");
    } catch (error) {
      setStatus(
        error instanceof Error && error.message ? error.message : "We couldn’t complete your request. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.stage}>
      <div className={`${styles.frame} ${hasOAuth ? styles.withOAuth : ""}`}>
        <section className={`${styles.card} ${mode === "signup" ? styles.signup : ""}`} aria-label="Account access">
          <div className={styles.orangePanel} aria-hidden="true" />
          <div className={styles.darkPanel} aria-hidden="true" />

          <form
            ref={loginForm}
            tabIndex={-1}
            className={`${styles.form} ${styles.loginForm}`}
            aria-label="Login"
            aria-hidden={mode !== "login"}
            aria-busy={mode === "login" && pending}
            onSubmit={(event) => handleSubmit(event, "login")}
          >
            <fieldset disabled={mode !== "login" || pending}>
              <legend className={styles.srOnly}>Login credentials</legend>
              <h1 className={styles.animate} style={timing(0, 21)}>
                Login
              </h1>
              <label className={`${styles.field} ${styles.animate}`} style={timing(1, 22)}>
                <input
                  name="username"
                  type="text"
                  autoComplete="username"
                  placeholder=" "
                  required
                  pattern=".*\S.*"
                />
                <span>Username</span>
                <Icon name="user" />
              </label>
              <label className={`${styles.field} ${styles.animate}`} style={timing(2, 23)}>
                <input name="password" type="password" autoComplete="current-password" placeholder=" " required />
                <span>Password</span>
                <Icon name="lock" />
              </label>
              <button className={`${styles.submit} ${styles.animate}`} style={timing(3, 24)} type="submit">
                {pending && mode === "login" ? "Logging in…" : "Login"}
              </button>
              <OAuthButtons oauth={oauth} active={mode === "login"} style={timing(4, 25)} />
              <p className={`${styles.switch} ${styles.animate}`} style={timing(4 + extra, 25 + extra)}>
                Don’t have an account?{" "}
                <button type="button" onClick={() => switchMode("signup")} tabIndex={mode === "login" ? 0 : -1}>
                  Sign up
                </button>
              </p>
            </fieldset>
          </form>

          <div className={`${styles.welcome} ${styles.loginWelcome}`} aria-hidden={mode !== "login"}>
            <h2 className={styles.animate} style={timing(0, 20)}>
              BACK ON
              <br /> THE CASE?
            </h2>
            <p className={styles.animate} style={timing(1, 21)}>
              Your saved checks and applications are right where you left them. Let&rsquo;s see which postings are still
              alive.
            </p>
          </div>

          <form
            ref={signupForm}
            tabIndex={-1}
            className={`${styles.form} ${styles.signupForm}`}
            aria-label="Register"
            aria-hidden={mode !== "signup"}
            aria-busy={mode === "signup" && pending}
            onSubmit={(event) => handleSubmit(event, "signup")}
          >
            <fieldset disabled={mode !== "signup" || pending}>
              <legend className={styles.srOnly}>Registration details</legend>
              <h1 className={styles.animate} style={timing(17, 0)}>
                Register
              </h1>
              <label className={`${styles.field} ${styles.animate}`} style={timing(18, 1)}>
                <input
                  name="username"
                  type="text"
                  autoComplete="username"
                  placeholder=" "
                  required
                  maxLength={20}
                  pattern="[A-Za-z0-9_]{3,20}"
                  title="3–20 letters, numbers or underscores"
                />
                <span>Username</span>
                <Icon name="user" />
              </label>
              <label className={`${styles.field} ${styles.animate}`} style={timing(19, 2)}>
                <input name="email" type="email" autoComplete="email" placeholder=" " required />
                <span>Email</span>
                <Icon name="email" />
              </label>
              <label className={`${styles.field} ${styles.animate}`} style={timing(20, 3)}>
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder=" "
                  minLength={8}
                  maxLength={64}
                  title="8–64 characters with an uppercase letter, a number and a symbol"
                  required
                  aria-describedby="password-rules"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                />
                <span>Password</span>
                <Icon name="lock" />
              </label>
              <button className={`${styles.submit} ${styles.animate}`} style={timing(21, 4)} type="submit">
                {pending && mode === "signup" ? "Creating account…" : "Register"}
              </button>
              <OAuthButtons oauth={oauth} active={mode === "signup"} style={timing(22, 5)} />
              <p className={`${styles.switch} ${styles.animate}`} style={timing(22 + extra, 5 + extra)}>
                Already have an account?{" "}
                <button type="button" onClick={() => switchMode("login")} tabIndex={mode === "signup" ? 0 : -1}>
                  Sign in
                </button>
              </p>
            </fieldset>
          </form>

          <div className={`${styles.welcome} ${styles.signupWelcome}`} aria-hidden={mode !== "signup"}>
            {/* Intro and checklist share one grid cell and cross-fade, so the panel never jumps. */}
            <div className={styles.swap} data-rules={showRules}>
              <div className={styles.intro} aria-hidden={showRules}>
                <h2 className={styles.animate} style={timing(17, 0)}>
                  JOIN THE
                  <br /> SÉANCE
                </h2>
                <p className={styles.animate} style={timing(18, 1)}>
                  Check postings, track every application, and report scams so the next job seeker knows what&rsquo;s
                  real.
                </p>
              </div>
              <div className={styles.rules}>
                <h2 className={`${styles.rulesTitle} ${styles.animate}`} style={timing(17, 0)}>
                  Your password needs
                </h2>
                <ul id="password-rules" className={styles.animate} style={timing(18, 1)}>
                  {rules.map((rule) => (
                    <li key={rule.id} className={styles.rule} data-met={rule.met}>
                      <svg className={styles.check} viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                      <span>{rule.label}</span>
                      <span className={styles.srOnly}>{rule.met ? " (done)" : " (not yet)"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {status}
      </p>
      {footer}
    </main>
  );
}
