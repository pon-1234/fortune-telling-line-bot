require('dotenv').config();
const express = require('express');
const session = require('express-session'); // express-session をインポート
const line = require('@line/bot-sdk');
const { handleTextMessage } = require('./handlers/textMessageHandler');
const { handlePostback } = require('./handlers/postbackHandler');

// Redis Session Store
const Redis = require('ioredis');
const RedisStore = require("connect-redis").RedisStore;

// LINE Bot Config
const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient(config);

const app = express();

// Redis Client Setup
let redisClient;
if (process.env.KV_URL) {
    redisClient = new Redis(process.env.KV_URL);
    redisClient.on('connect', () => console.log('API_INDEX: Successfully connected to Redis for session store.'));
    redisClient.on('error', (err) => console.error('API_INDEX: Redis Client Error:', err));
} else {
    console.warn(
`API_INDEX: KV_URL (Redis connection string) is not defined.
Session management will use MemoryStore, which is not suitable for production
and will not work correctly in a serverless environment like Vercel.`
    );
}

// Session Middleware
const sessionMiddleware = session({
    store: redisClient ? new RedisStore({ client: redisClient, prefix: "fortuneApp:" }) : undefined,
    secret: process.env.SESSION_SECRET || 'default_super_secret_key_for_dev_only',
    resave: false,
    saveUninitialized: true, // 新規セッションも保存するように変更 (場合によっては false のままが良いことも)
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 1 day
    }
});
app.use(sessionMiddleware);

// LINE Webhook Endpoint
app.post('/webhook', line.middleware(config), (req, res) => {
    Promise.all(req.body.events.map(event => handleEvent(req, event)))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error('Webhook Error:', err);
            res.status(500).end();
        });
});

// Event Handler
async function handleEvent(req, event) { // async を追加
    if (event.type === 'unfollow' || event.type === 'leave') {
        console.log(`API_INDEX: User ${event.source.userId} left or unfollowed.`);
        if (req.session) {
            if (req.session.currentUserId === event.source.userId) {
                try {
                    await new Promise((resolve, reject) => { // destroy も await で待つ
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

    // セッション初期化/復元ロジック
    // Vercel環境では、各リクエストでセッションがストアからロードされることを期待
    // req.session は express-sessionミドルウェアによってリクエストオブジェクトにアタッチされる
    console.log(`API_INDEX: Before session check for user ${event.source.userId}. req.session.id: ${req.sessionID}, req.session.botState:`, JSON.stringify(req.session.botState), `req.session.currentUserId: ${req.session.currentUserId}`);

    if (!req.session.botState || req.session.currentUserId !== event.source.userId) {
        console.log(`API_INDEX: Initializing or switching session state for user ${event.source.userId}.`);
        console.log(`API_INDEX: Previous botState:`, JSON.stringify(req.session.botState), `Previous currentUserId: ${req.session.currentUserId}`);
        req.session.currentUserId = event.source.userId; // ユーザーIDをセッションに保存
        req.session.botState = { // 新しいbotStateを初期化
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
                console.log(`API_INDEX: Received non-text message type: ${event.message.type} from user ${event.source.userId}`);
                if (event.replyToken) {
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

        // セッションの変更を保存
        console.log(`API_INDEX: Attempting to save session for user ${event.source.userId}. Current botState:`, JSON.stringify(req.session.botState));
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
            console.log(`API_INDEX: Session data for user ${event.source.userId} (no explicit save, store might auto-save). Current botState after handling:`, JSON.stringify(req.session.botState));
        } else {
            console.warn(`API_INDEX: req.session is undefined for user ${event.source.userId}. Cannot save session.`);
        }

    } catch (error) {
        console.error(`API_INDEX: Error handling event for ${event.source.userId}:`, error);
        if (event.replyToken && !event.replyTokenExpired) { // replyTokenが期限切れでないか確認
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

process.on('uncaughtException', (err, origin) => { // origin を追加
    console.error('API_INDEX: Uncaught Exception at:', origin, 'error:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('API_INDEX: Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;