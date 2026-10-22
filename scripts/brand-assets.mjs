// Fabrique les variantes d'image de la marque à partir des deux fichiers fournis dans `public/` :
//   - public/logosim.webp  : logotype COMPLET en blanc, fond transparent (pictogramme + « SIM ASSURANCES » + signature)
//   - public/favicon.png   : pictogramme « AS » en couleurs (non carré, très grand)
//
// Sorties (réécrites à chaque exécution : `npm run brand:assets`) :
//   public/logosim-couleur.webp        logotype coloré pour fonds blancs (pictogramme du favicon + texte recoloré)
//   public/logosim-icone.webp          pictogramme seul, blanc (barre latérale repliée)
//   public/logosim-icone-couleur.webp  pictogramme seul, en couleurs
//   src/app/icon.png                   icône d'onglet 512×512 (carrée, fond transparent)
//   src/app/apple-icon.png             icône d'écran d'accueil 180×180 (fond blanc, exigé par iOS)
//
// Les couleurs du texte sont celles de la charte déjà utilisées dans l'application : bleu #004B9C (titre) et #51AEE2
// (signature). Ces variantes sont DÉRIVÉES : si le fichier officiel du logotype en couleurs est fourni, le placer dans
// public/ sous le nom logosim-couleur.webp et ne plus lancer ce script.
import sharp from "sharp";

const DARK = [0x00, 0x4b, 0x9c];
const LIGHT = [0x51, 0xae, 0xe2];
const OPAQUE = 40;

const { data, info } = await sharp("public/logosim.webp").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
const at = (x, y) => (y * width + x) * 4;

// --- Formes connexes : le pictogramme (3 formes) se distingue des lettres, même s'ils se chevauchent en largeur. ----------
const label = new Int32Array(width * height).fill(-1);
const shapes = [];
for (let sy = 0; sy < height; sy += 1) {
  for (let sx = 0; sx < width; sx += 1) {
    if (label[sy * width + sx] !== -1 || data[at(sx, sy) + 3] <= OPAQUE) continue;
    const id = shapes.length;
    const shape = { id, minX: sx, maxX: sx, minY: sy, maxY: sy };
    const stack = [[sx, sy]];
    label[sy * width + sx] = id;
    while (stack.length > 0) {
      const [x, y] = stack.pop();
      shape.minX = Math.min(shape.minX, x);
      shape.maxX = Math.max(shape.maxX, x);
      shape.minY = Math.min(shape.minY, y);
      shape.maxY = Math.max(shape.maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (label[ny * width + nx] !== -1 || data[at(nx, ny) + 3] <= OPAQUE) continue;
          label[ny * width + nx] = id;
          stack.push([nx, ny]);
        }
      }
    }
    shapes.push(shape);
  }
}
// Le pictogramme occupe un carré d'environ la hauteur du logotype, à gauche : ses formes commencent avant x ≈ hauteur.
const markShapes = new Set(shapes.filter((shape) => shape.minX < height * 1.05).map((shape) => shape.id));
if (markShapes.size === 0) throw new Error("Pictogramme introuvable dans logosim.webp");
const isMark = (x, y) => markShapes.has(label[y * width + x]);

const box = shapes.filter((shape) => markShapes.has(shape.id)).reduce(
  (acc, s) => ({ left: Math.min(acc.left, s.minX), top: Math.min(acc.top, s.minY), right: Math.max(acc.right, s.maxX), bottom: Math.max(acc.bottom, s.maxY) }),
  { left: width, top: height, right: 0, bottom: 0 },
);
const markWidth = box.right - box.left + 1;
const markHeight = box.bottom - box.top + 1;

// Première ligne vide du texte seul, après le début du titre : sépare le titre de la signature (les accents de
// « SOCIÉTÉ » touchent le haut de la signature, pas le titre : une seule ligne vide suffit). Renvoie la dernière ligne du titre.
function titleEnd() {
  let started = false;
  for (let y = 0; y < height; y += 1) {
    let filled = false;
    for (let x = 0; x < width && !filled; x += 1) filled = !isMark(x, y) && data[at(x, y) + 3] > OPAQUE;
    if (filled) started = true;
    else if (started) return y - 1;
  }
  throw new Error("Signature introuvable dans logosim.webp");
}
const gap = titleEnd();
console.log(`logotype ${width}×${height} : pictogramme ${markWidth}×${markHeight} en (${box.left}, ${box.top}), titre jusqu'à y=${gap}`);

// --- 1) Pictogramme blanc : uniquement les formes du pictogramme. -------------------------------------------------------
const whiteMarkRaw = Buffer.from(data);
for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (!isMark(x, y)) whiteMarkRaw[at(x, y) + 3] = 0;
const whiteMark = await sharp(whiteMarkRaw, { raw: { width, height, channels: 4 } })
  .extract({ left: box.left, top: box.top, width: markWidth, height: markHeight })
  .png()
  .toBuffer();
await sharp(whiteMark).webp({ quality: 95, alphaQuality: 100 }).toFile("public/logosim-icone.webp");

// --- 2) Pictogramme en couleurs : le favicon, rogné, à la hauteur du pictogramme blanc (proportions respectées). ------------
const colorMarkFull = await sharp("public/favicon.png").trim().png().toBuffer();
const colorMark = await sharp(colorMarkFull).resize({ height: markHeight }).png().toBuffer();
const colorMarkMeta = await sharp(colorMark).metadata();
await sharp(colorMark).webp({ quality: 95, alphaQuality: 100 }).toFile("public/logosim-icone-couleur.webp");

// --- 3) Logotype coloré : texte recoloré (titre bleu foncé, signature bleu clair) + pictogramme coloré centré à sa place. ---
const text = Buffer.from(data);
for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const i = at(x, y);
    const [r, g, b] = y <= gap ? DARK : LIGHT;
    text[i] = r;
    text[i + 1] = g;
    text[i + 2] = b;
    if (isMark(x, y)) text[i + 3] = 0; // remplacé par la version colorée
  }
}
await sharp(text, { raw: { width, height, channels: 4 } })
  .composite([{ input: colorMark, left: box.left + Math.round((markWidth - colorMarkMeta.width) / 2), top: box.top }])
  .webp({ quality: 95, alphaQuality: 100 })
  .toFile("public/logosim-couleur.webp");

// --- 4) Icônes carrées : le pictogramme centré avec une petite marge. ----------------------------------------------------
async function squareIcon(size, background, target) {
  const inner = Math.round(size * 0.84);
  const mark = await sharp(colorMarkFull).resize({ width: inner, height: inner, fit: "inside" }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(target);
}
await squareIcon(512, { r: 0, g: 0, b: 0, alpha: 0 }, "src/app/icon.png");
await squareIcon(180, { r: 255, g: 255, b: 255, alpha: 1 }, "src/app/apple-icon.png");
console.log("variantes écrites : logosim-couleur, logosim-icone, logosim-icone-couleur, icon.png, apple-icon.png");
