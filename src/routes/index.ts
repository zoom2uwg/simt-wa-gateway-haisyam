import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { authMiddleware } from '../middlewares/auth';
import {
  sessions,
  startSession,
  sendMessage
} from '../services/whatsapp';

const router = Router();

// 1. Health check
router.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// 2. Register/Prepare tenant
router.post('/api/tenant', authMiddleware, (req, res) => {
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
router.post('/api/tenant/:id/session/start', authMiddleware, async (req, res) => {
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
router.get('/api/tenant/:id/session/qr', authMiddleware, (req, res) => {
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
router.get('/api/tenant/:id/session/status', authMiddleware, (req, res) => {
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
router.post('/api/tenant/:id/session/stop', authMiddleware, async (req, res) => {
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
      const sessionDir = path.join(__dirname, '..', '..', 'sessions', tenantId);
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    res.json({ success: true, status: 'DISCONNECTED' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Send single message (Unified endpoint)
router.post('/api/tenant/:id/send', authMiddleware, async (req, res) => {
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
router.post('/send', authMiddleware, async (req, res) => {
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

export default router;
