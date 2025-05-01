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

const TARGET_SHEET_NAME = 'data'; // <--- The name of the sheet to monitor

/**
 * The event handler triggered when the spreadsheet is edited.
 * @param {Event} e The onEdit event object.
 */
function onEdit(e) {
  const s = e.source.getActiveSheet();
  const editedRange = e.range;
  const editedColumn = editedRange.getColumn();
  const editedRow = editedRange.getRow();

  // Check if the edited sheet is TARGET_SHEET_NAME and the edited column is G (status, column 7)
  // Also check if the edited value is '検閲済'
  if (s.getName() !== TARGET_SHEET_NAME || editedColumn !== 7 || e.value !== '検閲済') { 
    Logger.log(`Edit ignored: Sheet=${s.getName()}, Col=${editedColumn}, Value=${e.value}`);
    return;
  }

  Logger.log(`Processing edit for row ${editedRow}`);

  // Get the data from the edited row (Columns A to I)
  // Indices: 0=timestamp, 1=userId, 2=name, 3=birth, 4=theme, 5=gptDraft, 6=status, 7=editedText, 8=sentAt
  const data = s.getRange(editedRow, 1, 1, 9).getValues()[0];
  const userId = data[1];
  const gptDraft = data[5];
  const editedText = data[7]; // Column H

  // Determine the text to send: Use editedText if available, otherwise use gptDraft
  const textToSend = editedText ? editedText.trim() : gptDraft.trim();

  if (!userId || !textToSend) {
    Logger.log(`Missing userId or text to send for row ${editedRow}. userId: ${userId}, text: ${textToSend}`);
    SpreadsheetApp.getUi().alert(`Row ${editedRow}: 送信に必要なユーザーIDまたは本文がありません。`);
    s.getRange(editedRow, 7).setValue('送信エラー:情報不足'); // Update status to indicate error
    return;
  }

  Logger.log(`Attempting to send message to userId: ${userId}`);

  // Send the message via LINE Push API
  if (pushLine(userId, textToSend)) {
    Logger.log(`Successfully sent message to ${userId}. Updating sheet.`);
    // If sending is successful, update status to '送信済' and record the sent timestamp
    s.getRange(editedRow, 7).setValue('送信済'); // Column G
    s.getRange(editedRow, 9).setValue(new Date()); // Column I
  } else {
    Logger.log(`Failed to send message to ${userId}.`);
    // If sending fails, show an alert
    SpreadsheetApp.getUi().alert(`Row ${editedRow}: LINEメッセージの送信に失敗しました。ステータスは「検閲済」のままです。`);
    // Optionally, update status to reflect the error, e.g., '送信失敗'
    // s.getRange(editedRow, 7).setValue('送信失敗');
  }
}

/**
 * Sends a push message to a specified LINE user.
 * @param {string} to The LINE user ID to send the message to.
 * @param {string} message The text message to send.
 * @return {boolean} True if the message was sent successfully (HTTP 200), false otherwise.
 */
function pushLine(to, message) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_ACCESS_TOKEN');
  if (!token) {
    Logger.log('Error: LINE_ACCESS_TOKEN script property is not set.');
    SpreadsheetApp.getUi().alert('設定エラー: LINE アクセストークンがスクリプトプロパティに設定されていません。');
    return false;
  }

  const url = 'https://api.line.me/v2/bot/message/push';
  const payload = {
    to: to,
    messages: [{ type: 'text', text: message }]
  };

  const options = {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true, // Prevent script termination on HTTP errors, allowing us to check the response code
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode === 200) {
      Logger.log(`LINE Push API success for user ${to}.`);
      return true;
    } else {
      Logger.log(`LINE Push API error for user ${to}. Code: ${responseCode}, Body: ${responseBody}`);
      return false;
    }
  } catch (error) {
    Logger.log(`Error during UrlFetchApp.fetch: ${error}`);
    return false;
  }
}
