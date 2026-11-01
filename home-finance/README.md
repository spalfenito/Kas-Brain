# Home Finance

A private household finance dashboard that reads a Google Sheet live and runs on Cloudflare Workers.

- **Levers:** monthly take-home pay for each person, everyday spending, savings, the total paid toward cards each month, payoff strategy, and interest rates.
- **What it works out:** money left over each month, the debt-free date, total interest, interest and time saved compared with paying only the minimums, when each card gets paid off, and payoff time at different payment levels.
- **From the sheet:** bills by due date, card balances and 0% deals, savings, and auto charges.

No financial data lives in this repo. The Worker reads the sheet with a Google service account at request time and returns only the blocks the page uses (bills, cards, savings, the cash-flow block, paychecks, auto charges). Other cells on the tab are never sent to the browser.

Open `/?demo` to see the page with made-up numbers.

## How the sheet is read

From the tab named `the budget` (change it with `SHEET_TAB` in `wrangler.toml`), the Worker reads:

| Block | Found by |
|---|---|
| Bills | Rows with a date like `1-Nov` in column A, payee in B, amount in C |
| Cards | A header cell like `Name's cards`; the next four columns are balance, due date, minimum, notes |
| 0% deals | Card names like `… - no intrest Aug 2027`, `… on $7000`, `… 1 year starting Nov '26` |
| Paychecks | The cell `incoming`; the rows under it have a label to the left and an amount |
| Cash flow | Rows ending in the `what's left` row (`expense`, `save` set the lever defaults) |
| Savings | The rows under `deep savings` |
| Auto charges | The rows under `auto charges on cards` |

If you rename one of those labels, update `src/parse.js`.

## Setup (about 20 minutes)

### 1. Let the Worker read the sheet (Google Cloud)

1. Go to <https://console.cloud.google.com/>, create a project, and enable the **Google Sheets API** for it.
2. Go to **IAM & Admin → Service accounts → Create service account**. It needs no roles.
3. Open the service account, then go to **Keys → Add key → JSON**. A key file downloads. Keep it private and never commit it.
4. In the Google Sheet, click **Share** and add the service account's email (`…@….iam.gserviceaccount.com`) as a **Viewer**.

### 2. Deploy to Cloudflare

From this folder:

```bash
npm install
npx wrangler login
npx wrangler secret put SHEET_ID                      # the long id in the sheet's URL, between /d/ and /edit
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON < path/to/key.json
npm run deploy
```

Or deploy from GitHub: in the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository**. Pick this repo, set the **root directory** to `home-finance`, and keep the deploy command `npx wrangler deploy`. Then add the two secrets under the Worker's **Settings → Variables and Secrets**.

### Income (salaries stay out of the repo)

Set your income sources as a secret. They become the starting values for the Income levers:

```bash
npx wrangler secret put INCOME_SOURCES
```

Paste a JSON list like this when asked (example numbers):

```json
[
  {"key": "salary-1", "name": "Alex salary", "amount": 95000, "period": "year", "withhold": 24},
  {"key": "side-1", "name": "Alex side work", "amount": 1200, "period": "month", "withhold": 0},
  {"key": "salary-2", "name": "Jordan salary", "amount": 88000, "period": "year", "withhold": "standard"}
]
```

- `withhold` is either the percent taken out for taxes and insurance, or `"standard"`. Standard means 2026 federal withholding for a two-income household (Form W-4 Step 2 checked), plus Social Security and Medicare. It assumes no state income tax and no pre-tax deductions.
- Without this secret, the page uses the paycheck amounts under `incoming` on the sheet.
- When you change the secret, the new values replace any slider changes made earlier.

### People and colors

Each person gets a color across the page: their cards, incomes, and bills whose name includes their name or initials. Set it as a secret, so names stay out of the repo:

```bash
npx wrangler secret put PEOPLE
```

```json
[{"name": "Alex", "aliases": ["AB"], "color": "blue"}, {"name": "Jordan", "aliases": ["JD"], "color": "pink"}]
```

- Colors can be `blue`, `pink`, `teal`, `amber`, `purple`, or a hex code like `#2d6cc0`.
- `aliases` are other names to match, like initials on the sheet. An income can also name its person with `"owner"` in `INCOME_SOURCES`.
- Without this secret, card owners get colors in the order they appear on the sheet.

Money coming in or kept shows in green; money owed or going out shows in red.

### 3. Lock it down (do this before using it with real data)

This site shows real balances, so put it behind **Cloudflare Access**. It's free for up to 50 people.

1. In the Worker's **Settings → Domains & Routes**, turn on Cloudflare Access for the `workers.dev` route. Or open **Zero Trust → Access → Applications → Add an application → Self-hosted** for your custom domain.
2. Add a policy that allows only your two email addresses.
3. Optional, but recommended: copy the application's **Audience (AUD) tag** and your team domain. Then run:
   ```bash
   npx wrangler secret put ACCESS_TEAM_DOMAIN   # e.g. yourteam.cloudflareaccess.com
   npx wrangler secret put ACCESS_AUD
   ```
   With these set, the API checks the Access login on every request, so the data can't be fetched around Access.

### 4. Optional: share lever settings between both of you

Without this, each browser keeps its own incomes, APRs and slider positions. To share them:

```bash
npx wrangler kv namespace create SETTINGS
```

Paste the id it prints into the commented `[[kv_namespaces]]` block in `wrangler.toml`, uncomment the block, and deploy again.

## Local development

Create `.dev.vars` (it's git-ignored):

```
SHEET_ID=...
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
INCOME_SOURCES=[{"key":"salary-1","name":"...","amount":95000,"period":"year","withhold":24}]
PEOPLE=[{"name":"...","aliases":["AB"],"color":"blue"}]
```

Then run `npm run dev`. Run `npm test` for the parser and payoff-math tests.

## How the payoff math works

- Each card is split into the part charging interest and the part on a 0% deal.
- Every month: interest is added, each card's minimum is paid, and the rest of the monthly card budget goes where the strategy says. Minimums are the greater of the listed minimum, about 1% of the balance plus that month's interest, or $25.
  - **Smart:** pays enough on each 0% deal to clear it before the deal ends, then puts the rest on the highest rate.
  - **Highest rate:** all extra money to the highest rate first (avalanche).
  - **Smallest balance:** smallest balance first (snowball).
- Store cards like Best Buy are treated as deferred interest: if the deal ends with a balance left, all the skipped interest is charged back.
- The sheet has no interest rates. Cards use the default rate lever until you type each card's real APR in the payoff plan.
