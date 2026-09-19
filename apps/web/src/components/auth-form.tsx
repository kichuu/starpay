import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { Button, Field, inputClass, Panel } from "@/components/kit";
import { Logo } from "@/components/logo";
import { authClient } from "@/lib/auth-client";

type Mode = "sign-in" | "sign-up";

export function AuthForm() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("sign-up");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setPending(true);
    setError(null);
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ email, password, name: String(data.get("name") ?? "") })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? result.error.statusText);
      return;
    }
    navigate({ to: "/" });
  }

  return (
    <div className="flex min-h-svh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <Logo className="mb-8 justify-center" />
        <Panel className="p-7">
          <h1 className="text-xl font-extrabold tracking-[-0.02em]">
            {mode === "sign-up" ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 mb-6 text-[13px] text-muted-foreground">
            {mode === "sign-up"
              ? "Sell digital goods for Telegram Stars."
              : "Sign in to your StarPay dashboard."}
          </p>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            {mode === "sign-up" && (
              <Field label="Name" htmlFor="name">
                <input id="name" name="name" required autoComplete="name" className={inputClass} />
              </Field>
            )}
            <Field label="Email" htmlFor="email">
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className={inputClass}
              />
            </Field>
            <Field label="Password" htmlFor="password" hint={mode === "sign-up" ? "At least 8 characters" : undefined}>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                className={inputClass}
              />
            </Field>
            {error && (
              <p role="alert" className="text-[13px] text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" loading={pending} className="mt-1 w-full">
              {mode === "sign-up" ? "Create account" : "Sign in"}
            </Button>
          </form>
        </Panel>
        <p className="mt-5 text-center text-[13px] text-muted-foreground">
          {mode === "sign-up" ? "Already have an account?" : "New to StarPay?"}{" "}
          <button
            type="button"
            className="cursor-pointer font-semibold text-brand hover:underline"
            onClick={() => {
              setMode(mode === "sign-up" ? "sign-in" : "sign-up");
              setError(null);
            }}
          >
            {mode === "sign-up" ? "Sign in" : "Create an account"}
          </button>
        </p>
      </div>
    </div>
  );
}
