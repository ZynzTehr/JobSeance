"use client";

import { useRef, useState, type FormEvent } from "react";
import styles from "./AnimatedAuthForm.module.css";

export type AuthValues =
  | { mode: "login"; username: string; password: string }
  | { mode: "signup"; username: string; email: string; password: string };

type Props = {
  /** Connect this callback to your authentication provider or API. */
  onAuthenticate?: (values: AuthValues) => void | Promise<void>;
};

type Mode = AuthValues["mode"];

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

export default function AnimatedAuthForm({ onAuthenticate }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const loginUsername = useRef<HTMLInputElement>(null);
  const signupUsername = useRef<HTMLInputElement>(null);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setStatus("");
    // Wait for the new form's disabled state to update before focusing it.
    requestAnimationFrame(() => {
      const input = nextMode === "login" ? loginUsername : signupUsername;
      input.current?.focus({ preventScroll: true });
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>, formMode: Mode) {
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
      setStatus("Request completed.");
    } catch {
      setStatus("We couldn’t complete your request. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.stage}>
      <section
        className={`${styles.card} ${mode === "signup" ? styles.signup : ""}`}
        aria-label="Account access"
      >
        <div className={styles.diagonal} aria-hidden="true" />

        <form
          className={`${styles.form} ${styles.loginForm}`}
          aria-label="Login"
          aria-hidden={mode !== "login"}
          aria-busy={mode === "login" && pending}
          onSubmit={(event) => handleSubmit(event, "login")}
        >
          <fieldset disabled={mode !== "login" || pending}>
            <legend className={styles.srOnly}>Login credentials</legend>
            <h1 className={styles.animate}>Login</h1>
            <label className={`${styles.field} ${styles.animate}`}>
              <input
                ref={loginUsername}
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
            <label className={`${styles.field} ${styles.animate}`}>
              <input name="password" type="password" autoComplete="current-password" placeholder=" " required />
              <span>Password</span>
              <Icon name="lock" />
            </label>
            <button className={`${styles.submit} ${styles.animate}`} type="submit">
              {pending && mode === "login" ? "Logging in…" : "Login"}
            </button>
            <p className={`${styles.switch} ${styles.animate}`}>
              Don’t have an account?{" "}
              <button type="button" onClick={() => switchMode("signup")} tabIndex={mode === "login" ? 0 : -1}>
                Sign up
              </button>
            </p>
          </fieldset>
        </form>

        <div className={`${styles.welcome} ${styles.loginWelcome}`} aria-hidden={mode !== "login"}>
          <h2 className={styles.animate}>WELCOME<br /> BACK!</h2>
          <p className={styles.animate}>We’re so happy to have you with us again. If you need anything, we are here to help.</p>
        </div>

        <form
          className={`${styles.form} ${styles.signupForm}`}
          aria-label="Register"
          aria-hidden={mode !== "signup"}
          aria-busy={mode === "signup" && pending}
          onSubmit={(event) => handleSubmit(event, "signup")}
        >
          <fieldset disabled={mode !== "signup" || pending}>
            <legend className={styles.srOnly}>Registration details</legend>
            <h1 className={styles.animate}>Register</h1>
            <label className={`${styles.field} ${styles.animate}`}>
              <input
                ref={signupUsername}
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
            <label className={`${styles.field} ${styles.animate}`}>
              <input name="email" type="email" autoComplete="email" placeholder=" " required />
              <span>Email</span>
              <Icon name="email" />
            </label>
            <label className={`${styles.field} ${styles.animate}`}>
              <input name="password" type="password" autoComplete="new-password" placeholder=" " minLength={8} required />
              <span>Password</span>
              <Icon name="lock" />
            </label>
            <button className={`${styles.submit} ${styles.animate}`} type="submit">
              {pending && mode === "signup" ? "Creating account…" : "Register"}
            </button>
            <p className={`${styles.switch} ${styles.animate}`}>
              Already have an account?{" "}
              <button type="button" onClick={() => switchMode("login")} tabIndex={mode === "signup" ? 0 : -1}>
                Sign in
              </button>
            </p>
          </fieldset>
        </form>

        <div className={`${styles.welcome} ${styles.signupWelcome}`} aria-hidden={mode !== "signup"}>
          <h2 className={styles.animate}>WELCOME!</h2>
          <p className={styles.animate}>We’re delighted to have you here. If you need any assistance, feel free to reach out.</p>
        </div>
      </section>
      <p className={styles.status} role="status" aria-live="polite">{status}</p>
    </main>
  );
}
