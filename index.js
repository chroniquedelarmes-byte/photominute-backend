require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const Replicate = require("replicate");
const sharp = require("sharp");
const { FORMATS, buildCustomFormat, cmToPx } = require("./formats");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "15mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const uploadPhotoAndBg = upload.fields([
  { name: "photo", maxCount: 1 },
  { name: "bgImage", maxCount: 1 },
]);

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// ⚠️ Vérifie la version exacte du modèle sur https://replicate.com/851-labs/background-remover
// et colle-la ici (ou dans .env sous REPLICATE_BG_MODEL_VERSION) — les versions changent avec le temps.
const BG_REMOVER_MODEL =
  process.env.REPLICATE_BG_MODEL_VERSION ||
  "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";

// Modèle de restauration/amélioration du visage (lissage peau, netteté, anti-flou léger)
// https://replicate.com/tencentarc/gfpgan
const FACE_ENHANCE_MODEL =
  process.env.REPLICATE_FACE_MODEL_VERSION ||
  "tencentarc/gfpgan:0fbacf7afc6c144e5be9767cff80f25aff23e52b0708f17e20f9879b2f21516c";

// Modèle de retouche de scène/tenue par description texte (Studio)
// https://replicate.com/black-forest-labs/flux-kontext-pro
const SCENE_EDIT_MODEL = process.env.REPLICATE_SCENE_MODEL_VERSION || "black-forest-labs/flux-kontext-pro";

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

app.post("/api/process-photo", uploadPhotoAndBg, async (req, res) => {
  try {
    const { format, bgColor, enhance, brightness, contrast, saturation, customWidthCm, customHeightCm } = req.body;
    const photoFile = req.files && req.files.photo && req.files.photo[0];
    const bgImageFile = req.files && req.files.bgImage && req.files.bgImage[0];

    if (!photoFile) {
      return res.status(400).json({ error: "Aucune photo reçue." });
    }

    const isPlanche = format === "planche";
    let targetFormat;

    if (format === "custom") {
      targetFormat = buildCustomFormat(customWidthCm, customHeightCm);
    } else if (isPlanche) {
      // La planche imprime 6 exemplaires du format CNI (4x4) sur une feuille 10x15
      targetFormat = FORMATS.cni;
    } else if (FORMATS[format]) {
      targetFormat = FORMATS[format];
    } else {
      return res.status(400).json({ error: "Format invalide." });
    }
    const bg = hexToRgb(bgColor || "#FFFFFF");
    const wantEnhance = enhance === "true" || enhance === true;

    let workingBuffer = photoFile.buffer;
    let workingMime = photoFile.mimetype;

    // 0. (Optionnel) Amélioration/lissage du visage avant tout le reste
    if (wantEnhance) {
      const enhanceBase64 = `data:${workingMime};base64,${workingBuffer.toString("base64")}`;
      const enhanceOutput = await replicate.run(FACE_ENHANCE_MODEL, {
        input: { img: enhanceBase64 },
      });
      const enhanceUrl = Array.isArray(enhanceOutput) ? enhanceOutput[0] : enhanceOutput;
      const enhanceRes = await fetch(enhanceUrl);
      workingBuffer = Buffer.from(await enhanceRes.arrayBuffer());
      workingMime = "image/png";
    }

    // 1. Envoyer la photo à Replicate pour supprimer le fond
    const base64Image = `data:${workingMime};base64,${workingBuffer.toString("base64")}`;

    const output = await replicate.run(BG_REMOVER_MODEL, {
      input: { image: base64Image },
    });

    // Le modèle renvoie une URL (ou un tableau d'URLs selon la version)
    const resultUrl = Array.isArray(output) ? output[0] : output;

    const fetchRes = await fetch(resultUrl);
    const fgBuffer = Buffer.from(await fetchRes.arrayBuffer());

    // 2. Redimensionner le sujet détouré pour remplir le cadre cible (recadrage centré)
    const resizedForeground = await sharp(fgBuffer)
      .resize(targetFormat.widthPx, targetFormat.heightPx, { fit: "cover", position: "top" })
      .ensureAlpha()
      .png()
      .toBuffer();

    // 2bis. Adoucir légèrement les bords de la découpe (évite l'effet "collé"/artificiel)
    const featheredAlpha = await sharp(resizedForeground).extractChannel(3).blur(1.4).toBuffer();
    const featheredForeground = await sharp(resizedForeground)
      .removeAlpha()
      .joinChannel(featheredAlpha)
      .png()
      .toBuffer();

    // 3. Préparer le fond : soit une image importée par l'utilisateur, soit une couleur unie
    let backgroundLayer;
    if (bgImageFile) {
      backgroundLayer = await sharp(bgImageFile.buffer)
        .resize(targetFormat.widthPx, targetFormat.heightPx, { fit: "cover", position: "centre" })
        .png()
        .toBuffer();
    } else {
      backgroundLayer = await sharp({
        create: {
          width: targetFormat.widthPx,
          height: targetFormat.heightPx,
          channels: 4,
          background: { r: bg.r, g: bg.g, b: bg.b, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
    }

    // 3bis. Ombre douce derrière le sujet, pour l'ancrer dans le décor comme une vraie photo studio
    const shadowSvg = `
      <svg width="${targetFormat.widthPx}" height="${targetFormat.heightPx}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="${Math.round(targetFormat.widthPx * 0.02)}" />
          </filter>
        </defs>
        <ellipse cx="${targetFormat.widthPx / 2}" cy="${targetFormat.heightPx * 0.97}"
          rx="${targetFormat.widthPx * 0.36}" ry="${targetFormat.heightPx * 0.05}"
          fill="black" opacity="0.16" filter="url(#blur)" />
      </svg>`;
    const shadowLayer = await sharp(Buffer.from(shadowSvg)).png().toBuffer();

    // 4. Composer : fond → ombre douce → sujet détouré (bords adoucis)
    let composed = sharp(backgroundLayer).composite([
      { input: shadowLayer, top: 0, left: 0 },
      { input: featheredForeground, top: 0, left: 0 },
    ]);

    // 5. Retouche couleur (luminosité / contraste / saturation)
    const brightnessVal = brightness ? parseFloat(brightness) : 1;
    const saturationVal = saturation ? parseFloat(saturation) : 1;
    const contrastVal = contrast ? parseFloat(contrast) : 0; // -50 à +50

    if (brightnessVal !== 1 || saturationVal !== 1) {
      composed = composed.modulate({ brightness: brightnessVal, saturation: saturationVal });
    }
    if (contrastVal !== 0) {
      // Formule contraste classique : sortie = entrée * a + b
      const a = 1 + contrastVal / 100;
      const b = 128 * (1 - a);
      composed = composed.linear(a, b);
    }

    const singlePhotoBuffer = await composed.png().toBuffer();

    let finalImage = singlePhotoBuffer;

    // 6. Planche 6 photos : on imprime 6 exemplaires du format CNI sur une feuille 10×15
    if (isPlanche) {
      const sheetWidthPx = cmToPx(10);
      const sheetHeightPx = cmToPx(15);
      const margin = cmToPx(0.4);
      const gap = cmToPx(0.3);
      const cols = 2;
      const rows = 3;
      const cellW = targetFormat.widthPx;
      const cellH = targetFormat.heightPx;

      const composites = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const left = margin + c * (cellW + gap);
          const top = margin + r * (cellH + gap);
          composites.push({ input: singlePhotoBuffer, left, top });
        }
      }

      finalImage = await sharp({
        create: {
          width: sheetWidthPx,
          height: sheetHeightPx,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .composite(composites)
        .png()
        .toBuffer();
    }

    res.set("Content-Type", "image/png");
    res.send(finalImage);
  } catch (err) {
    console.error("Erreur traitement photo:", err);
    res.status(500).json({ error: "Erreur lors du traitement de la photo.", details: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("Photo Minute API — OK");
});

// Studio : édite une photo existante selon une description texte (décor, tenue, ambiance...)
app.post("/api/studio-edit", upload.single("photo"), async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "Aucune photo reçue." });
    }
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Décris ce que tu veux changer sur la photo." });
    }

    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const output = await replicate.run(SCENE_EDIT_MODEL, {
      input: {
        prompt: prompt.trim(),
        input_image: base64Image,
      },
    });

    const resultUrl = Array.isArray(output) ? output[0] : output;
    const fetchRes = await fetch(resultUrl);
    const resultBuffer = Buffer.from(await fetchRes.arrayBuffer());

    res.set("Content-Type", "image/png");
    res.send(resultBuffer);
  } catch (err) {
    console.error("Erreur Studio:", err);
    res.status(500).json({ error: "Erreur lors de la retouche IA.", details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Photo Minute backend lancé sur http://localhost:${PORT}`);
});
