import { cn } from "@/lib/utils";

type BrandLogoProps = {
  /** « color » sur fond blanc, « white » sur fond bleu (déclinaisons autorisées par la charte). */
  variant?: "color" | "white";
  /** Pictogramme seul, pour la barre latérale repliée. */
  compact?: boolean;
  className?: string;
};

/**
 * LOGO PROVISOIRE : tracé approché du logotype SIM Assurances, en attendant le fichier vectoriel officiel
 * (voir plan, section 12, question 18). À remplacer par le SVG fourni, sans toucher aux appelants.
 * Rappel de la charte : ne pas déformer, ne pas faire pivoter, respecter l'espace protégé (hauteur du « S »).
 */
export function BrandLogo({ variant = "color", compact = false, className }: BrandLogoProps) {
  const dark = variant === "white" ? "#ffffff" : "#004B9C";
  const light = variant === "white" ? "#ffffff" : "#51AEE2";

  return (
    <svg
      role="img"
      aria-label="SIM Assurances"
      viewBox={compact ? "0 0 60 56" : "0 0 270 56"}
      className={cn(compact ? "h-9 w-auto" : "h-10 w-auto", className)}
    >
      <polygon points="6,50 30,6 54,50 42,50 30,28 18,50" fill={dark} />
      <polygon points="19,41 41,41 37,49 15,49" fill={light} opacity={variant === "white" ? 0.8 : 1} />
      {!compact && (
        <>
          <text
            x="66"
            y="31"
            fill={dark}
            fontFamily="'Montserrat Variable', Arial, sans-serif"
            fontSize="23"
            fontWeight="800"
            textLength="196"
            lengthAdjust="spacingAndGlyphs"
          >
            SIM ASSURANCES
          </text>
          <text
            x="66"
            y="43"
            fill={light}
            fontFamily="'Montserrat Variable', Arial, sans-serif"
            fontSize="6.6"
            fontWeight="600"
            textLength="196"
            lengthAdjust="spacingAndGlyphs"
          >
            SOCIÉTÉ IVOIRIENNE DE MICRO-ASSURANCES
          </text>
        </>
      )}
    </svg>
  );
}
