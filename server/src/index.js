import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db.js';

const app = createApp();
const server = app.listen(config.port, () => console.log(`GÉEJ MARKET API sur :${config.port} (${config.isProd ? 'production' : 'développement'})`));
const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
