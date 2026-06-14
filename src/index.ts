import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  ConnectionState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import axios from 'axios';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8081;
const API_KEY = process.env.WA_GATEWAY_API_KEY || 'dev-api-key';
const LARAVEL_WEBHOOK_URL = process.env.LARAVEL_WEBHOOK_URL || 'http://localhost:8000/api/v1/wa/delivery-callback';
const CALLBACK_SECRET = process.env.WA_CALLBACK_SECRET || 'dev-callback-secret';

const logger = pino({ level: 'info' });

app.use(cors());
app.use(express.json());

// Multi-session memory map
interface Session {
  id: string;
  socket?: WASocket;
  status: 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'CONNECTED';
  qr?: string;
  number?: string;
}

const sessions = new Map<string, Session>();

// Authentication Middleware
const authMiddleware = (req: Request, res: Response, next: any) => {
  const apiKeyHeader = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];

  let key = apiKeyHeader;
  if (!key && authHeader && authHeader.toString().startsWith('Bearer ')) {
    key = authHeader.toString().split(' ')[1];
  }

  if (!key || key !== API_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Invalid API Key.' });
  }
  next();
};

// Start a WhatsApp session for a specific tenant
async function startSession(tenantId: string, force = false): Promise<Session> {
  if (sessions.has(tenantId) && !force) {
    const existing = sessions.get(tenantId)!;
    if (existing.status === 'CONNECTED' || existing.status === 'CONNECTING') {
      return existing;
    }
  }

  const sessionDir = path.join(__dirname, '..', 'sessions', tenantId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  let version;
  try {
    const fetched = await fetchLatestBaileysVersion();
    version = fetched.version;
  } catch (err) {
    logger.error({ err }, `Failed to fetch latest Baileys version for ${tenantId}`);
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const socket = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  const sessionObj: Session = {
    id: tenantId,
    socket,
    status: 'CONNECTING',
  };
  sessions.set(tenantId, sessionObj);

  socket.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      sessionObj.status = 'QR_READY';
      const QRCode = require('qrcode');
      QRCode.toDataURL(qr, (err: any, url: string) => {
        if (!err) {
          sessionObj.qr = url;
        }
      });
      logger.info(`Session ${tenantId}: QR Code generated.`);
    }

    if (connection === 'open') {
      sessionObj.status = 'CONNECTED';
      sessionObj.qr = undefined;
      const userJid = socket.user?.id;
      sessionObj.number = userJid ? userJid.split(':')[0] : undefined;
      logger.info(`Session ${tenantId}: Connected successfully as ${sessionObj.number}`);

      // Webhook notification back to Laravel
      triggerWebhook(tenantId, {
        event: 'session_connected',
        status: 'CONNECTED',
        number: sessionObj.number
      });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
      (logger as any).warn(`Session ${tenantId}: Connection closed. Reason: ${String(lastDisconnect?.error)}. Reconnecting: ${shouldReconnect}`);

      if (!shouldReconnect) {
        // Logged out
        sessionObj.status = 'DISCONNECTED';
        sessionObj.qr = undefined;
        sessionObj.number = undefined;
        sessionObj.socket = undefined;
        sessions.delete(tenantId);
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (e) {
          logger.error({ err: e }, `Failed to delete session dir for ${tenantId}`);
        }
        triggerWebhook(tenantId, { event: 'session_disconnected', status: 'DISCONNECTED' });
      } else {
        // Reconnect
        sessionObj.status = 'CONNECTING';
        sessionObj.socket = undefined;
        setTimeout(() => {
          logger.info(`Session ${tenantId}: Reconnecting...`);
          startSession(tenantId, true).catch(err => {
            logger.error({ err }, `Error during reconnection for ${tenantId}`);
          });
        }, 5000);
      }
    }
  });

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('messages.upsert', async (m) => {
    if (m.type === 'notify') {
      for (const msg of m.messages) {
        if (!msg.key.fromMe && msg.message) {
          const from = msg.key.remoteJid;
          if (from) {
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            if (text) {
              logger.info(`Session ${tenantId}: Incoming message from ${from}: ${text}`);
              triggerWebhook(tenantId, {
                event: 'message_received',
                from: from.split('@')[0],
                senderName: msg.pushName || "",
                message: text,
                messageId: msg.key.id
              }).catch(err => {
                logger.error({ err }, `Failed to forward incoming message to webhook for tenant ${tenantId}`);
              });
            }
          }
        }
      }
    }
  });

  return sessionObj;
}

// Helper to trigger Laravel Webhook Callbacks
async function triggerWebhook(tenantId: string, payload: any) {
  try {
    await axios.post(LARAVEL_WEBHOOK_URL, {
      tenantId,
      ...payload
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Callback-Secret': CALLBACK_SECRET
      },
      timeout: 5000
    });
  } catch (err: any) {
    logger.error(`Webhook callback error for tenant ${tenantId}: ${err.message}`);
  }
}

// REST ENDPOINTS

// 1. Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// 2. Register/Prepare tenant
app.post('/api/tenant', authMiddleware, (req, res) => {
  const { id, name } = req.body;
  if (!id) {
    return res.status(400).json({ success: false, message: 'Missing tenant id' });
  }
  if (!sessions.has(id)) {
    sessions.set(id, { id, status: 'DISCONNECTED' });
  }
  res.json({ success: true, tenant: { id, name } });
});

// 3. Start WA session (generate QR)
app.post('/api/tenant/:id/session/start', authMiddleware, async (req, res) => {
  const tenantId = req.params.id;
  try {
    const session = await startSession(tenantId);
    res.json({
      success: true,
      status: session.status,
      qr: session.qr
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Get QR code
app.get('/api/tenant/:id/session/qr', authMiddleware, (req, res) => {
  const tenantId = req.params.id;
  const session = sessions.get(tenantId);
  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found or not initialized' });
  }
  res.json({
    success: true,
    status: session.status,
    qr: session.qr
  });
});

// 5. Get Session Connection Status
app.get('/api/tenant/:id/session/status', authMiddleware, (req, res) => {
  const tenantId = req.params.id;
  const session = sessions.get(tenantId);
  if (!session) {
    return res.json({ success: true, status: 'DISCONNECTED' });
  }
  res.json({
    success: true,
    status: session.status,
    number: session.number
  });
});

// 6. Stop WA session (disconnect)
app.post('/api/tenant/:id/session/stop', authMiddleware, async (req, res) => {
  const tenantId = req.params.id;
  const session = sessions.get(tenantId);
  if (!session) {
    return res.json({ success: true, status: 'DISCONNECTED' });
  }

  try {
    if (session.socket) {
      await session.socket.logout();
    } else {
      sessions.delete(tenantId);
      const sessionDir = path.join(__dirname, '..', 'sessions', tenantId);
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    res.json({ success: true, status: 'DISCONNECTED' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Send single message (Unified endpoint)
async function sendMessage(tenantId: string, to: string, text: string, referenceId?: string): Promise<any> {
  const session = sessions.get(tenantId);
  if (!session || session.status !== 'CONNECTED' || !session.socket) {
    throw new Error('WhatsApp session is not connected for this tenant');
  }

  // Normalize phone number (ensure @s.whatsapp.net format)
  let formattedTo = to.replace(/[^0-9]/g, '');
  if (formattedTo.startsWith('08')) {
    formattedTo = '628' + formattedTo.slice(2);
  }
  if (!formattedTo.endsWith('@s.whatsapp.net')) {
    formattedTo = formattedTo + '@s.whatsapp.net';
  }

  const sentMessage = await session.socket.sendMessage(formattedTo, { text });

  // Asynchronously trigger status delivered webhook to Laravel to close the loop
  if (referenceId) {
    setTimeout(() => {
      triggerWebhook(tenantId, {
        event: 'message_delivered',
        referenceId,
        messageId: sentMessage?.key?.id,
        status: 'delivered'
      });
    }, 1000);
  }

  return sentMessage;
}

// Handle send message from path-param endpoint
app.post('/api/tenant/:id/send', authMiddleware, async (req, res) => {
  const tenantId = req.params.id;
  const { to, text, referenceId } = req.body;

  if (!to || !text) {
    return res.status(400).json({ success: false, message: 'Missing to or text parameters' });
  }

  try {
    const result = await sendMessage(tenantId, to, text, referenceId);
    res.json({ success: true, messageId: result?.key?.id, status: 'sent' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Alias POST /send for direct integration with app/Jobs/SendWaNotification.php
app.post('/send', authMiddleware, async (req, res) => {
  const { tenantId, to, message, referenceId } = req.body;

  if (!tenantId || !to || !message) {
    return res.status(400).json({ success: false, message: 'Missing tenantId, to, or message parameters' });
  }

  try {
    // Start session if not already running (recovability feature)
    const tId = tenantId.toString();
    if (!sessions.has(tId) || sessions.get(tId)!.status === 'DISCONNECTED') {
      await startSession(tId);
    }

    const result = await sendMessage(tId, to, message, referenceId);
    res.json({ success: true, messageId: result?.key?.id, status: 'sent' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Auto-initialize existing sessions from disk on startup
const sessionsPath = path.join(__dirname, '..', 'sessions');
if (fs.existsSync(sessionsPath)) {
  const folders = fs.readdirSync(sessionsPath);
  for (const folder of folders) {
    if (fs.statSync(path.join(sessionsPath, folder)).isDirectory()) {
      logger.info(`Auto-restoring session for tenant: ${folder}`);
      startSession(folder).catch(err => {
        logger.error({ err }, `Error auto-restoring session for ${folder}`);
      });
    }
  }
}

app.listen(PORT, () => {
  logger.info(`[SIMT WA GATEWAY] Server is running on port ${PORT}`);
});
