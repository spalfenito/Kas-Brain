# Sheets → Map Automation

Syncs a Google Sheet of locations + statuses to a live, interactive map using Google Apps Script and the Maps JavaScript API. When you update a status cell in the Sheet, the map reflects the change within 60 seconds.

## How It Works

```
Google Sheet (locations + status)
        │  installable onEdit trigger
        ▼
Google Apps Script (Code.gs)
        │  doGet() serves the web app
        ▼
MapView.html — Maps JavaScript API
  • Color-coded pins by status
  • Toggleable layers (mirrors Google My Maps layers)
  • Auto-refreshes every 60 seconds
```

## Sheet Column Layout

| Column | Field | Required |
|--------|-------|----------|
| A | Location name | Yes |
| B | Address / description | Recommended |
| C | Status (e.g. Active, Pending, Closed) | Yes |
| D | Layer name (e.g. "Phase 1", "North Region") | Optional |
| E | Latitude | Optional (geocoded from address if blank) |
| F | Longitude | Optional (geocoded from address if blank) |

Row 1 is the header row and is skipped automatically.

## One-Time Setup

### 1. Enable APIs in Google Cloud

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create or select a project
3. Enable **Maps JavaScript API** and **Geocoding API**
4. Under **Credentials** → **Create credentials** → **API key**
5. Restrict the key to your Apps Script web app URL (add after first deploy)

### 2. Add the API Key to Script Properties

1. In the Apps Script editor: **Project Settings** → **Script Properties**
2. Add property: `MAPS_API_KEY` = `<your API key>`

### 3. Migrate Existing Google My Maps Data (if applicable)

1. Find your My Maps ID from the URL:
   `https://www.google.com/maps/d/edit?mid=<MAP_ID>`
2. In the Apps Script editor, run:
   ```js
   importFromMyMaps('<MAP_ID>')
   ```
3. Check the Sheet — rows are appended with layer names and coordinates preserved

### 4. Deploy the Web App

1. **Extensions → Apps Script → Deploy → New deployment**
2. Type: **Web app**
3. Execute as: **Me**
4. Who has access: **Anyone** (or restrict as needed)
5. Click **Deploy** → copy the web app URL

### 5. Install the onEdit Trigger

Run once from the Apps Script editor:
```js
setupTrigger()
```

Check **Triggers** in the left panel to confirm it was created. Do not run `setupTrigger()` multiple times or you'll create duplicate triggers.

### 6. Share the Map URL

Distribute the web app URL from Step 4. Anyone with access can view the live map.

## Customizing Status Colors

Edit the `STATUS_COLORS` object in `Code.gs`:

```js
STATUS_COLORS: {
  'Your Status': '#HEX_COLOR',
  ...
},
DEFAULT_COLOR: '#4285F4',  // color for unrecognized statuses
```

The same status labels and colors are automatically reflected in the map legend.

## Customizing Column Positions

Edit the `CONFIG` object in `Code.gs` if your Sheet has different column order:

```js
COL_NAME:    1,  // column A = 1
COL_ADDRESS: 2,
COL_STATUS:  3,
COL_LAYER:   4,
COL_LAT:     5,
COL_LNG:     6,
```

## Viewing the Map

- Open the web app URL in any browser
- Use the **Layers** panel on the left to toggle location groups on/off
- Click any pin for name, status, layer, and address details
- The map auto-refreshes every 60 seconds, or click **Refresh** manually

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Map shows "Could not load API key" | Check `MAPS_API_KEY` in Script Properties |
| Pins not appearing | Check Apps Script Executions log for geocoding errors |
| Layers panel is empty | Verify Column D has layer names and re-deploy |
| Status colors not updating | Wait 60s or click Refresh; check Sheet column C matches `STATUS_COLORS` keys exactly |
| `importFromMyMaps` fails | Ensure the My Maps is publicly shared (View → Share → Anyone with link) |
