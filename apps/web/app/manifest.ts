import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aptiloop",
    short_name: "Aptiloop",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#FCFDFC",
    theme_color: "#278A4A",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
