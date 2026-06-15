import { WASocket } from '@whiskeysockets/baileys';

export interface Session {
  id: string;
  socket?: WASocket;
  status: 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'CONNECTED';
  qr?: string;
  number?: string;
}
