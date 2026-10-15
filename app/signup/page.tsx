import type { Metadata } from "next";
import AuthPage from "../components/AuthPage";

export const metadata: Metadata = {
  title: "Sign up · JobSeance",
  description: "Create a free JobSeance account to save checks and log application outcomes.",
};

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return <AuthPage mode="signup" searchParams={searchParams} />;
}
