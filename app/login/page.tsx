import type { Metadata } from "next";
import AuthPage from "../components/AuthPage";

export const metadata: Metadata = {
  title: "Log in · JobSeance",
  description: "Log in or create a JobSeance account to save your job-posting checks.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return <AuthPage mode="login" searchParams={searchParams} />;
}
