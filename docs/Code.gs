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
 
-const TARGET_SHEET_NAME = 'data'; // <--- The name of the sheet to monitor
+const TARGET_SHEET_NAME = 'Requests'; // Match with Node.js config and README
 
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
   
   const s = e.source.getActiveSheet();
   const editedRange = e.range;
   const editedColumn = editedRange.getColumn();
   const editedRow = editedRange.getRow();
 
   // Check if the edited sheet is TARGET_SHEET_NAME and the edited column is H (status, column 8)
   // Also check if the edited value is '検閲済'
   if (s.getName() !== TARGET_SHEET_NAME || editedColumn !== 8 || e.value !== '検閲済') { 
     Logger.log(`Edit ignored: Sheet=${s.getName()}, Col=${editedColumn}, Value=${e.value}, Expected Sheet: ${TARGET_SHEET_NAME}, Expected Col: 8, Expected Value: 検閲済`);
     return;
   }
 
   Logger.log(`Processing edit for row ${editedRow}`);
 
   // Get the data from the edited row (Columns A to I)
   // Indices: 0=timestamp, 1=userId, 2=name, 3=birth, 4=theme, 5=gptDraft, 6=editedText, 7=status, 8=sentAt
   const data = s.getRange(editedRow, 1, 1, 9).getValues()[0];
   const userId = data[1]; // B column
   const gptDraft = data[5];   // F column
   const editedText = data[6]; // G column
 
   // Determine the text to send: Use editedText if available, otherwise use gptDraft
   const textToSend = editedText && editedText.trim() !== '' ? editedText.trim() : gptDraft.trim();
 
   if (!userId || !textToSend) {
     Logger.log(`Missing userId or text to send for row ${editedRow}. userId: ${userId}, text: ${textToSend}`);
     SpreadsheetApp.getUi().alert(`Row ${editedRow}: 送信に必要なユーザーIDまたは本文がありません。`);
     s.getRange(editedRow, 8).setValue('送信エラー:情報不足'); // Update status (H column) to indicate error
     return;
   }
 
   Logger.log(`Attempting to send message to userId: ${userId}`);
 
   // Send the message via LINE Push API
   if (pushLine(userId, textToSend)) {
     Logger.log(`Successfully sent message to ${userId}. Updating sheet.`);
     // If sending is successful, update status to '送信済' and record the sent timestamp
     s.getRange(editedRow, 8).setValue('送信済'); // Column H (status)
     s.getRange(editedRow, 9).setValue(new Date()); // Column I (sentAt)
   } else {
     Logger.log(`Failed to send message to ${userId}.`);
     // If sending fails, show an alert
     SpreadsheetApp.getUi().alert(`Row ${editedRow}: LINEメッセージの送信に失敗しました。ステータスは「検閲済」のままです。`);
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
 
 /**
  * 状態列（H列）にドロップダウンリストを設定する関数
  * この関数を一度手動で実行すると、H列に選択式のドロップダウンリストが設定されます。
  */
 function setupStatusColumnValidation() {
   const ss = SpreadsheetApp.getActiveSpreadsheet();
   const sheet = ss.getSheetByName(TARGET_SHEET_NAME);
   
   if (!sheet) {
     SpreadsheetApp.getUi().alert(`シート '${TARGET_SHEET_NAME}' が見つかりません。`);
     return;
   }
   
   // A列（または常にデータがある列）の最終行を取得
   const lastRow = Math.max(sheet.getLastRow(), 100); // 将来のエントリ用に少なくとも100行
   
   // H列（状態列）の範囲を定義、2行目から開始（1行目はヘッダーと仮定）
   const statusRange = sheet.getRange(2, 8, lastRow - 1);
   
   // 状態オプションを含むドロップダウン検証を作成
   const rule = SpreadsheetApp.newDataValidation()
     .requireValueInList(['未検閲', '検閲済', '送信済', '送信エラー:情報不足', '送信失敗'], true) // Added '未検閲', '送信失敗' for completeness
     .setAllowInvalid(false)
     .build();
   
   // 検証ルールを状態列に適用
   statusRange.setDataValidation(rule);
   
   SpreadsheetApp.getUi().alert('状態列（H列）にドロップダウンリストを設定しました。');
 }