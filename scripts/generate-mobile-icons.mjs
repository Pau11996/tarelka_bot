// Run with `node scripts/generate-mobile-icons.mjs` (requires ImageMagick).
// Rasterize the editable vector; centre the plate, including for adaptive icons.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const assets = fileURLToPath(new URL("../mobile/assets/", import.meta.url));
const source = readFileSync(`${assets}app-icon.svg`, "utf8");
const render = (name, size, viewBox, background, monochrome = false) => {
  let svg = source.replace('viewBox="-10 -1 66 66"', `viewBox="${viewBox}"`);
  if (monochrome) {
    // White shapes and a black vein form an alpha mask for the themed icon.
    const paths = svg.slice(svg.indexOf("<path"), svg.lastIndexOf("</svg>"))
      .replaceAll("#1A4030", "white").replaceAll("#3C9A46", "white").replaceAll("#E8F6E6", "black");
    svg = svg.slice(0, svg.indexOf("<path")) + `<defs><mask id="mark" maskUnits="userSpaceOnUse" x="-16" y="-7" width="78" height="78">${paths}</mask></defs><rect x="-16" y="-7" width="78" height="78" fill="black" mask="url(#mark)"/></svg>`;
  }
  const temporary = mkdtempSync(join(tmpdir(), "tarelka-icon-"));
  try {
    const vector = join(temporary, "icon.svg");
    writeFileSync(vector, svg);
    execFileSync("convert", ["-background", background, vector, "-resize", `${size}x${size}`, `${background === "none" ? "png32" : "png24"}:${assets}${name}.png`]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
};

render("icon", 1024, "-10 -1 66 66", "#F4FBF6");
render("android-icon-foreground", 512, "-16 -7 78 78", "none");
render("android-icon-monochrome", 432, "-16 -7 78 78", "none", true);
render("favicon", 48, "-10 -1 66 66", "#F4FBF6");
