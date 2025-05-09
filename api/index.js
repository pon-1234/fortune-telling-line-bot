require('dotenv').config();
const express = require('express');
const session = require('express-session');
const line = require('@line/bot-sdk');
const { handleTextMessage } = require('./handlers/textMessageHandler');
const { handlePostback } = require('./handlers/postbackHandler');

// Redis Session Store (例: connect-redis と ioredis)
// 事前に npm install ioredis connect-redis または yarn add ioredis connect-redis が必要
const Redis = require('ioredis');
const RedisStore = require("connect-redis").default;

// LINE Bot Config
const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient(config);

const app = express();

// Redis Client Setup
let redisClient;
if (process.env.KV_URL) { // Vercel KV やその他のRedis互換ストアの接続文字列
    redisClient = new Redis(process.env.KV_URL);
    redisClient.on('connect', () => console.log('Connected to Redis for session store.'));
    redisClient.on('error', (err) => console.error('Redis Client Error:', err));
} else {
    console.warn(
`KV_URL (Redis connection string) is not defined.
Session management will use MemoryStore, which is not suitable for production
and will not work correctly in a serverless environment like Vercel.`
    );
}

// Session Middleware
const sessionMiddleware = session({
    // redisClientが定義されていればRedisStoreを使用、なければデフォルト(MemoryStoreだが警告が出る)
    store: redisClient ? new RedisStore({ client: redisClient, prefix: "fortuneApp:" }) : undefined,
    secret: process.env.SESSION_SECRET || 'default_super_secret_key_for_dev',
    resave: false,            // セッションに変更がなくても再保存しない
    saveUninitialized: false, // 未初期化のセッションを保存しない (ログイン等でセッションに変更が加えられた際に保存)
    cookie: {
        secure: process.env.NODE_ENV === 'production', // 本番環境ではtrue (HTTPSが必須)
        httpOnly: true,      // JavaScriptからCookieへのアクセスを防ぐ (LINE Botでは直接影響しないがセキュリティプラクティス)
        maxAge: 24 * 60 * 60 * 1000 // クッキーの有効期限 (例: 1日)
    }
});
app.use(sessionMiddleware);


// LINE Webhook Endpoint
// line.middleware の前に sessionMiddleware を適用することが重要
app.post('/webhook', line.middleware(config), (req, res) => {
    Promise.all(req.body.events.map(event => handleEvent(req, event)))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error('Webhook Error:', err);
            res.status(500).end();
        });
});

// Event Handler
async function handleEvent(req, event) { // express の req オブジェクトを引数として受け取る
    if (event.type === 'unfollow' || event.type === 'leave') {
        console.log(`User ${event.source.userId} left or unfollowed.`);
        // ユーザーが退出/ブロックした場合、セッション情報を破棄することも検討
        if (req.session) {
            // 特定のユーザーのセッション情報のみをクリアしたい場合、
            // かつセッションストアがそれに対応しているか、
            // `req.session.botState` と `req.session.currentUserId` をクリアする
            if (req.session.currentUserId === event.source.userId) {
                delete req.session.botState;
                delete req.session.currentUserId;
                 req.session.save(err => { // 明示的に保存
                    if (err) console.error('Session save error on unfollow:', err);
                });
            }
        }
        return null;
    }

    if (!event.source || !event.source.userId) {
        console.error('Event source or userId is missing:', event);
        return Promise.resolve(null); // userIdがないイベントは無視
    }

    // セッションデータの初期化/復元
    // LINEのWebhookではCookieが使えないため、userIdをキーにセッションを管理するのが理想。
    // ここでは、express-sessionのreq.sessionオブジェクト内にユーザーごとの状態を保持する。
    // 永続ストア(Redis等)が設定されていれば、このセッションデータはリクエスト間で維持される。
    // ただし、LINEのuserIdとexpress-sessionのセッションIDの紐付けは別途考慮が必要。
    // ここでは簡易的に、req.session.currentUserId でどのユーザーのデータかを管理する。
    if (!req.session.botState || req.session.currentUserId !== event.source.userId) {
        console.log(`Initializing new session state for user ${event.source.userId} or switching user.`);
        req.session.currentUserId = event.source.userId;
        req.session.botState = { // 占いの状態を保持するオブジェクト
            step: 0,
            name: '',
            birth: '',
            theme: ''
        };
    }
    const userSessionData = req.session.botState; // ハンドラに渡すセッションデータ

    console.log(`Incoming event for user ${event.source.userId}, Step: ${userSessionData.step}. Event:`, JSON.stringify(event).substring(0, 200) + '...');


    try {
        if (event.type === 'message') {
            if (event.message.type === 'text') {
                await handleTextMessage(client, event, userSessionData);
            } else {
                // テキスト以外のメッセージタイプの場合の処理
                console.log(`Received non-text message type: ${event.message.type} from user ${event.source.userId}`);
                if (event.replyToken) { // replyTokenが存在する場合のみ返信
                    await client.replyMessage({
                        replyToken: event.replyToken,
                        messages: [{ type: 'text', text: 'テキストメッセージで話しかけてくださいね。スタンプや画像などには、まだ対応していません。' }]
                    });
                }
            }
        } else if (event.type === 'postback') {
            await handlePostback(client, event, userSessionData);
        } else {
            console.log(`Unhandled event type by this logic: ${event.type}`);
            // 必要に応じて特定のイベントタイプ (follow, join など) の処理を追加
        }

        // セッションの変更を保存
        // saveUninitialized: false, resave: false の場合、セッションオブジェクトが変更された場合のみ保存される。
        // 明示的に保存することも可能（特に非同期処理が多い場合）
        if (req.session && req.session.save) { // req.sessionが存在し、saveメソッドがあるか確認
             req.session.save(err => {
                if (err) {
                    console.error('Session save error after handling event:', err);
                }
            });
        }

    } catch (error) {
        console.error(`Error handling event for ${event.source.userId}:`, error);
        if (event.replyToken) { // エラー発生時にも返信を試みる
            try {
                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{ type: 'text', text: '申し訳ありません、処理中にエラーが発生しました。もう一度お試しいただくか、時間をおいて再度お試しください。' }]
                });
            } catch (replyError) {
                console.error('Failed to send error reply to user:', replyError);
            }
        }
    }

    return Promise.resolve(null);
}

// Basic Error Handling for uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // TODO: Add Slack Webhook notification here if configured
    // process.exit(1); // Vercelでは自動的に再起動されることが多いので、必ずしもexitする必要はない
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // TODO: Add Slack Webhook notification here if configured
});

// Export the Express app for Vercel
module.exports = app;