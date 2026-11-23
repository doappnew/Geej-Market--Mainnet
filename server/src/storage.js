import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { config } from './config.js';
import { HttpError } from './util.js';

export const uploadDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../uploads');

// Optimise (redimensionne + WebP) puis stocke. Le décodage par sharp valide aussi que c'est bien une image.
export async function saveImage(buffer) {
  let out;
  try {
    out = await sharp(buffer, { failOn: 'error' }).rotate().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch {
    throw new HttpError(400, "Fichier image invalide (formats acceptés: JPEG, PNG, WebP).", 'bad_image');
  }
  const name = `${crypto.randomBytes(12).toString('hex')}.webp`;
  if (config.supabaseUrl && config.supabaseKey) {
    const r = await fetch(`${config.supabaseUrl}/storage/v1/object/${config.supabaseBucket}/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.supabaseKey}`, apikey: config.supabaseKey, 'Content-Type': 'image/webp', 'x-upsert': 'false' },
      body: out,
    });
    if (!r.ok) {
      console.error('storage: Supabase Storage', r.status);
      throw new HttpError(502, "Échec de l'envoi de l'image vers le stockage.", 'storage_failed');
    }
    return `${config.supabaseUrl}/storage/v1/object/public/${config.supabaseBucket}/${name}`;
  }
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, name), out);
  return `/uploads/${name}`;
}
