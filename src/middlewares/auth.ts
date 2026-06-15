import { Request, Response, NextFunction } from 'express';
import { API_KEY } from '../config';

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
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
