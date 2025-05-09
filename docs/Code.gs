/**
 * Google Apps Script to send LINE message when status is updated in Google Sheet.
 * Trigger: onEdit
 */

// --- Script Properties ---
// You need to set 'LINE_ACCESS_TOKEN' in the script's properties.
// File > Project properties > Script properties
// Property Name: LINE_ACCESS_TOKEN
// Value: Your LINE Channel Access Token (Long-lived or use OAuth2 for better security if needed)
// -----------------------

var TARGET_SHEET_NAME = 'data'; // Match with Node.js config and README

/**
 * The event handler triggered when the spreadsheet is edited.
 * @param {Event} e The onEdit event object.
 */
function onEdit(e) {
    // 引数が正しく渡されているかチェック
    if (!e || !e.source || !e.range) {
        Logger.log('onEdit was called without proper event object');
        return;
    }
    
    var s = e.source.getActiveSheet();
    var editedRange = e.range;
    var editedColumn = editedRange.getColumn(); // 列番号 (A=1, B=2, ...)
    var editedRow = editedRange.getRow();

    // Check if the edited sheet is TARGET_SHEET_NAME and the edited column is H (status, column 8)
    // Also check if the edited value is '検閲済'
    // Headers: timestamp(A), userId(B), name(C), birth(D), theme(E), gptDraft(F), editedText(G), status(H), sentAt(I)
    if (s.getName() !== TARGET_SHEET_NAME || editedColumn !== 8 || e.value !== '検閲済') {  
        Logger.log('Edit ignored: Sheet=' + s.getName() + ', Col=' + editedColumn + ', Value=' + e.value + ', Expected Sheet: ' + TARGET_SHEET_NAME + ', Expected Col: 8, Expected Value: 検閲済');
        return;
    }

    Logger.log('Processing edit for row ' + editedRow);

    // Get the data from the edited row (Columns A to I)
    // Indices: 0=A, 1=B, 2=C, 3=D, 4=E, 5=F(gptDraft), 6=G(editedText), 7=H(status), 8=I(sentAt)
    var data = s.getRange(editedRow, 1, 1, 9).getValues()[0];  
    var userId = data[1];      // Column B
    var gptDraft = data[5];    // Column F
    var editedText = data[6];  // Column G (editedText)
    // var statusValue = data[7]; // Column H (status, already know it's '検閲済' from check above)

    // Determine the text to send: Use editedText (Column G) if available, otherwise use gptDraft (Column F)
    var textToSend = (editedText && editedText.toString().trim() !== '') ? editedText.toString().trim() : gptDraft.toString().trim();

    if (!userId || !textToSend) {
        Logger.log('Missing userId or text to send for row ' + editedRow + '. userId: ' + userId + ', text: ' + textToSend);
        SpreadsheetApp.getUi().alert('Row ' + editedRow + ': 送信に必要なユーザーIDまたは本文がありません。');
        s.getRange(editedRow, 8).setValue('送信エラー:情報不足'); // Update status (Column H) to indicate error
        return;
    }

    Logger.log('Attempting to send message to userId: ' + userId);

    // Send the message via LINE Push API
    if (pushLine(userId, textToSend)) {
        Logger.log('Successfully sent message to ' + userId + '. Updating sheet.');
        // If sending is successful, update status to '送信済' and record the sent timestamp
        s.getRange(editedRow, 8).setValue('送信済');      // Column H (status)
        s.getRange(editedRow, 9).setValue(new Date()); // Column I (sentAt)
    } else {
        Logger.log('Failed to send message to ' + userId + '.');
        // If sending fails, show an alert
        SpreadsheetApp.getUi().alert('Row ' + editedRow + ': LINEメッセージの送信に失敗しました。ステータスは「検閲済」のままです。');
        // Optionally, update status to reflect the error, e.g., '送信失敗'
        // s.getRange(editedRow, 8).setValue('送信失敗');
    }
}

/**
 * Sends a push message to a specified LINE user.
 * @param {string} to The LINE user ID to send the message to.
 * @param {string} message The text message to send.
 * @return {boolean} True if the message was sent successfully (HTTP 200), false otherwise.
 */
function pushLine(to, message) {
    var token = PropertiesService.getScriptProperties().getProperty('LINE_ACCESS_TOKEN');
    if (!token) {
        Logger.log('Error: LINE_ACCESS_TOKEN script property is not set.');
        SpreadsheetApp.getUi().alert('設定エラー: LINE アクセストークンがスクリプトプロパティに設定されていません。');
        return false;
    }

    var url = 'https://api.line.me/v2/bot/message/push';
    var payload = {
        to: to,
        messages: [{ type: 'text', text: message }]
    };

    var options = {
        method: 'post',
        headers: { Authorization: 'Bearer ' + token },
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true, // Prevent script termination on HTTP errors, allowing us to check the response code
    };

    try {
        var response = UrlFetchApp.fetch(url, options);
        var responseCode = response.getResponseCode();
        var responseBody = response.getContentText();

        if (responseCode === 200) {
            Logger.log('LINE Push API success for user ' + to + '.');
            return true;
        } else {
            Logger.log('LINE Push API error for user ' + to + '. Code: ' + responseCode + ', Body: ' + responseBody);
            return false;
        }
    } catch (error) {
        Logger.log('Error during UrlFetchApp.fetch: ' + error.toString());
        return false;
    }
}

/**
 * 状態列（H列）にドロップダウンリストを設定する関数
 * この関数を一度手動で実行すると、H列に選択式のドロップダウンリストが設定されます。
 */
function setupStatusColumnValidation() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(TARGET_SHEET_NAME);
    
    if (!sheet) {
        SpreadsheetApp.getUi().alert('シート \'' + TARGET_SHEET_NAME + '\' が見つかりません。');
        return;
    }
    
    var lastRow = Math.max(sheet.getLastRow(), 100); // 将来のエントリ用に少なくとも100行
    
    // H列（状態列）の範囲を定義、2行目から開始（1行目はヘッダーと仮定）
    var statusRange = sheet.getRange(2, 8, lastRow - 1); // H列は8番目の列
    
    var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['未検閲', '検閲済', '送信済', '送信エラー:情報不足', '送信失敗'], true)
        .setAllowInvalid(false)
        .build();
    
    statusRange.setDataValidation(rule);
    
    SpreadsheetApp.getUi().alert('状態列（H列）にドロップダウンリストを設定しました。');
}