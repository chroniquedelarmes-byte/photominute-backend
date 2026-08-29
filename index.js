require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const Replicate = require("replicate");
const sharp = require("sharp");
const { FORMATS } = require("./formats");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "15mb" }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// ⚠️ Vérifie la version exacte du modèle sur https://replicate.com/851-labs/background-remover
// et colle-la ici (ou dans .env sous REPLICATE_BG_MODEL_VERSION) — les versions changent avec le temps.
const BG_REMOVER_MODEL =
  process.env.REPLICATE_BG_MODEL_VERSION ||
  "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc";

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

app.post("/api/process-photo", upload.single("photo"), async (req, res) => {
  try {
    const { format, bgColor } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "Aucune photo reçue." });
    }
    if (!FORMATS[format]) {
      return res.status(400).json({ error: "Format invalide. Utilise 'cni' ou 'concours'." });
    }

    const targetFormat = FORMATS[format];
    const bg = hexToRgb(bgColor || "#FFFFFF");

    // 1. Envoyer la photo à Replicate pour supprimer le fond
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

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
      .png()
      .toBuffer();

    // 3. Créer le fond de couleur choisie et composer la photo dessus
    const finalImage = await sharp({
      create: {
        width: targetFormat.widthPx,
        height: targetFormat.heightPx,
        channels: 4,
        background: { r: bg.r, g: bg.g, b: bg.b, alpha: 1 },
      },
    })
      .composite([{ input: resizedForeground, top: 0, left: 0 }])
      .png()
      .toBuffer();

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

app.listen(PORT, () => {
  console.log(`✅ Photo Minute backend lancé sur http://localhost:${PORT}`);
});
