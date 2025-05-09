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

// trust proxy 設定を追加 (リバースプロキシ環境で secure cookie を正しく扱うため)
app.set('trust proxy', 1);

let redisClient;
if (process.env.KV_URL) {
    console.log(`API_INDEX: Attempting to connect to Redis with KV_URL (first 30 chars): ${process.env.KV_URL.substring(0,30)}...`);
    redisClient = new Redis(process.env.KV_URL, {
        connectTimeout: 15000, // 接続タイムアウトを15秒に延長
        showFriendlyErrorStack: true, // 詳細なエラースタック (開発/デバッグ時)
        // Vercel KVがrediss:// (TLS) を使用している場合、ioredis v5では通常自動認識されますが、
        // 明示的にTLSオプションを設定することも可能です。
        // Vercel KVの接続文字列が `rediss://` で始まっている場合は、以下の tls: {} が有効になります。
        tls: process.env.KV_URL.startsWith("rediss://") ? {} : undefined,
        // retryStrategy(times) {
        //     const delay = Math.min(times * 100, 3000); // リトライ遅延
        //     console.log(`API_INDEX: Redis retrying connection, attempt ${times}, delay ${delay}ms`);
        //     return delay;
        // }
    });

    redisClient.on('connect', () => console.log('API_INDEX: Redis client successfully emitted "connect" event.'));
    redisClient.on('ready', () => console.log('API_INDEX: Redis client is ready (connected and ready to process commands).'));
    redisClient.on('error', (err) => console.error('API_INDEX: Redis Client Error:', err)); // このエラーが頻発する場合、接続に問題あり
    redisClient.on('close', () => console.log('API_INDEX: Redis connection closed.'));
    redisClient.on('reconnecting', (delay) => console.log(`API_INDEX: Redis client reconnecting in ${delay}ms...`));
    redisClient.on('end', () => console.log('API_INDEX: Redis connection has ended (will not reconnect).'));

} else {
    console.warn(
`API_INDEX: KV_URL (Redis connection string) is not defined.
Session management will use MemoryStore, which is not suitable for production
and will not work correctly in a serverless environment like Vercel.`
    );
}

const sessionMiddleware = session({
    store: redisClient ? new RedisStore({ client: redisClient, prefix: "fortuneApp:" }) : undefined,
    secret: process.env.SESSION_SECRET || 'default_super_secret_key_for_dev_only',
    resave: false,
    saveUninitialized: true, // 新規セッションもストアに保存 (デバッグのためtrue、安定したらfalse推奨)
    cookie: {
        secure: process.env.NODE_ENV === 'production', // 本番環境ではtrue
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        // sameSite 設定を追加
        sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax'
    }
});
app.use(sessionMiddleware);

// LINE Webhook Endpoint
app.post('/webhook', line.middleware(config), (req, res) => {
    // Redisクライアントの準備状態を確認
    if (redisClient && redisClient.status !== 'ready') {
        console.error("API_INDEX: Webhook called but Redis client is not ready. Current status:", redisClient.status);
        // 503 Service Unavailableを返すか、適切なエラー処理を行う
        // return res.status(503).json({ message: 'Session store not available. Please try again later.' });
    }

    Promise.all(req.body.events.map(event => handleEvent(req, event)))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error('Webhook Error:', err);
            res.status(500).end();
        });
});

// Event Handler
async function handleEvent(req, event) {
    // handleEvent内でもRedisの準備状態を確認
    if (redisClient && redisClient.status !== 'ready') {
        console.error(`API_INDEX: handleEvent for user ${event.source.userId} - Redis client not ready. Status: ${redisClient.status}`);
        if (event.replyToken && !event.replyTokenExpired) {
            try {
                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{ type: 'text', text: '現在サーバーが混み合っています。しばらくしてからもう一度お試しください。' }]
                });
            } catch (replyError) {
                console.error('API_INDEX: Failed to send "Redis not ready" reply to user:', replyError);
            }
        }
        return null;
    }

    if (event.type === 'unfollow' || event.type === 'leave') {
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

    // セッションIDと現在のセッション内容をリクエストの最初にログ出力
    console.log(`API_INDEX: Before session check for user ${event.source.userId}. req.session.id: ${req.sessionID}, req.session.botState:`, JSON.stringify(req.session.botState), `req.session.currentUserId: ${req.session.currentUserId}`);

    if (!req.session.botState || req.session.currentUserId !== event.source.userId) {
        console.log(`API_INDEX: Initializing or switching session state for user ${event.source.userId}.`);
        console.log(`API_INDEX: Previous botState:`, JSON.stringify(req.session.botState), `Previous currentUserId: ${req.session.currentUserId}`);
        // セッションにユーザーIDを保存
        req.session.currentUserId = event.source.userId;
        // 新しいbotStateを初期化
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

        // セッションの変更を保存
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
            console.log(`API_INDEX: Session data for user ${event.source.userId} (no explicit save, store might auto-save). Current botState after handling:`, JSON.stringify(req.session.botState));
        } else {
            console.warn(`API_INDEX: req.session is undefined for user ${event.source.userId}. Cannot save session.`);
        }

    } catch (error) {
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

process.on('uncaughtException', (err, origin) => {
    console.error('API_INDEX: Uncaught Exception at:', origin, 'error:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('API_INDEX: Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;