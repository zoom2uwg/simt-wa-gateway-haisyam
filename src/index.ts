import express from 'express';
import cors from 'cors';
import { PORT } from './config';
import { logger } from './utils/logger';
import { restoreSessions } from './services/whatsapp';
import router from './routes';

const app = express();

app.use(cors());
app.use(express.json());

// Load routes
app.use('/', router);

// Auto-initialize existing sessions from disk on startup
restoreSessions();

app.listen(PORT, () => {
  logger.info(`[SIMT WA GATEWAY] Server is running on port ${PORT}`);
});
