const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates a fortune-telling report using OpenAI's Chat API.
 * @param {string} name - The user's name.
 * @param {string} birth - The user's birth date.
 * @param {string} theme - The selected fortune theme.
 * @returns {Promise<string>} The generated fortune text.
 */
async function generateFortune(name, birth, theme) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable is not set.');
    }

    const prompt = `あなたはプロの占い師です。以下の情報をもとに、誠実で心に寄り添うような丁寧な言葉遣いで、300〜500文字程度の占いレポートを作成してください。

- 名前: ${name}
- 生年月日: ${birth}
- 相談テーマ: ${theme}

レポート：`;

    try {
        console.log('Sending request to OpenAI...');
        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo', // Or consider 'gpt-4o-mini' or other suitable models
            messages: [
                { role: 'system', content: 'あなたはプロの占い師です。ユーザーの情報に基づいて、誠実で心に寄り添うような丁寧な言葉遣いで、300〜500文字程度の占いレポートを作成します。' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 600, // Allow slightly more tokens to ensure 500 chars fit
            temperature: 0.7, // Adjust for creativity vs consistency
            n: 1,
            stop: null,
        });

        console.log('Received response from OpenAI.');

        if (completion.choices && completion.choices.length > 0 && completion.choices[0].message) {
            const fortuneText = completion.choices[0].message.content.trim();
            console.log('Generated fortune text (raw):', fortuneText);
            // Basic validation (optional): check length
            if (fortuneText.length < 50) {
                 console.warn('Generated text might be too short.');
            }
            return fortuneText;
        } else {
            console.error('Invalid response structure from OpenAI:', completion);
            throw new Error('Failed to generate fortune: Invalid response from OpenAI.');
        }
    } catch (error) {
        console.error('Error calling OpenAI API:', error.response ? error.response.data : error.message);
        throw new Error(`Failed to generate fortune from OpenAI: ${error.message}`);
    }
}

module.exports = {
    generateFortune
};
