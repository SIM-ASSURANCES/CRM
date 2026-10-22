import Image from "next/image";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  /** « color » sur fond blanc, « white » sur fond bleu (déclinaisons autorisées par la charte). */
  variant?: "color" | "white";
  /** Pictogramme seul, pour la barre latérale repliée. */
  compact?: boolean;
  className?: string;
};

// Logo officiel SIM Assurances : fichiers de `public/` (`logosim.webp` = logotype blanc fourni, `favicon.png` = pictogramme en
// couleurs). Les variantes colorées et le pictogramme seul sont DÉRIVÉS de ces deux fichiers par `npm run brand:assets`.
// Rappel de la charte : ne pas déformer, ne pas faire pivoter (la hauteur fixe la taille ; la largeur suit les proportions).
const ASSETS = {
  full: {
    color: { src: "/logosim-couleur.webp", width: 635, height: 94 },
    white: { src: "/logosim.webp", width: 635, height: 94 },
  },
  compact: {
    color: { src: "/logosim-icone-couleur.webp", width: 108, height: 94 },
    white: { src: "/logosim-icone.webp", width: 114, height: 94 },
  },
} as const;

export function BrandLogo({ variant = "color", compact = false, className }: BrandLogoProps) {
  const asset = ASSETS[compact ? "compact" : "full"][variant];

  return (
    // Fichier statique déjà optimisé (WebP) : servi tel quel, sans passer par l'optimiseur d'images de Next.
    <Image
      src={asset.src}
      width={asset.width}
      height={asset.height}
      alt="SIM Assurances"
      unoptimized
      priority
      className={cn(compact ? "h-9 w-auto" : "h-10 w-auto", className)}
    />
  );
}
