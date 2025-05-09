require('dotenv').config();
const express = require('express');
const session = require('express-session');
const line = require('@line/bot-sdk');
const { handleTextMessage } = require('./handlers/textMessageHandler');
const { handlePostback } = require('./handlers/postbackHandler');

const Redis = require('ioredis');
const RedisStore = require("connect-redis").RedisStore;

const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient(config);
const app = express();

app.set('trust proxy', 1);

let redisClient;
if (process.env.KV_URL) {
    console.log(`API_INDEX: Configuring Redis client with KV_URL (first 30 chars): ${process.env.KV_URL.substring(0,30)}...`);
    redisClient = new Redis(process.env.KV_URL, {
        connectTimeout: 10000,
        showFriendlyErrorStack: true,
        tls: process.env.KV_URL.startsWith("rediss://") ? {} : undefined,
        lazyConnect: true,
    });

    redisClient.on('connect', () => console.log('API_INDEX: Redis client emitted "connect" event.'));
    redisClient.on('ready', () => console.log('API_INDEX: Redis client is ready.'));
    redisClient.on('error', (err) => console.error('API_INDEX: Redis Client Error:', err));
    redisClient.on('close', () => console.log('API_INDEX: Redis connection closed.'));
    redisClient.on('reconnecting', (delay) => console.log(`API_INDEX: Redis client reconnecting in ${delay}ms...`));
    redisClient.on('end', () => console.log('API_INDEX: Redis connection has ended.'));

} else {
    console.warn('API_INDEX: KV_URL is not defined. Using MemoryStore.');
}

const sessionMiddleware = session({
    store: redisClient ? new RedisStore({ client: redisClient, prefix: "fortuneApp:" }) : undefined,
    secret: process.env.SESSION_SECRET || 'default_super_secret_key_for_dev_only',
    resave: false,
    saveUninitialized: true, // ★★★ true に戻す（デバッグのため） ★★★
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax'
    }
});
app.use(sessionMiddleware);

app.post('/webhook', line.middleware(config), async (req, res) => {
    if (redisClient) {
        try {
            if (redisClient.status !== 'ready') {
                console.log(`API_INDEX: Webhook - Redis status: '${redisClient.status}'. Pinging.`);
                await redisClient.ping();
                console.log('API_INDEX: Webhook - Redis ping OK.');
            }
            if (redisClient.status !== 'ready') {
                 console.error("API_INDEX: Webhook - Redis still not ready. Status:", redisClient.status);
                 return res.status(503).json({ message: 'Session store unavailable.' });
            }
        } catch (err) {
            console.error("API_INDEX: Webhook - Redis connection error:", err);
            return res.status(503).json({ message: 'Session store connection failed.' });
        }
    } else if (process.env.KV_URL) {
        console.error("API_INDEX: Webhook - KV_URL set, but redisClient is null.");
        return res.status(500).json({ message: 'Session store config error.' });
    }

    Promise.all(req.body.events.map(event => handleEvent(req, event)))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error('Webhook event processing error:', err);
            res.status(500).json({ message: 'Internal error.' });
        });
});

async function handleEvent(req, event) {
    // ★★★ リクエストヘッダーのクッキーをログに出力 ★★★
    console.log(`API_INDEX: handleEvent - User: ${event.source.userId}, Request Cookie Header:`, req.headers.cookie);

    if (event.type === 'unfollow' || event.type === 'leave') {
        // ... (省略)
        console.log(`API_INDEX: User ${event.source.userId} left or unfollowed.`);
        if (req.session) {
            if (req.session.currentUserId === event.source.userId) {
                try {
                    await new Promise((resolve, reject) => {
                        req.session.destroy(err => {
                            if (err) {
                                console.error(`API_INDEX: Session destroy error for user ${event.source.userId} on unfollow/leave:`, err);
                                reject(err);
                            } else {
                                console.log(`API_INDEX: Session destroyed for user ${event.source.userId}.`);
                                resolve();
                            }
                        });
                    });
                } catch (destroyError) {
                    console.error(`API_INDEX: Caught error during session destroy for user ${event.source.userId}:`, destroyError);
                }
            } else {
                 console.log(`API_INDEX: Session for user ${event.source.userId} not actively managed or already ended (on unfollow/leave).`);
            }
        }
        return null;
    }

    if (!event.source || !event.source.userId) {
        console.error('API_INDEX: Event source or userId is missing:', event);
        return Promise.resolve(null);
    }

    console.log(`API_INDEX: Before session check for user ${event.source.userId}. req.session.id: ${req.sessionID}, req.session.botState:`, JSON.stringify(req.session.botState), `req.session.currentUserId: ${req.session.currentUserId}`);

    if (!req.session.botState || req.session.currentUserId !== event.source.userId) {
        console.log(`API_INDEX: Initializing or switching session state for user ${event.source.userId}.`);
        console.log(`API_INDEX: Previous botState:`, JSON.stringify(req.session.botState), `Previous currentUserId: ${req.session.currentUserId}`);
        req.session.currentUserId = event.source.userId;
        req.session.botState = {
            step: 0,
            name: '',
            birth: '',
            theme: ''
        };
        console.log(`API_INDEX: New session state initialized for user ${event.source.userId}:`, JSON.stringify(req.session.botState));
    } else {
        console.log(`API_INDEX: Existing session found for user ${event.source.userId}. Session ID: ${req.sessionID}`);
    }

    const userSessionData = req.session.botState;

    console.log(`API_INDEX: Incoming event for user ${event.source.userId}, Step: ${userSessionData.step}. Event Type: ${event.type}`);
    console.log(`API_INDEX: Current session botState before handling:`, JSON.stringify(userSessionData));

    try {
        if (event.type === 'message') {
            if (event.message.type === 'text') {
                await handleTextMessage(client, event, userSessionData);
            } else {
                // ... (省略)
                console.log(`API_INDEX: Received non-text message type: ${event.message.type} from user ${event.source.userId}`);
                if (event.replyToken && !event.replyTokenExpired) {
                    await client.replyMessage({
                        replyToken: event.replyToken,
                        messages: [{ type: 'text', text: 'テキストメッセージで話しかけてくださいね。スタンプや画像などには、まだ対応していません。' }]
                    });
                }
            }
        } else if (event.type === 'postback') {
            await handlePostback(client, event, userSessionData);
        } else {
            console.log(`API_INDEX: Unhandled event type by this logic: ${event.type}`);
        }

        console.log(`API_INDEX: Attempting to save session for user ${event.source.userId}. Session ID: ${req.sessionID}. Current botState:`, JSON.stringify(req.session.botState));
        if (req.session && typeof req.session.save === 'function') {
            await new Promise((resolve, reject) => {
                req.session.save(err => {
                    if (err) {
                        console.error(`API_INDEX: SESSION SAVE ERROR for user ${event.source.userId} (Session ID: ${req.sessionID}):`, err);
                        reject(err);
                    } else {
                        console.log(`API_INDEX: Session saved successfully for user ${event.source.userId} (Session ID: ${req.sessionID}). Current botState after save:`, JSON.stringify(req.session.botState));
                        resolve();
                    }
                });
            });
        } else if (req.session) {
            console.log(`API_INDEX: Session data for user ${event.source.userId} (no explicit save). Current botState:`, JSON.stringify(req.session.botState));
        } else {
            console.warn(`API_INDEX: req.session is undefined for user ${event.source.userId}. Cannot save session.`);
        }

    } catch (error) {
        // ... (省略)
        console.error(`API_INDEX: Error handling event for ${event.source.userId} (Session ID: ${req.sessionID}):`, error);
        if (event.replyToken && !event.replyTokenExpired) {
            try {
                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{ type: 'text', text: '申し訳ありません、処理中にエラーが発生しました。もう一度お試しいただくか、時間をおいて再度お試しください。' }]
                });
            } catch (replyError) {
                console.error('API_INDEX: Failed to send error reply to user:', replyError);
            }
        } else if (event.replyTokenExpired) {
            console.warn(`API_INDEX: Reply token expired for event from user ${event.source.userId}. Cannot send error reply.`);
        }
    }
    return Promise.resolve(null);
}
// ... (process.on イベントハンドラは省略)
process.on('uncaughtException', (err, origin) => {
    console.error('API_INDEX: Uncaught Exception at:', origin, 'error:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('API_INDEX: Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;