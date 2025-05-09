// /api/handlers/postbackHandler.js (変更なし、または微調整のみ)
const { generateFortune } = require('../../utils/gpt');
const { appendFortuneRequest } = require('../../utils/sheets');
const querystring = require('querystring');

/**
 * Handles incoming postback events, specifically for theme selection.
 * @param {line.messagingApi.MessagingApiClient} client - LINE Messaging API client.
 * @param {object} event - The LINE webhook event object.
 * @param {object} sessionData - User's session data (e.g., { step: 3, name: '花子', birth: '1993-07-21', theme: '' }).
 *                               This object will be directly mutated by this function.
 */
async function handlePostback(client, event, sessionData) {
    const userId = event.source.userId;
    const replyToken = event.replyToken;
    const postbackData = querystring.parse(event.postback.data);

    // sessionData は index.js の userSessionData への参照なので、
    // この関数内で sessionData のプロパティを変更すれば、
    // index.js 側の userSessionData も変更される。
    // 保存は index.js の handleEvent の最後で行われる。

    console.log(`Postback handler - User: ${userId}, Step: ${sessionData.step}, Data:`, postbackData, `Current sessionData:`, JSON.stringify(sessionData));

    // Ensure this postback is for theme selection and we are in the correct step
    if (postbackData.action === 'select_theme' && sessionData.step === 3) {
        sessionData.theme = postbackData.theme;
        sessionData.step = 4; // Move to processing step

        try {
            console.log(`User ${userId}: Generating fortune for ${sessionData.name}, ${sessionData.birth}, ${sessionData.theme}`);

            const gptDraft = await generateFortune(sessionData.name, sessionData.birth, sessionData.theme);
            console.log(`User ${userId}: Fortune generated. Appending to sheet...`);

            await appendFortuneRequest(
                userId,
                sessionData.name,
                sessionData.birth,
                sessionData.theme,
                gptDraft
            );
            console.log(`User ${userId}: Successfully appended to sheet.`);

            await client.replyMessage({
                replyToken: replyToken,
                messages: [{
                    type: 'text',
                    text: `ありがとうございます、${sessionData.name}さん。
テーマ「${sessionData.theme}」で承りました。

占い師が内容を確認した後、結果をお送りしますので、少々お待ちくださいね。`
                }]
            });

            // Reset session data object directly for next interaction
            sessionData.step = 0;
            sessionData.name = ''; // Optionally clear other fields too
            sessionData.birth = '';
            sessionData.theme = '';
            console.log(`User ${userId}: Process complete. Session data reset. New sessionData:`, JSON.stringify(sessionData));

        } catch (error) {
            console.error(`Error processing fortune request for user ${userId}:`, error);
            sessionData.step = 3; // Revert step to allow retry
            try {
                if (replyToken && !event.replyTokenExpired) { // Check if replyToken is still valid
                    await client.replyMessage({
                        replyToken: replyToken,
                        messages: [{ type: 'text', text: '申し訳ありません、リクエストの処理中にエラーが発生しました。もう一度テーマを選び直してください。' }]
                    });
                }
            } catch (replyError) {
                console.error('Failed to send error reply:', replyError);
            }
        }

    } else {
        console.log(`Unhandled postback or incorrect step - User: ${userId}, Step: ${sessionData.step}, Data:`, postbackData);
        try {
            if (replyToken && !event.replyTokenExpired) { // Check if replyToken is still valid
                await client.replyMessage({ replyToken, messages: [{ type: 'text', text: '予期しない操作が行われました。最初からやり直してください。' }] });
            }
            // Reset session data object directly
            sessionData.step = 0;
            sessionData.name = '';
            sessionData.birth = '';
            sessionData.theme = '';
            console.log(`POSTBACK_HANDLER: Session reset due to unhandled postback for user ${userId}. New sessionData:`, JSON.stringify(sessionData));
        } catch (replyError) {
            console.error('Failed to send unhandled postback reply:', replyError);
        }
    }
}

module.exports = {
    handlePostback
};