// Tous les montants de la plateforme sont en Pi (π), 7 décimales au maximum.
import { z } from 'zod';
export const piAmount = (max = 1e6) =>
  z.coerce.number().min(0).max(max).refine((v) => Math.abs(v * 1e7 - Math.round(v * 1e7)) < 1e-4, 'Maximum 7 décimales.');
