// Chat Routes for Custom Webhook Integration
const express = require('express');
const router = express.Router();
const path = require('path');

/**
 * Route principale per la chat integrata
 * Accessibile da: http://localhost:3000/chat
 */
router.get('/chat', (req, res) => {
    // Serve la pagina della chat integrata
    res.sendFile(path.join(__dirname, '../../public/integrated-custom-chat.html'));
});

/**
 * Route alternativa con parametri
 * Accessibile da: http://localhost:3000/chat/session/[sessionId]
 */
router.get('/chat/session/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    
    // Potresti passare il sessionId alla pagina HTML
    // Per ora serve la stessa pagina
    res.sendFile(path.join(__dirname, '../../public/integrated-custom-chat.html'));
});

/**
 * API endpoint per configurazione dinamica
 * Il frontend può chiamare questo endpoint per ottenere la configurazione
 */
router.get('/api/chat/config', (req, res) => {
    res.json({
        webhookUrl: process.env.N8N_WEBHOOK_URL || 'https://n8n.growthers.io/webhook/21b75195-84e4-4e1b-8350-166b0b223a12/chat',
        enableStreaming: true,
        features: {
            markdown: true,
            fileUpload: false,
            voiceInput: false
        }
    });
});

/**
 * Proxy endpoint (opzionale)
 * Se vuoi nascondere il webhook URL di n8n, puoi usare un proxy
 */
router.post('/api/chat/message', async (req, res) => {
    const { message, sessionId, metadata } = req.body;
    
    try {
        // Forward to n8n webhook
        const n8nResponse = await fetch(process.env.N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream, application/json'
            },
            body: JSON.stringify({
                message,
                sessionId: sessionId || req.session?.id,
                userId: req.session?.userId,
                userEmail: req.session?.userEmail,
                metadata: {
                    ...metadata,
                    ip: req.ip,
                    userAgent: req.get('user-agent')
                }
            })
        });

        // Check if streaming
        const contentType = n8nResponse.headers.get('content-type');
        if (contentType?.includes('text/event-stream')) {
            // Forward SSE stream
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            
            // Pipe the stream
            n8nResponse.body.pipe(res);
        } else {
            // Forward JSON response
            const data = await n8nResponse.json();
            res.json(data);
        }
    } catch (error) {
        console.error('Chat proxy error:', error);
        res.status(500).json({ 
            error: 'Failed to process message',
            details: error.message 
        });
    }
});

module.exports = router;