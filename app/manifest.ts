import type { MetadataRoute } from "next";

/** Web app manifest: the name and icons used when someone adds JobSeance to a home screen. Icons come from scripts/make-icons.mjs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JobSeance",
    short_name: "JobSeance",
    description: "Check a job posting or recruiter message for ghost-job risk and scam risk.",
    start_url: "/scan",
    display: "standalone",
    background_color: "#121a2f",
    theme_color: "#121a2f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
