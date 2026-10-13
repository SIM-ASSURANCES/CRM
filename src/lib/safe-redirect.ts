/**
 * N'accepte qu'un chemin interne (« /accounts »). Toute valeur pouvant mener hors de l'application
 * (URL absolue, « //hôte », « /\hôte », protocole) est ignorée : protection contre les redirections ouvertes.
 */
export function safeRedirectPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}
