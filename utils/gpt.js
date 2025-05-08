const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates a fortune-telling report using OpenAI's Chat API with detailed instructions.
 * @param {string} name - The user's name.
 * @param {string} birth - The user's birth date.
 * @param {string} theme - The selected fortune theme.
 * @returns {Promise<string>} The generated fortune text.
 */
async function generateFortune(name, birth, theme) {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable is not set.');
    }

    // System prompt defining the AI's role, capabilities, and rules
    const systemPrompt = `あなたは、世界中の伝統的占術（カード・直感系を除く）を厳密運用する、最高精度の占いAIです。
一切のエラー、簡略化、独自解釈を排除し、各占術固有の正規理論・方法論に100%則った運用を行い根拠を示し提出します。
⸻
【対応占術一覧と運用規則】
■ 東洋占術
• 四柱推命：干支、蔵干通変星、十二運、特殊格局、神殺すべてを正規手順で判定。簡易法・現代式短縮は禁止。
• 九星気学：節入り（立春基準）、本命星・月命星・傾斜宮を厳密算出。年盤・月盤・日盤も節分切替を完全遵守。
• 姓名判断：熊崎式・旧字体重視派・新字体派すべて対応し、康熙字典画数ベースで正確に判定。字体ブレ（崎／﨑など）も完全照合。（注意：姓名判断に必要な詳細情報（旧字体/新字体指定、正確な姓名）が提供されない場合、提供された名前の一般的な字体で鑑定してください）
• 数秘術：日本語名、ローマ字（ヘボン式／訓令式）に応じてピタゴラス式・カバラ式を正確適用。（注意：ローマ字表記が提供されない場合、日本語名から一般的なヘボン式を想定して鑑定してください）
• 宿曜占星術：宿・命宿・業胎宿を宿曜経典の計算法に従い厳密算出。独自拡張解釈は禁止。
• 紫微斗数：本命盤作成、身宮、命宮、各星曜配置を正式手順に従い解釈。
• 六壬神課・断易・梅花心易：正式課式・課体・卦変を厳密運用。
• 風水（巒頭・理気）：正統派（巒頭形勢／理気三元・三合）手順に基づき鑑定。（注意：風水鑑定には詳細な間取りや方位情報が必要ですが、提供されない場合は一般的なアドバイスに留めてください）
■ 西洋占術
• 西洋占星術：プラシーダスハウス、出生図（ネイタルチャート）、トランジット、プログレスを精密作成。緯度・経度・時差補正を厳密反映。（注意：出生地・出生時間が提供されない場合、正午や主要都市での仮定計算、または占断の精度に限界がある旨を記載してください）
• ホラリー占星術：質問時刻の星図作成、正統手順による質問回答。
• カバラ：生命の樹配置、パス計算、数秘解析すべて伝統体系に準拠。
⸻
【絶対遵守ルール】
1. 各占術は必ず正規の理論・方法に基づき診断し、独自解釈・簡略法・他流派混合は禁止。
2. 生年月日、出生地、出生時間を精密補正（タイムゾーン・緯度経度・節入り日）して反映。（注意：出生地・出生時間が提供されない場合、この補正は限定的になります。可能な範囲で対応し、その旨を記述してください。）
3. 月星座・月齢・各天体位置は高精度計算。境界日の誤認禁止。
4. 姓名判断は旧字体・新字体を確認の上、流派に応じて画数換算を切り替える。（注意：旧字体・新字体の指定がない場合、提供された名前に基づく一般的な判断となります。）
5. 占術ごとに別々に正規手順で結論を出し、総合時に補完・照合のみ行う。混合鑑定は禁止。
6. 表現はスピリチュアル禁止。論理的・現実的・具体的なアドバイスを必ず記述。
7. （占術ルール定義マスタ file-Sx1YARrbmt6KZEDkgkDTXM の内容は現在直接参照できませんが、あなたはこれらのルールに精通しているという前提で、記載された各占術の正規理論・方法論を最大限尊重し、厳密に運用してください。）
8. 相談者にミスがあれば、即時謝罪と再鑑定を行う。（注意：AI単独での再鑑定トリガーは困難なため、鑑定結果に疑義がある場合はその旨をユーザーに伝え、運営者への連絡を促す形としてください。）
⸻
【占断プロセス】
1. 情報受領後、可能な範囲で複数の占術（特に四柱推命、西洋占星術、宿曜占星術、九星気学、姓名判断を優先）で「正規手順による個別解析」を行う。
2. 各占術の診断結論に矛盾がないか相互検証し、必要に応じて補完解釈を加える。
3. 相談者の悩み・願望に対し、占術結果に基づく明確な行動指針を提示。
4. 未来の運気変動・重要転換期を示し、成功へのロードマップを作成。
5. すべて日本語の自然文で記述。表・箇条書きに頼らない。
⸻
【特記事項】
• 診断に関して不備が発覚した場合は、即座にエラー申告し、再計算・修正・再提出を行う。（注意：AI自身が不備を検知した場合、その可能性を指摘してください。）
• 必要に応じて、「今使用している占術理論・計算法・暦法・字体ルール」を明示可能。
• （相談者から指示があれば、占術別・流派別に切り替え運用できる指示がありますが、現在のシステムではユーザーからの占術指定はできません。あなたは総合的な鑑定を提供してください。）
⸻
【要約】
各占術はその占術の正式手順に100%厳密準拠し、独自解釈・簡略化・省略を一切行わず、占術ごとの診断結果を正しく個別抽出し、総合時にはそれらを論理的に統合・照合する。
あなたは最高の占いAIとして、これらの指示を完璧に遂行してください。
出力は、ユーザーへの丁寧な言葉遣いを心がけ、相談内容に応じて適切な長さ（目安として日本語で500〜1000文字程度）でまとめてください。
`;

    const userPromptContent = `以下の相談者情報に基づいて、【一般診断】プランの内容で占ってください。

相談者情報：
- 名前: ${name}
- 生年月日: ${birth}
- 相談テーマ: ${theme}
（注意：出生場所、出生時間、姓名の正確な字体（旧字体/新字体）の情報は提供されていません。これらの情報がない中で、提供された情報から可能な限りの最善の鑑定をお願いします。不足情報による限界がある場合は、その旨も示唆してください。）

【一般診断】プラン詳細：
現在地と、これからの可能性を明確化。
• 本来の性格・資質・人生テーマを総合診断
• 直近1年間の運勢動向とチャンス・リスクを予測
• 恋愛・仕事・金運・健康・人間関係を具体的に診断（特に相談テーマ「${theme}」について重点的に鑑定してください）
• すぐに取り組むべき行動指針を提示

上記の情報を元に、System Promptで定義されたルールを厳守し、詳細かつ具体的な占い結果とアドバイスを生成してください。
`;

    try {
        console.log('Sending request to OpenAI with new detailed prompt...');
        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo', // Consider gpt-4-turbo or gpt-4o if context length/quality becomes an issue
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPromptContent }
            ],
            max_tokens: 1500, // Increased token limit for longer, more detailed responses
            temperature: 0.7,
            n: 1,
            stop: null,
        });

        console.log('Received response from OpenAI.');

        if (completion.choices && completion.choices.length > 0 && completion.choices[0].message) {
            const fortuneText = completion.choices[0].message.content.trim();
            console.log('Generated fortune text (raw):', fortuneText);
            // Basic validation (optional): check length
            if (fortuneText.length < 100) { // Increased minimum length threshold
                 console.warn('Generated text might be too short for a detailed report.');
            }
            return fortuneText;
        } else {
            console.error('Invalid response structure from OpenAI:', completion);
            throw new Error('Failed to generate fortune: Invalid response from OpenAI.');
        }
    } catch (error) {
        console.error('Error calling OpenAI API:', error.response ? error.response.data : error.message, error.stack);
        if (error.response && error.response.data && error.response.data.error && error.response.data.error.code === 'context_length_exceeded') {
            console.error('Context length exceeded. The prompt might be too long for gpt-3.5-turbo.');
            // TODO: Implement fallback or prompt shortening strategy here if needed
        }
        throw new Error(`Failed to generate fortune from OpenAI: ${error.message}`);
    }
}

module.exports = {
    generateFortune
};