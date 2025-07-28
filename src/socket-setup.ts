import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createWebhookHandler, handleSocketConnection } from './webhook-handler.js';
import { Express } from 'express';

export function setupSocketIO(app: Express, server: HTTPServer) {
  // Create Socket.IO server
  const io = new SocketIOServer(server, {
    cors: {
      origin: [
        'http://localhost:3000',
        'https://drivenmetrics-beta.onrender.com',
        'https://beta.drivenmetrics.com'
      ],
      methods: ['GET', 'POST']
    }
  });

  // Setup webhook routes
  const webhookRouter = createWebhookHandler(io);
  app.use('/api/webhook', webhookRouter);

  // Setup Socket.IO connection handling
  handleSocketConnection(io);

  console.log('✅ Socket.IO and webhooks configured');
  
  return io;
}