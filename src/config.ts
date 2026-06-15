import dotenv from 'dotenv';

dotenv.config();

export const PORT = process.env.PORT || 8081;
export const API_KEY = process.env.WA_GATEWAY_API_KEY || 'dev-api-key';
export const LARAVEL_WEBHOOK_URL = process.env.LARAVEL_WEBHOOK_URL || 'http://localhost:8000/api/v1/wa/delivery-callback';
export const CALLBACK_SECRET = process.env.WA_CALLBACK_SECRET || 'dev-callback-secret';
