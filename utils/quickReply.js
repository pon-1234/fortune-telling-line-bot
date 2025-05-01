/**
 * Generates a LINE text message object with Quick Reply buttons for selecting a theme.
 * @param {string} text - The text message to display before the quick replies.
 * @returns {object} LINE message object with quick replies.
 */
function createThemeQuickReply(text) {
    // Define the themes for quick reply
    const themes = ['恋愛運', '仕事運', '健康運', '金運', '総合運'];

    const items = themes.map(theme => ({
        type: 'action',
        action: {
            type: 'postback',
            label: theme,
            data: `action=select_theme&theme=${encodeURIComponent(theme)}`, // Postback data includes action and selected theme
            displayText: `${theme}について相談する` // Text shown in chat when user taps the button
        }
    }));

    return {
        type: 'text',
        text: text,
        quickReply: {
            items: items
        }
    };
}

module.exports = {
    createThemeQuickReply
};
