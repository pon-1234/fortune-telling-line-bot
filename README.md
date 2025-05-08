# Fortune Telling LINE Bot (PoC)

LINE Bot + GPT + Google Sheets を利用した占いサービスの Proof of Concept (PoC) です。
ユーザーは LINE で占いリクエストを送信し、占い師は Google Sheets で内容を確認・編集して返信します。

## Features

- LINE Bot による対話形式の質問 (名前、生年月日、相談テーマ)
- OpenAI API (GPT) による占いテキストの自動生成
- Google Sheets へのリクエスト保存と占い師による編集インターフェース
- Google Apps Script によるステータス変更トリガーでの自動返信

## System Architecture

```mermaid
graph TD
  U((User via LINE)) -- Webhook --> Bot[Node.js Bot (Express on Vercel)]
  Bot -- Reply/Push --> U
  Bot -- Call API --> OpenAI[OpenAI API]
  OpenAI -- Generate Text --> Bot
  Bot -- Append Row --> Sheet[Google Sheets <br> 'Requests' Sheet]
  Fortuneteller[Fortuneteller] -- Edits Sheet --> Sheet
  Sheet -- onEdit Trigger --> GAS[Apps Script]
  GAS -- Call API --> LineAPI[LINE Messaging API]
  LineAPI -- Push Message --> U
```

## Setup

### 1. Prerequisites

- Node.js (v18 or later)
- Google Cloud Account (for Sheets API Service Account)
- LINE Developers Account (for Messaging API Channel)
- OpenAI API Key
- Vercel Account (or similar deployment platform)

### 2. Installation

```bash
git clone <repository_url>
cd fortune-telling-line
npm install
```

### 3. Environment Variables

- Copy `.env.example` to `.env`.
- Fill in the required values:
    - `CHANNEL_SECRET`: Your LINE Channel Secret.
    - `CHANNEL_ACCESS_TOKEN`: Your LINE Channel Access Token (long-lived preferred).
    - `OPENAI_API_KEY`: Your OpenAI API Key.
    - `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`: Path to your downloaded Google Service Account JSON key file (e.g., `./google-credentials.json`). Place the key file in the project root or specified path.
    - `SHEET_ID`: The ID of your Google Sheet.
    - `SHEET_NAME`: The name of the sheet tab (default: `Requests`).
    - `SESSION_SECRET`: A random string for session security.

### 4. Google Sheets Setup

1.  Create a new Google Sheet.
2.  Rename the first sheet tab to `Requests` (or match `SHEET_NAME` in `.env`).
3.  Set up the header row (A1:I1):
    `timestamp`, `userId`, `name`, `birth`, `theme`, `gptDraft`, `status`, `editedText`, `sentAt`
4.  **Enable Google Sheets API & Create Service Account:**
    - Go to Google Cloud Console, create a project (or use an existing one).
    - Enable the "Google Sheets API".
    - Go to "Credentials", create a "Service Account".
    - Download the JSON key file for the service account and save it (e.g., as `google-credentials.json` at the project root).
    - Note the service account's email address.
5.  **Share the Google Sheet:** Share your Google Sheet with the service account's email address, granting it "Editor" permissions.

### 5. Google Apps Script Setup

1.  Open your Google Sheet.
2.  Go to "Extensions" > "Apps Script".
3.  Copy the content of `docs/Code.gs` (provided separately or in the documentation) and paste it into the script editor, replacing any default code.
4.  In the script editor, go to "Project Settings" (gear icon) > "Script Properties".
5.  Add a script property:
    - **Property:** `LINE_ACCESS_TOKEN`
    - **Value:** Your LINE Channel Access Token (the same one used in `.env`).
6.  Go to "Triggers" (clock icon) > "Add Trigger".
7.  Configure the trigger:
    - **Choose which function to run:** `onEdit`
    - **Choose which deployment should run:** `Head`
    - **Select event source:** `From spreadsheet`
    - **Select event type:** `On edit`
8.  Save the trigger. You will be asked to authorize the script.

### 6. LINE Channel Setup

1.  Create a Messaging API channel on the LINE Developers Console.
2.  Get the Channel Secret and Channel Access Token (issue a long-lived one if possible) and put them in your `.env` file.
3.  Enable Webhooks and set the Webhook URL. If deploying to Vercel, it will be `https://<your-vercel-app-url>/webhook`.
4.  Disable "Auto-reply messages" and enable "Greeting messages" if desired.

### 7. Deployment (Example: Vercel)

1.  Push your code to a Git repository (GitHub, GitLab, etc.).
2.  Import the repository into Vercel.
3.  Configure the Environment Variables in the Vercel project settings (copy values from your local `.env`).
4.  Deploy.

## Usage Flow

1.  **User:** Adds the LINE Bot and starts a conversation.
2.  **Bot:** Asks for name, birth date, and desired fortune theme (using Quick Reply).
3.  **Bot:** Calls OpenAI API to generate a draft fortune.
4.  **Bot:** Appends the user's info and the GPT draft to the Google Sheet (`status` = `未検閲`).
5.  **Bot:** Sends a message to the user acknowledging the request.
6.  **Fortuneteller:** Opens the Google Sheet, reviews the `gptDraft` (Column F).
7.  **Fortuneteller:** Optionally enters a revised text in `editedText` (Column H).
8.  **Fortuneteller:** Changes the `status` (Column G) to `検閲済`.
9.  **Apps Script (onEdit Trigger):** Detects the status change.
10. **Apps Script:** Sends the `editedText` (or `gptDraft` if empty) to the user via LINE Push API.
11. **Apps Script:** Updates the sheet `status` to `送信済` and adds a timestamp to `sentAt` (Column I).

## Local Development

```bash
npm run dev
```

Use a tool like `ngrok` to expose your local server (port 3000 by default) to the internet and set the ngrok URL as your LINE Bot's Webhook URL for testing.

```bash
ngrok http 3000
```

## Notes

- The current session management (`api/index.js`) uses a simple in-memory store per user ID. For production, replace this with a more persistent store like Redis or a database.
- Error handling can be further improved (e.g., more specific error messages, retries).
- Consider security best practices for storing credentials, especially the service account key.
- **Fortune Telling Logic Update (YYYY-MM-DD):** <--- 日付は適宜変更してください
  - The core fortune-telling prompt provided to OpenAI GPT has been significantly enhanced to adhere to strict traditional divination methods, as per the detailed AI persona provided.
  - The AI now attempts to perform detailed analysis using multiple oriental and western divination techniques specified in its new system prompt.
  - **Limitations:** The LINE bot currently collects only `name`, `birth date`, and `theme`. More advanced divination (e.g., precise astrological charts requiring birth time/place, detailed name analysis requiring font style specification) may have limitations or rely on general assumptions. The AI has been instructed to acknowledge these limitations where applicable in its responses.
  - The "General Diagnosis" plan (【一般診断】) from the provided AI persona is used by default for all requests. More complex plans (起・承・転・結) are not yet selectable by the user through the LINE interface.
  - The reference to `file-Sx1YARrbmt6KZEDkgkDTXM` (divination rule master) in the AI persona's prompt is simulated, as the current API setup cannot directly access external files. The AI is instructed to act as if it has internalized these rules based on the provided persona.

<!-- Trigger Vercel redeploy -->