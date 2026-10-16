import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// En-têtes de sécurité (CDC A.9).
//
// CSP : une politique à nonce imposerait un rendu 100 % dynamique et est incompatible avec le rendu partiel
// (cacheComponents) utilisé par l'application ; l'option SRI de Next ne couvre pas ses scripts EN LIGNE (flux de données
// du rendu), et sans eux la page ne s'hydrate plus (essai du 16/10/2026). `script-src` garde donc `'unsafe-inline'`.
// La politique reste utile : aucun script, connexion, cadre ni objet venant d'un autre hôte, pas de <base> détourné, pas de
// formulaire vers l'extérieur. La parade contre l'injection de script reste l'échappement de React (aucun
// `dangerouslySetInnerHTML`) et la validation des entrées. En développement, React exige en plus `unsafe-eval`.
const contentSecurityPolicy = [
  "default-src 'self'",
  isProduction ? "script-src 'self' 'unsafe-inline'" : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  isProduction ? "connect-src 'self'" : "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  ...(isProduction
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Modules Node natifs ou utilisant des workers : non empaquetés par le bundler.
  serverExternalPackages: ["pino", "pg"],
  // Dépôt des fichiers d'import (5 Mo au maximum, vérifié par le serveur) + 1 Mo pour l'enveloppe multipart.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
