require('dotenv').config();
const express = require('express');
// const session = require('express-session'); // express-session は不要になる
const line = require('@line/bot-sdk');
const { handleTextMessage } = require('./handlers/textMessageHandler'); // ハンドラ側も修正が必要
const { handlePostback } = require('./handlers/postbackHandler');   // ハンドラ側も修正が必要

const Redis = require('ioredis');
// const RedisStore = require("connect-redis").RedisStore; // connect-redis も不要

const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient(config);
const app = express();

// trust proxy はセッションクッキーに依存しないため、必須ではなくなりますが、
// 他の目的（X-Forwarded-Forなど）で残しても問題ありません。
app.set('trust proxy', 1);

let redisClient;
const SESSION_PREFIX = "fortuneAppUserSession:"; // Redisキーのプレフィックス
const SESSION_EXPIRY_SECONDS = 24 * 60 * 60; // セッションの有効期限（例: 1日）

if (process.env.KV_URL) {
    console.log(`API_INDEX: Configuring Redis client with KV_URL (first 30 chars): ${process.env.KV_URL.substring(0,30)}...`);
    redisClient = new Redis(process.env.KV_URL, {
        connectTimeout: 10000,
        showFriendlyErrorStack: true,
        tls: process.env.KV_URL.startsWith("rediss://") ? {} : undefined,
        lazyConnect: true, // 接続を遅延させることでコールドスタート時の影響を緩和
    });

    redisClient.on('connect', () => console.log('API_INDEX: Redis client emitted "connect" event.'));
    redisClient.on('ready', () => console.log('API_INDEX: Redis client is ready.'));
    redisClient.on('error', (err) => console.error('API_INDEX: Redis Client Error:', err));
    redisClient.on('close', () => console.log('API_INDEX: Redis connection closed.'));
    redisClient.on('reconnecting', (delay) => console.log(`API_INDEX: Redis client reconnecting in ${delay}ms...`));
    redisClient.on('end', () => console.log('API_INDEX: Redis connection has ended.'));

} else {
    console.warn('API_INDEX: KV_URL is not defined. User state will not be persisted across requests!');
    // メモリストアのフォールバックを実装するか、エラーにするか選択
    // ここでは簡易的に redisClient が null の場合は何もしないようにする
}

// app.use(sessionMiddleware); // express-sessionミドルウェアは削除

// --- ユーティリティ関数: Redisからユーザーステートを取得 ---
async function getUserState(userId) {
    if (!redisClient || redisClient.status !== 'ready') {
        console.error(`getUserState: Redis client not ready for userId: ${userId}`);
        // 接続が確立するまで待つか、エラーを投げる
        // ここでは lazyConnect を信じて ping を試みる
        try {
            await redisClient.ping();
        } catch (pingError) {
            console.error(`getUserState: Ping failed, Redis client not ready for userId: ${userId}`, pingError);
            return null; // またはエラーをスロー
        }
    }
    try {
        const key = `${SESSION_PREFIX}${userId}`;
        const data = await redisClient.get(key);
        if (data) {
            console.log(`getUserState: Found state for ${userId}:`, data);
            return JSON.parse(data);
        }
        console.log(`getUserState: No state found for ${userId}.`);
        return null;
    } catch (error) {
        console.error(`getUserState: Error getting state for userId ${userId}:`, error);
        return null; // エラー時はnullを返すか、エラーをスロー
    }
}

// --- ユーティリティ関数: Redisにユーザーステートを保存 ---
async function saveUserState(userId, state) {
    if (!redisClient || redisClient.status !== 'ready') {
        console.error(`saveUserState: Redis client not ready for userId: ${userId}`);
        try {
            await redisClient.ping();
        } catch (pingError) {
            console.error(`saveUserState: Ping failed, Redis client not ready for userId: ${userId}`, pingError);
            return false; // またはエラーをスロー
        }
    }
    try {
        const key = `${SESSION_PREFIX}${userId}`;
        // 'EX' オプションで有効期限（秒）を設定
        await redisClient.set(key, JSON.stringify(state), 'EX', SESSION_EXPIRY_SECONDS);
        console.log(`saveUserState: Saved state for ${userId}:`, JSON.stringify(state));
        return true;
    } catch (error) {
        console.error(`saveUserState: Error saving state for userId ${userId}:`, error);
        return false; // エラー時はfalseを返すか、エラーをスロー
    }
}

// --- ユーティリティ関数: Redisからユーザーステートを削除 ---
async function deleteUserState(userId) {
    if (!redisClient || redisClient.status !== 'ready') {
        console.error(`deleteUserState: Redis client not ready for userId: ${userId}`);
        try {
            await redisClient.ping();
        } catch (pingError) {
            console.error(`deleteUserState: Ping failed, Redis client not ready for userId: ${userId}`, pingError);
            return false;
        }
    }
    try {
        const key = `${SESSION_PREFIX}${userId}`;
        await redisClient.del(key);
        console.log(`deleteUserState: Deleted state for ${userId}.`);
        return true;
    } catch (error) {
        console.error(`deleteUserState: Error deleting state for userId ${userId}:`, error);
        return false;
    }
}


// LINE Webhook Endpoint
app.post('/webhook', line.middleware(config), async (req, res) => {
    if (redisClient && redisClient.status !== 'ready') {
        try {
            console.log(`API_INDEX: Webhook - Redis client status is '${redisClient.status}'. Attempting ping to connect/verify.`);
            await redisClient.ping();
            console.log('API_INDEX: Webhook - Redis ping successful, client should be ready.');
            if (redisClient.status !== 'ready') {
                 console.error("API_INDEX: Webhook - Redis client still not ready after ping. Status:", redisClient.status);
                 return res.status(503).json({ message: 'Session store is temporarily unavailable.' });
            }
        } catch (err) {
            console.error("API_INDEX: Webhook - Error during Redis ping or client connection:", err);
            return res.status(503).json({ message: 'Failed to connect to the session store.' });
        }
    } else if (!redisClient && process.env.KV_URL) {
        console.error("API_INDEX: Webhook - KV_URL is set, but redisClient is unexpectedly null.");
        return res.status(500).json({ message: 'Session store configuration error.' });
    }

    Promise.all(req.body.events.map(event => handleEvent(event))) // reqは不要になった
        .then((result) => res.json(result))
        .catch((err) => {
            console.error('Webhook event processing error:', err);
            res.status(500).json({ message: 'Internal error.' });
        });
});

async function handleEvent(event) { // req引数を削除
    const userId = event.source.userId;

    if (!userId) {
        console.error('API_INDEX: Event source.userId is missing:', event);
        return Promise.resolve(null);
    }

    if (event.type === 'unfollow' || event.type === 'leave') {
        console.log(`API_INDEX: User ${userId} left or unfollowed.`);
        await deleteUserState(userId); // ユーザーデータを削除
        return null;
    }

    let userSessionData = await getUserState(userId);

    if (!userSessionData) {
        console.log(`API_INDEX: Initializing new session state for user ${userId}.`);
        userSessionData = {
            step: 0,
            name: '',
            birth: '',
            theme: ''
        };
    } else {
        console.log(`API_INDEX: Existing session found for user ${userId}:`, JSON.stringify(userSessionData));
    }

    console.log(`API_INDEX: Incoming event for user ${userId}, Step: ${userSessionData.step}. Event Type: ${event.type}`);
    console.log(`API_INDEX: Current session botState before handling:`, JSON.stringify(userSessionData));

    try {
        // 各ハンドラは userSessionData を直接変更し、最後に保存する
        if (event.type === 'message') {
            if (event.message.type === 'text') {
                // handleTextMessage に redisClient を渡すか、
                // または handleTextMessage が userSessionData を変更した後にここで保存する。
                // ここでは後者のアプローチ。
                await handleTextMessage(client, event, userSessionData);
            } else {
                console.log(`API_INDEX: Received non-text message type: ${event.message.type} from user ${userId}`);
                if (event.replyToken && !event.replyTokenExpired) {
                    await client.replyMessage({
                        replyToken: event.replyToken,
                        messages: [{ type: 'text', text: 'テキストメッセージで話しかけてくださいね。' }]
                    });
                }
            }
        } else if (event.type === 'postback') {
            await handlePostback(client, event, userSessionData);
        } else {
            console.log(`API_INDEX: Unhandled event type by this logic: ${event.type}`);
        }

        // 状態が変更された可能性があるので保存
        await saveUserState(userId, userSessionData);
        console.log(`API_INDEX: Session state saved for user ${userId} after handling. State:`, JSON.stringify(userSessionData));

    } catch (error) {
        console.error(`API_INDEX: Error handling event for ${userId}:`, error);
        if (event.replyToken && !event.replyTokenExpired) {
            try {
                await client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{ type: 'text', text: '申し訳ありません、処理中にエラーが発生しました。' }]
                });
            } catch (replyError) {
                console.error('API_INDEX: Failed to send error reply to user:', replyError);
            }
        } else if (event.replyTokenExpired) {
            console.warn(`API_INDEX: Reply token expired for event from user ${userId}.`);
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