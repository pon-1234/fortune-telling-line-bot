require('dotenv').config();
const express = require('express');
const session = require('express-session');
const line = require('@line/bot-sdk');
const { handleTextMessage } = require('./handlers/textMessageHandler');
const { handlePostback } = require('./handlers/postbackHandler');

// LINE Bot Config
const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient(config);

const app = express();

// Session Middleware
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'default_session_secret',
        resave: false,
        saveUninitialized: true,
        cookie: { secure: process.env.NODE_ENV === 'production' } // Use secure cookies in production
    })
);

// LINE Webhook Endpoint
app.post('/webhook', line.middleware(config), (req, res) => {
    // Bind req to handleEvent so it can access the session store
    Promise.all(req.body.events.map(event => handleEvent.call(req, event)))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error('Webhook Error:', err);
            res.status(500).end();
        });
});

// Event Handler
async function handleEvent(event) {
    // Add req to handleEvent arguments to access session
    const req = this; // 'this' is bound to the request object by Express middleware

    if (event.type === 'unfollow' || event.type === 'leave') {
        console.log(`User ${event.source.userId} left.`);
        // Clean up user data if necessary
        if (req.session) {
            req.session.destroy();
        }
        return null;
    }

    if (!event.source || !event.source.userId) {
        console.error('Event source or userId is missing:', event);
        return Promise.resolve(null); // Ignore events without userId
    }

    // Initialize session if not exists for the specific user
    // We need a way to associate session with userId outside typical web sessions
    // A simple in-memory store for demo purposes. Use Redis/DB for production.
    if (!req.sessionStore) req.sessionStore = {}; // Basic in-memory store
    if (!req.sessionStore[event.source.userId]) {
        req.sessionStore[event.source.userId] = { step: 0 }; // Initial step per user
    }
    const userSessionData = req.sessionStore[event.source.userId];

    console.log(`Incoming event from ${event.source.userId}:`, event);
    console.log(`Current session step for ${event.source.userId}: ${userSessionData.step}`);

    try {
        if (event.type === 'message' && event.message.type === 'text') {
            // Pass userSessionData instead of req.session.userData
            await handleTextMessage(client, event, userSessionData);
        } else if (event.type === 'postback') {
            // Pass userSessionData instead of req.session.userData
            await handlePostback(client, event, userSessionData);
        } else {
            console.log(`Unhandled event type: ${event.type}`);
        }
        // Session data is managed in memory store, no req.session.save() needed here
    } catch (error) {
        console.error(`Error handling event for ${event.source.userId}:`, error);
        // Optionally notify user of error
        // await client.replyMessage({
        //     replyToken: event.replyToken,
        //     messages: [{ type: 'text', text: 'エラーが発生しました。もう一度お試しください。' }]
        // });
    }

    return Promise.resolve(null);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`LINE Bot server running on port ${PORT}`);
});

// Basic Error Handling for uncaught exceptions (as per non-functional requirements)
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // TODO: Add Slack Webhook notification here if configured
  // process.exit(1); // Optional: exit process, but Vercel might handle restarts
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // TODO: Add Slack Webhook notification here if configured
});
