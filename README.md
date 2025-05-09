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
- Redis-compatible store (e.g., Vercel KV, Upstash, local Redis for development) for session management in production.

### 2. Installation

```bash
git clone <repository_url>
cd fortune-telling-line
npm install
```

### 3. Environment Variables

- Copy `.env.example` to `.env` for local development.
- For Vercel deployment, set these in the Vercel project settings.
- Fill in the required values:
    - `CHANNEL_SECRET`: Your LINE Channel Secret.
    - `CHANNEL_ACCESS_TOKEN`: Your LINE Channel Access Token (long-lived preferred).
    - `OPENAI_API_KEY`: Your OpenAI API Key.
    - `GOOGLE_CREDENTIALS_JSON`: The **JSON content** of your Google Service Account key file. (See Google Sheets Setup below).
    - `SHEET_ID`: The ID of your Google Sheet.
    - `SHEET_NAME`: The name of the sheet tab (default: `Requests`).
    - `SESSION_SECRET`: A random string for session security.
    - `KV_URL` (Optional but Recommended for Vercel): Connection string for your Redis-compatible session store (e.g., Vercel KV URL). If not provided, sessions will use in-memory storage (not suitable for production on Vercel).

### 4. Google Sheets Setup

1.  Create a new Google Sheet.
2.  Rename the first sheet tab to `Requests` (or match `SHEET_NAME` in your environment variables).
3.  Set up the header row (A1:I1):
    `timestamp`(A), `userId`(B), `name`(C), `birth`(D), `theme`(E), `gptDraft`(F), **`editedText`(G)**, **`status`(H)**, `sentAt`(I)
4.  **Enable Google Sheets API & Create Service Account:**
    - Go to Google Cloud Console, create a project (or use an existing one).
    - Enable the "Google Sheets API".
    - Go to "Credentials", create a "Service Account".
    - Download the JSON key file for the service account.
    - **Important:** Copy the **entire content** of this JSON file and set it as the value for the `GOOGLE_CREDENTIALS_JSON` environment variable in your `.env` file (for local) or Vercel project settings. Do NOT commit the JSON file itself if you are using a file path method locally.
    - Note the service account's email address.
5.  **Share the Google Sheet:** Share your Google Sheet with the service account's email address, granting it "Editor" permissions.

### 5. Google Apps Script Setup

1.  Open your Google Sheet.
2.  Go to "Extensions" > "Apps Script".
3.  Copy the content of `docs/Code.gs` (updated version below) and paste it into the script editor, replacing any default code.
4.  In the script editor, go to "Project Settings" (gear icon) > "Script Properties".
5.  Add a script property:
    - **Property:** `LINE_ACCESS_TOKEN`
    - **Value:** Your LINE Channel Access Token (the same one used in your environment variables).
6.  Go to "Triggers" (clock icon) > "Add Trigger".
7.  Configure the trigger:
    - **Choose which function to run:** `onEdit`
    - **Choose which deployment should run:** `Head`
    - **Select event source:** `From spreadsheet`
    - **Select event type:** `On edit`
8.  Save the trigger. You will be asked to authorize the script.

### 6. LINE Channel Setup

1.  Create a Messaging API channel on the LINE Developers Console.
2.  Get the Channel Secret and Channel Access Token and set them as environment variables.
3.  Enable Webhooks and set the Webhook URL. If deploying to Vercel, it will be `https://<your-vercel-app-url>/webhook`.
4.  Disable "Auto-reply messages" and enable "Greeting messages" if desired.

### 7. Deployment (Example: Vercel)

1.  Push your code to a Git repository (GitHub, GitLab, etc.).
2.  Import the repository into Vercel.
3.  Configure the Environment Variables in the Vercel project settings (use values from your local `.env` or directly). Make sure `GOOGLE_CREDENTIALS_JSON` contains the JSON string, not a path. Set `KV_URL` if using Vercel KV for sessions.
4.  Deploy. Vercel will typically run `npm install` and then `npm start` (or the command specified in `vercel.json` for the build).

## Usage Flow

1.  **User:** Adds the LINE Bot and starts a conversation.
2.  **Bot:** Asks for name, birth date, and desired fortune theme (using Quick Reply).
3.  **Bot:** Calls OpenAI API to generate a draft fortune.
4.  **Bot:** Appends the user's info and the GPT draft to the Google Sheet (`status` (Column H) = `未検閲`, `editedText` (Column G) = empty).
5.  **Bot:** Sends a message to the user acknowledging the request.
6.  **Fortuneteller:** Opens the Google Sheet, reviews the `gptDraft` (Column F).
7.  **Fortuneteller:** Optionally enters a revised text in `editedText` (Column G).
8.  **Fortuneteller:** Changes the `status` (Column H) to `検閲済`.
9.  **Apps Script (onEdit Trigger):** Detects the status change in Column H.
10. **Apps Script:** Sends the `editedText` (Column G) (or `gptDraft` (Column F) if G is empty) to the user via LINE Push API.
11. **Apps Script:** Updates the sheet `status` (Column H) to `送信済` and adds a timestamp to `sentAt` (Column I).

## Local Development

```bash
npm run dev
```

Use a tool like `ngrok` to expose your local server (port specified in `api/index.js` or default 3000) to the internet and set the ngrok URL as your LINE Bot's Webhook URL for testing.

```bash
ngrok http 3000 # Or your app's port
```

## Notes

- **Session Management:** The current `api/index.js` is configured to use `express-session`. For production on serverless platforms like Vercel, it's **highly recommended** to use a persistent session store like Redis (e.g., Vercel KV, Upstash). The example code includes setup for `connect-redis`. Using the default `MemoryStore` will lead to session loss between requests in a serverless environment and is not suitable for production.
- **Error Handling:** Error handling can be further improved (e.g., more specific error messages, retries for API calls).
- **Security:** Always handle API keys and credentials securely. Do not commit sensitive information directly into your repository. Use environment variables.
- **Fortune Telling Logic Update (2025-05-09):** <--- 日付は適宜変更してください
    - The core fortune-telling prompt provided to OpenAI GPT has been significantly enhanced to adhere to strict traditional divination methods, as per the detailed AI persona provided.
    - The AI now attempts to perform detailed analysis using multiple oriental and western divination techniques specified in its new system prompt.
    - **Limitations:** The LINE bot currently collects only `name`, `birth date`, and `theme`. More advanced divination (e.g., precise astrological charts requiring birth time/place, detailed name analysis requiring font style specification) may have limitations or rely on general assumptions. The AI has been instructed to acknowledge these limitations where applicable in its responses.
    - The "General Diagnosis" plan (【一般診断】) from the provided AI persona is used by default for all requests. More complex plans (起・承・転・結) are not yet selectable by the user through the LINE interface.
    - The reference to `file-Sx1YARrbmt6KZEDkgkDTXM` (divination rule master) in the AI persona's prompt is simulated, as the current API setup cannot directly access external files. The AI is instructed to act as if it has internalized these rules based on the provided persona.