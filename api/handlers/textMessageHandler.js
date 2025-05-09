const { createThemeQuickReply } = require('../../utils/quickReply');

/**
 * Handles incoming text messages based on the current session step.
 * @param {line.messagingApi.MessagingApiClient} client - LINE Messaging API client.
 * @param {object} event - The LINE webhook event object.
 * @param {object} sessionData - User's session data (e.g., { step: 0, name: '', birth: '', theme: '' }).
 */
async function handleTextMessage(client, event, sessionData) {
    const userId = event.source.userId;
    const text = event.message.text.trim();
    const replyToken = event.replyToken;

    console.log(`Text message handler - User: ${userId}, Step: ${sessionData.step}, Text: ${text}`);

    try {
        switch (sessionData.step) {
            case 0: // Initial state or asking for name
                // Assuming the first message is a trigger, or asking for name directly
                await client.replyMessage({ replyToken, messages: [{ type: 'text', text: 'こんにちは！占いを始めますね。\nまず、あなたのお名前を教えていただけますか？' }] });
                sessionData.step = 1;
                // ★追加: ステップ変更後のセッションデータをログに出力
                console.log(`TEXT_HANDLER: Step updated for user ${userId}. New sessionData:`, JSON.stringify(sessionData));
                break;

            case 1: // Waiting for name
                if (!text) {
                    await client.replyMessage({ replyToken, messages: [{ type: 'text', text: 'お名前を入力してください。' }] });
                    return;
                }
                sessionData.name = text;
                await client.replyMessage({ replyToken, messages: [{ type: 'text', text: `${text}さんですね！\n次に、生年月日を教えてください。（例：1993-07-21 や 1993/7/21）` }] });
                sessionData.step = 2;
                console.log(`TEXT_HANDLER: Step updated for user ${userId}. New sessionData:`, JSON.stringify(sessionData)); // ★デバッグ用にここにも追加
                break;

            case 2: // Waiting for birth date
                const birthDatePattern = /^\d{4}[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])$/;
                if (!text || !birthDatePattern.test(text)) {
                    await client.replyMessage({ replyToken, messages: [{ type: 'text', text: '生年月日を正しい形式で入力してください。（例：1993-07-21）' }] });
                    return;
                }
                sessionData.birth = text.replace(/\//g, '-');
                const quickReplyMessage = createThemeQuickReply('ありがとうございます！\n最後に、占ってほしいテーマを選んでください。');
                await client.replyMessage({ replyToken, messages: [quickReplyMessage] });
                sessionData.step = 3; // Now waiting for theme selection via postback
                console.log(`TEXT_HANDLER: Step updated for user ${userId}. New sessionData:`, JSON.stringify(sessionData)); // ★デバッグ用にここにも追加
                break;

            case 3: // Waiting for theme (should be handled by postback, but handle text input as fallback/reset)
                const fallbackQuickReply = createThemeQuickReply('下のボタンから占ってほしいテーマを選んでくださいね。');
                await client.replyMessage({ replyToken, messages: [fallbackQuickReply] });
                // Keep step at 3
                break;

            case 4: // Processing or already submitted
                await client.replyMessage({ replyToken, messages: [{ type: 'text', text: 'ありがとうございます。現在、占い結果を作成中です。少々お待ちください。' }] });
                break;

            default:
                console.log(`Unhandled step: ${sessionData.step} for user: ${userId}`);
                sessionData.step = 0; // Reset step
                sessionData.name = '';
                sessionData.birth = '';
                sessionData.theme = '';
                await client.replyMessage({ replyToken, messages: [{ type: 'text', text: 'セッションがリセットされました。もう一度最初からお願いします。\nお名前を教えてください。' }] });
                console.log(`TEXT_HANDLER: Session reset for user ${userId}. New sessionData:`, JSON.stringify(sessionData)); // ★デバッグ用にここにも追加
                break;
        }
    } catch (error) {
        console.error(`Error in text message handler for step ${sessionData.step}, user ${userId}:`, error);
        try {
            await client.replyMessage({ replyToken, messages: [{ type: 'text', text: 'エラーが発生しました。もう一度お試しいただくか、時間をおいて再度お試しください。' }] });
        } catch (replyError) {
            console.error('Failed to send error reply:', replyError);
        }
    }
}

module.exports = {
    handleTextMessage
};