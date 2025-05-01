const { generateFortune } = require('../../utils/gpt');
const { appendFortuneRequest } = require('../../utils/sheets');
const querystring = require('querystring');

/**
 * Handles incoming postback events, specifically for theme selection.
 * @param {line.messagingApi.MessagingApiClient} client - LINE Messaging API client.
 * @param {object} event - The LINE webhook event object.
 * @param {object} sessionData - User's session data (e.g., { step: 3, name: '花子', birth: '1993-07-21', theme: '' }).
 */
async function handlePostback(client, event, sessionData) {
    const userId = event.source.userId;
    const replyToken = event.replyToken;
    const postbackData = querystring.parse(event.postback.data);

    console.log(`Postback handler - User: ${userId}, Step: ${sessionData.step}, Data:`, postbackData);

    // Ensure this postback is for theme selection and we are in the correct step
    if (postbackData.action === 'select_theme' && sessionData.step === 3) {
        sessionData.theme = postbackData.theme;
        sessionData.step = 4; // Move to processing step

        // Immediately acknowledge the selection (optional but good UX)
        // await client.replyMessage({ replyToken, messages: [{ type: 'text', text: `${sessionData.theme}ですね！結果を生成しています...` }] });
        // Using replyToken only once is safer. We will reply after processing.

        try {
            console.log(`User ${userId}: Generating fortune for ${sessionData.name}, ${sessionData.birth}, ${sessionData.theme}`);

            // 1. Generate fortune using OpenAI
            const gptDraft = await generateFortune(sessionData.name, sessionData.birth, sessionData.theme);

            console.log(`User ${userId}: Fortune generated. Appending to sheet...`);

            // 2. Append data to Google Sheet
            await appendFortuneRequest(
                userId,
                sessionData.name,
                sessionData.birth,
                sessionData.theme,
                gptDraft
            );

            console.log(`User ${userId}: Successfully appended to sheet.`);

            // 3. Notify user
            await client.replyMessage({
                replyToken: replyToken,
                messages: [{
                    type: 'text',
                    text: `ありがとうございます、${sessionData.name}さん。
テーマ「${sessionData.theme}」で承りました。

占い師が内容を確認した後、結果をお送りしますので、少々お待ちくださいね。`
                }]
            });

            // Reset session after successful submission
            // Or keep it if you plan for follow-up interactions
            // delete req.session.userData; // Example of resetting
            sessionData.step = 0; // Reset for next interaction
            console.log(`User ${userId}: Process complete. Session step reset to 0.`);

        } catch (error) {
            console.error(`Error processing fortune request for user ${userId}:`, error);
            sessionData.step = 3; // Revert step to allow retry?
            try {
                await client.replyMessage({
                    replyToken: replyToken,
                    messages: [{ type: 'text', text: '申し訳ありません、リクエストの処理中にエラーが発生しました。もう一度テーマを選び直してください。' }]
                });
            } catch (replyError) {
                console.error('Failed to send error reply:', replyError);
            }
        }

    } else {
        console.log(`Unhandled postback or incorrect step - User: ${userId}, Step: ${sessionData.step}, Data:`, postbackData);
        // Send a generic reply or ignore
        try {
            await client.replyMessage({ replyToken, messages: [{ type: 'text', text: '予期しない操作が行われました。最初からやり直してください。' }] });
            sessionData.step = 0; // Reset state
        } catch (replyError) {
            console.error('Failed to send unhandled postback reply:', replyError);
        }
    }
}

module.exports = {
    handlePostback
};
