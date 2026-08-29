// Dimensions des formats de photo d'identité, converties en pixels à 300 DPI
// Formule : (cm / 2.54) * DPI
const DPI = 300;
const cmToPx = (cm) => Math.round((cm / 2.54) * DPI);

const FORMATS = {
  cni: {
    label: "CNI / Passeport",
    widthCm: 4,
    heightCm: 4,
    widthPx: cmToPx(4),   // 472px
    heightPx: cmToPx(4),  // 472px
  },
  concours: {
    label: "Concours",
    widthCm: 4,
    heightCm: 6,
    widthPx: cmToPx(4),   // 472px
    heightPx: cmToPx(6),  // 709px
  },
};

module.exports = { FORMATS, DPI };
