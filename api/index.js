require('dotenv').config();
const express = require('express');
const session = require('express-session'); // express-session をインポート
const line = require('@line/bot-sdk');
const { handleTextMessage } = require('./handlers/textMessageHandler');
const { handlePostback } = require('./handlers/postbackHandler');

// Redis Session Store
const Redis = require('ioredis');
const RedisStore = require("connect-redis"); // connect-redis は RedisStore クラスを直接エクスポートします

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
    saveUninitialized: false,
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
async function handleEvent(req, event) {
    if (event.type === 'unfollow' || event.type === 'leave') {
        console.log(`API_INDEX: User ${event.source.userId} left or unfollowed.`);
        if (req.session) {
            // Vercel KV (ioredis)の場合、セッションIDがユーザーIDと直接関連付けられていない可能性があるため、
            // より汎用的なセッション破棄方法を検討するか、
            // もしくはアプリケーションロジックでユーザーIDに基づいたセッションデータ管理を強化する必要があります。
            // ここでは、セッションオブジェクトが存在すれば破棄を試みます。
            // 特定のユーザーのセッションを確実に破棄するには、セッションストアの設計に依存します。
            // connect-redis の場合、セッションIDは req.sessionID で取得できます。
            // このIDを使ってストアから直接削除することも可能です。
            // ただし、ここではまず現在のセッション内容をクリアする形を取ります。
            if (req.session.currentUserId === event.source.userId) {
                req.session.destroy(err => {
                    if (err) {
                        console.error(`API_INDEX: Session destroy error for user ${event.source.userId} on unfollow/leave:`, err);
                    } else {
                        console.log(`API_INDEX: Session destroyed for user ${event.source.userId}.`);
                    }
                });
            } else {
                 // currentUserIdが一致しない場合でも、セッションストアに古いデータが残る可能性を考慮
                 // 必要であれば、より積極的なクリーンアップ処理をここに実装
                 console.log(`API_INDEX: Session for user ${event.source.userId} not actively managed or already ended.`);
            }
        }
        return null;
    }

    if (!event.source || !event.source.userId) {
        console.error('API_INDEX: Event source or userId is missing:', event);
        return Promise.resolve(null);
    }

    // req.session.botState が存在しない、またはセッションのユーザーIDとイベントのユーザーIDが異なる場合、セッションを初期化
    // (Vercel KVのような外部ストア利用時は、リクエストごとにセッションがロードされることを期待)
    if (!req.session.botState || req.session.currentUserId !== event.source.userId) {
        console.log(`API_INDEX: Initializing or switching session state for user ${event.source.userId}. Previous session data (if any):`, JSON.stringify(req.session.botState));
        req.session.currentUserId = event.source.userId;
        req.session.botState = {
            step: 0,
            name: '',
            birth: '',
            theme: ''
        };
         console.log(`API_INDEX: New session state initialized for user ${event.source.userId}:`, JSON.stringify(req.session.botState));
    }
    // botState があっても、currentUserId がない場合 (理論上は上記ifでカバーされるはずだが念のため)
    else if (!req.session.currentUserId && event.source.userId) {
        console.log(`API_INDEX: Restoring currentUserId for existing session for user ${event.source.userId}`);
        req.session.currentUserId = event.source.userId;
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
        // express-session は通常、レスポンス終了時に自動的にセッションを保存しますが、
        // serverless環境や特定のストアでは明示的な保存が推奨される場合があります。
        // connect-redis のドキュメントや Vercel のベストプラクティスを確認してください。
        // MemoryStore以外では、変更があった場合に自動保存されるのが一般的です。
        // 明示的に保存する場合は req.session.save() を使います。
        if (req.session && typeof req.session.save === 'function') {
            req.session.save(err => {
                if (err) {
                    console.error(`API_INDEX: SESSION SAVE ERROR for user ${event.source.userId}:`, err);
                } else {
                    console.log(`API_INDEX: Session saved successfully for user ${event.source.userId}. Current botState after save:`, JSON.stringify(req.session.botState));
                }
            });
        } else if (req.session) {
             // req.session.save がないストアの場合 (MemoryStoreなど)
            console.log(`API_INDEX: Session data for user ${event.source.userId} (no explicit save, check store behavior). Current botState after handling:`, JSON.stringify(req.session.botState));
        }


    } catch (error) {
        console.error(`API_INDEX: Error handling event for ${event.source.userId}:`, error);
        if (event.replyToken) {
            try {
                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{ type: 'text', text: '申し訳ありません、処理中にエラーが発生しました。もう一度お試しいただくか、時間をおいて再度お試しください。' }]
                });
            } catch (replyError) {
                console.error('API_INDEX: Failed to send error reply to user:', replyError);
            }
        }
    }
    return Promise.resolve(null);
}

process.on('uncaughtException', (err) => {
    console.error('API_INDEX: Uncaught Exception:', err);
    // ここでプロセスを終了させるべきか検討。サーバーレス環境では自動的に再起動されることが多い。
    // process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('API_INDEX: Unhandled Rejection at:', promise, 'reason:', reason);
    // process.exit(1);
});

module.exports = app;