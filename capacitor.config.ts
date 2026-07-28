import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell configuration.
 *
 * The web bundle ships *inside* the app (webDir) rather than being loaded from
 * the network: the shell opens instantly, survives a flaky connection on the
 * shell itself, and is not the "website in a webview" Apple rejects. Only the
 * API is remote, and `npm run build:native` compiles it in via
 * VITE_PUBLIC_ORIGIN — see src/client/lib/origin.ts.
 *
 * webDir is `dist/native`, deliberately not the `dist/client` the server
 * deploys: the web build must stay same-origin/relative.
 */
const config: CapacitorConfig = {
  appId: "com.o11r.tally",
  appName: "Tally",
  webDir: "dist/native",
  ios: {
    // The app draws its own safe-area padding (global.css), so the webview
    // must not add its own inset on top of it.
    contentInset: "never",
    // Matches --color-surface, so the overscroll gutter never flashes white.
    backgroundColor: "#fbfaf7",
  },
};

export default config;
