import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, Setting } from "./db.js";

export const logoDir = path.join(
  path.resolve(process.env.UPLOAD_DIR || "uploads"),
  "branding",
);
await fs.mkdir(logoDir, { recursive: true });
const schema = z.object({
  name: z.string().trim().min(1).max(60),
  logo: z
    .object({
      id: z.uuid(),
      mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
    })
    .nullable(),
});
export async function readBranding(transaction) {
  const row = await Setting.findByPk("branding", { transaction });
  return row
    ? schema.parse(JSON.parse(row.value))
    : { name: "Projektwerk", logo: null };
}
export const publicBranding = (brand) => ({
  name: brand.name,
  logoUrl: brand.logo ? `/api/branding/logo/${brand.logo.id}` : null,
  logoMime: brand.logo?.mime || null,
});
const invalidLogo = () =>
  Object.assign(
    new Error(
      "Bitte ein gültiges PNG-, JPG- oder WebP-Logo mit maximal 4096 × 4096 Pixeln wählen.",
    ),
    { status: 400 },
  );
export function validateLogo(buffer) {
  let mime, width, height;
  if (
    buffer.length >= 45 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.toString("ascii", 12, 16) === "IHDR" &&
    buffer.toString("ascii", buffer.length - 8, buffer.length - 4) === "IEND"
  ) {
    mime = "image/png";
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  } else if (
    buffer.length >= 12 &&
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer.at(-2) === 255 &&
    buffer.at(-1) === 217
  ) {
    // Find a JPEG frame header rather than trusting the submitted MIME or suffix.
    for (let offset = 2; offset + 4 < buffer.length;) {
      if (buffer[offset++] !== 255) break;
      while (buffer[offset] === 255) offset++;
      const marker = buffer[offset++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 8
      ) {
        mime = "image/jpeg";
        height = buffer.readUInt16BE(offset + 3);
        width = buffer.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  } else if (
    buffer.length >= 30 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.readUInt32LE(4) + 8 === buffer.length &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    const format = buffer.toString("ascii", 12, 16);
    if (format === "VP8X") {
      width = buffer.readUIntLE(24, 3) + 1;
      height = buffer.readUIntLE(27, 3) + 1;
    } else if (format === "VP8L" && buffer[20] === 47) {
      const bits = buffer.readUInt32LE(21);
      width = (bits & 16383) + 1;
      height = ((bits >>> 14) & 16383) + 1;
    } else if (
      format === "VP8 " &&
      buffer.subarray(23, 26).equals(Buffer.from([157, 1, 42]))
    ) {
      width = buffer.readUInt16LE(26) & 16383;
      height = buffer.readUInt16LE(28) & 16383;
    }
    mime = "image/webp";
  }
  if (!mime || !width || !height || width > 4096 || height > 4096)
    throw invalidLogo();
  return mime;
}
export async function saveBranding({ name, removeLogo }, file) {
  if (file && removeLogo)
    throw Object.assign(
      new Error("Logo hochladen oder entfernen, nicht beides gleichzeitig."),
      { status: 400 },
    );
  const logo = file
    ? { id: randomUUID(), mime: validateLogo(file.buffer) }
    : null;
  let oldLogo, saved;
  if (logo)
    await fs.writeFile(path.join(logoDir, logo.id), file.buffer, {
      flag: "wx",
    });
  try {
    saved = await db.transaction(async (transaction) => {
      await Setting.findByPk("installation", {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      const previous = await readBranding(transaction);
      const next = { name, logo: logo || (removeLogo ? null : previous.logo) };
      if (previous.logo?.id !== next.logo?.id) oldLogo = previous.logo;
      await Setting.upsert(
        { key: "branding", value: JSON.stringify(next) },
        { transaction },
      );
      return next;
    });
  } catch (error) {
    if (logo) await fs.unlink(path.join(logoDir, logo.id)).catch(() => {});
    throw error;
  }
  if (oldLogo) await fs.unlink(path.join(logoDir, oldLogo.id)).catch(() => {});
  return publicBranding(saved);
}
