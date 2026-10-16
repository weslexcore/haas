/**
 * A synthetic photo for the sample library, so Develop and export work
 * without real files. Mirrors the CSS placeholder: a sky-to-ground gradient,
 * a sun, plus a grey ramp and colour bars that make edits easy to see.
 */
export async function sampleImage(hue: number, width = 1500, height = 1000): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const sky = ctx.createLinearGradient(0, 0, width * 0.2, height);
  sky.addColorStop(0, `hsl(${hue} 45% 55%)`);
  sky.addColorStop(0.6, `hsl(${(hue + 30) % 360} 40% 30%)`);
  sky.addColorStop(1, `hsl(${(hue + 60) % 360} 35% 16%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const sun = ctx.createRadialGradient(width * 0.7, height * 0.3, 0, width * 0.7, height * 0.3, height * 0.12);
  sun.addColorStop(0, `hsl(${(hue + 40) % 360} 80% 85%)`);
  sun.addColorStop(0.7, `hsl(${(hue + 40) % 360} 70% 70% / 0.9)`);
  sun.addColorStop(1, "transparent");
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, width, height);

  // Grey ramp and colour bars along the bottom.
  const bar = height * 0.06;
  for (let i = 0; i < 16; i++) {
    const v = Math.round((i / 15) * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect((i * width) / 16, height - bar * 2, width / 16 + 1, bar);
  }
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `hsl(${i * 45} 75% 50%)`;
    ctx.fillRect((i * width) / 8, height - bar, width / 8 + 1, bar);
  }
  return createImageBitmap(canvas);
}
