import { redirect } from "next/navigation";
import AuthPage from "./components/AuthPage";
import { currentUser } from "@/lib/session-user";

/** Landing page: log in or sign up. Every check needs an account; signed-in visitors go straight to the scanner. */
export default async function Home({ searchParams }: PageProps<"/">) {
  if (await currentUser()) redirect("/scan");
  return <AuthPage mode="login" searchParams={searchParams} />;
}
