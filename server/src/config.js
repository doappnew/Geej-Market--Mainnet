import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';
if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET (32 caractères minimum) est obligatoire en production.');
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres@localhost:5433/geej',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  // Schéma PostgreSQL dédié (ex. « mainnet ») pour partager un projet Supabase sans mélanger les données avec une autre version.
  dbSchema: (process.env.DB_SCHEMA || '').trim(),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret',
  corsOrigin: process.env.CORS_ORIGIN || '',
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  supabaseKey: process.env.SUPABASE_SERVICE_KEY || '',
  supabaseBucket: process.env.SUPABASE_BUCKET || 'product-images',
  piApiKey: process.env.PI_API_KEY || '',
  piValidationKey: process.env.PI_VALIDATION_KEY || '',
};
