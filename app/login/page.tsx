import type { Metadata } from "next";
import AnimatedAuthForm from "../components/AnimatedAuthForm";

export const metadata: Metadata = {
  title: "Log in · JobSeance",
  description: "Log in or create a JobSeance account to save your job-posting checks.",
};

export default function LoginPage() {
  return <AnimatedAuthForm />;
}
