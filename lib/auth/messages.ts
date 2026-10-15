// Safe to import from client components (no server dependencies).

export const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_exists: "An account with this email already exists. Sign in the way you did before.",
  oauth_no_email: "Your GitHub account has no verified primary email. Add one on GitHub, then try again.",
  oauth_failed: "Sign-in didn't complete. Please try again.",
  oauth_unavailable: "That sign-in option isn't set up yet.",
};
