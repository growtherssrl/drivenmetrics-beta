import { Router } from 'express';
import { Server as SocketIOServer } from 'socket.io';

export function createWebhookHandler(io: SocketIOServer) {
  const router = Router();

  // Webhook endpoint for n8n dashboard updates
  router.post('/dashboard-update', (req, res) => {
    console.log('[Webhook] Received dashboard update:', req.body);
    
    const { sessionId, type, data } = req.body;
    
    if (!sessionId || !type || !data) {
      return res.status(400).json({ 
        error: 'Missing required fields: sessionId, type, data' 
      });
    }

    // Emit update to specific client session
    io.to(sessionId).emit('dashboard-update', {
      type,
      data,
      timestamp: new Date().toISOString()
    });

    // Also emit to a room for the specific search if provided
    if (data.searchId) {
      io.to(`search-${data.searchId}`).emit('dashboard-update', {
        type,
        data,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ success: true, message: 'Update sent to client' });
  });

  // Webhook for search results
  router.post('/search-results', (req, res) => {
    console.log('[Webhook] Received search results:', req.body);
    
    const { sessionId, results } = req.body;
    
    if (!sessionId || !results) {
      return res.status(400).json({ 
        error: 'Missing required fields: sessionId, results' 
      });
    }

    // Process results and emit to client
    const processedResults = {
      adsCount: results.ads?.length || 0,
      brandsCount: new Set(results.ads?.map((ad: any) => ad.brand)).size || 0,
      campaigns: results.campaigns || [],
      insights: results.insights || '',
      timestamp: new Date().toISOString()
    };

    io.to(sessionId).emit('search-results', processedResults);

    res.json({ success: true, processed: processedResults });
  });

  // Webhook for real-time status updates
  router.post('/status-update', (req, res) => {
    const { sessionId, status, message } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }

    io.to(sessionId).emit('status-update', {
      status,
      message,
      timestamp: new Date().toISOString()
    });

    res.json({ success: true });
  });

  return router;
}

// Socket.IO connection handler
export function handleSocketConnection(io: SocketIOServer) {
  io.on('connection', (socket) => {
    console.log('[WebSocket] Client connected:', socket.id);
    
    // Join session room
    socket.on('join-session', (sessionId: string) => {
      socket.join(sessionId);
      console.log(`[WebSocket] Socket ${socket.id} joined session ${sessionId}`);
    });

    // Join search room
    socket.on('join-search', (searchId: string) => {
      socket.join(`search-${searchId}`);
      console.log(`[WebSocket] Socket ${socket.id} joined search ${searchId}`);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('[WebSocket] Client disconnected:', socket.id);
    });
  });
}