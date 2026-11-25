const fs = require("fs");
const path = require("path");

const sizes = [16, 32, 48, 64, 128, 256];
const inDir = path.join(__dirname, "icon-sizes");
const outPath = path.join(__dirname, "icon.ico");

const files = sizes.map((s) => path.join(inDir, `${s}.png`));
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.error(`Arquivo não encontrado: ${f}`);
    console.error("Execute antes: powershell -File build/makeIcon.ps1");
    process.exit(1);
  }
}

(async () => {
  const mod = await import("png-to-ico");
  const pngToIco = mod.default;
  const buf = await pngToIco(files);
  fs.writeFileSync(outPath, buf);
  console.log(`Gerado: ${outPath}`);

  const mobileIcon = path.join(__dirname, "..", "mobile", "icon.png");
  fs.copyFileSync(path.join(__dirname, "icon.png"), mobileIcon);
  console.log(`Gerado: ${mobileIcon}`);
})().catch((e) => { console.error(e); process.exit(1); });
