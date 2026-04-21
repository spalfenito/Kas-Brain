// ─── Configuration ───────────────────────────────────────────────────────────
// Edit these values to match your spreadsheet layout.
const CONFIG = {
  SPREADSHEET_ID: '',   // leave blank when script is bound to the spreadsheet
  SHEET_NAME: 'Sheet1',
  HEADER_ROWS: 1,
  COL_NAME:    1,  // A
  COL_ADDRESS: 2,  // B
  COL_STATUS:  3,  // C
  COL_LAYER:   4,  // D — layer/group name (mirrors My Maps layers)
  COL_LAT:     5,  // E
  COL_LNG:     6,  // F

  STATUS_COLORS: {
    'Active':      '#34A853',
    'Approved':    '#34A853',
    'Complete':    '#34A853',
    'Pending':     '#FBBC04',
    'In Progress': '#FBBC04',
    'Review':      '#FBBC04',
    'Closed':      '#EA4335',
    'Rejected':    '#EA4335',
    'Inactive':    '#EA4335',
  },
  DEFAULT_COLOR: '#4285F4',
};

// ─── Web App Entry Point ──────────────────────────────────────────────────────
function doGet(e) {
  return HtmlService.createTemplateFromFile('MapView')
    .evaluate()
    .setTitle('Location Map')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ─── Data Access ──────────────────────────────────────────────────────────────
/**
 * Returns all location rows from the Sheet as JSON-serializable objects.
 * Called from MapView.html via google.script.run.
 */
function getLocations() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= CONFIG.HEADER_ROWS) return [];

  const data = sheet.getRange(CONFIG.HEADER_ROWS + 1, 1, lastRow - CONFIG.HEADER_ROWS, 6).getValues();
  const geocoder = Maps.newGeocoder();
  const locations = [];

  for (const row of data) {
    const name    = String(row[CONFIG.COL_NAME    - 1] || '').trim();
    const address = String(row[CONFIG.COL_ADDRESS - 1] || '').trim();
    const status  = String(row[CONFIG.COL_STATUS  - 1] || '').trim();
    const layer   = String(row[CONFIG.COL_LAYER   - 1] || '').trim() || 'Ungrouped';
    let   lat     = parseFloat(row[CONFIG.COL_LAT - 1]);
    let   lng     = parseFloat(row[CONFIG.COL_LNG - 1]);

    if (!name) continue;

    // Geocode rows that are missing coordinates
    if ((isNaN(lat) || isNaN(lng)) && address) {
      try {
        const result = geocoder.geocode(address);
        if (result.status === 'OK' && result.results.length > 0) {
          const loc = result.results[0].geometry.location;
          lat = loc.lat;
          lng = loc.lng;
        }
      } catch (err) {
        Logger.log('Geocode failed for "%s": %s', address, err.message);
        continue;
      }
    }

    if (isNaN(lat) || isNaN(lng)) continue;

    locations.push({
      name,
      address,
      status,
      layer,
      lat,
      lng,
      color: CONFIG.STATUS_COLORS[status] || CONFIG.DEFAULT_COLOR,
    });
  }

  return locations;
}

function getApiKey() {
  return PropertiesService.getScriptProperties().getProperty('MAPS_API_KEY') || '';
}

// ─── Trigger Management ───────────────────────────────────────────────────────
/**
 * Run this once from the Apps Script editor to install the onEdit trigger.
 * Do not run it multiple times — check Triggers panel first.
 */
function setupTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger('onSheetEdit')
    .forSpreadsheet(ss)
    .onEdit()
    .create();
  Logger.log('Trigger installed. Map will reflect Sheet changes within 60 seconds.');
}

/**
 * Installable onEdit handler. The map auto-polls for fresh data, so this
 * handler only needs to log the event. Add notifications or side-effects here.
 */
function onSheetEdit(e) {
  const range = e.range;
  Logger.log(
    'Edit detected — sheet: %s, row: %s, col: %s, new value: %s',
    range.getSheet().getName(),
    range.getRow(),
    range.getColumn(),
    e.value
  );
}

// ─── Migration ────────────────────────────────────────────────────────────────
/**
 * One-time import from an existing Google My Maps.
 *
 * How to run:
 *   1. Open the My Maps, copy the map ID from the URL:
 *      https://www.google.com/maps/d/edit?mid=<MAP_ID>
 *   2. In the Apps Script editor, call: importFromMyMaps('<MAP_ID>')
 *   3. Check the Sheet — rows will be appended with layer and coordinate data.
 *
 * @param {string} myMapsId  The map ID from the My Maps URL.
 */
function importFromMyMaps(myMapsId) {
  const kmlUrl = 'https://www.google.com/maps/d/kml?mid=' + myMapsId;
  const response = UrlFetchApp.fetch(kmlUrl);
  const kmlText  = response.getContentText();
  const doc      = XmlService.parse(kmlText);
  const root     = doc.getRootElement();
  const ns       = root.getNamespace();

  const sheet    = getSheet_();
  const rows     = [];

  // KML layers are represented as <Folder> elements inside <Document>
  const document = root.getChild('Document', ns);
  if (!document) throw new Error('No <Document> found in KML.');

  const folders = document.getChildren('Folder', ns);

  // Handle both layered maps (Folders) and flat maps (Placemarks at root)
  const groups = folders.length > 0
    ? folders.map(f => ({
        name: getChildText_(f, 'name', ns),
        placemarks: f.getChildren('Placemark', ns),
      }))
    : [{ name: 'Ungrouped', placemarks: document.getChildren('Placemark', ns) }];

  for (const group of groups) {
    for (const pm of group.placemarks) {
      const name = getChildText_(pm, 'name', ns);
      const desc = getChildText_(pm, 'description', ns).replace(/<[^>]*>/g, '').trim();

      let lat = '', lng = '';
      const pointEl = pm.getChild('Point', ns);
      if (pointEl) {
        const coordText = getChildText_(pointEl, 'coordinates', ns).trim();
        const parts = coordText.split(',');
        if (parts.length >= 2) {
          lng = parseFloat(parts[0]);
          lat = parseFloat(parts[1]);
        }
      }

      if (!name || lat === '' || lng === '') continue;

      rows.push([name, desc, 'Active', group.name, lat, lng]);
    }
  }

  if (rows.length === 0) {
    Logger.log('No placemarks found in map %s.', myMapsId);
    return;
  }

  // Ensure header row exists
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Name', 'Address / Description', 'Status', 'Layer', 'Lat', 'Lng']);
  }

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  Logger.log('Imported %s locations from My Maps into the Sheet.', rows.length);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSheet_() {
  const ss = CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(CONFIG.SHEET_NAME) || ss.getSheets()[0];
}

function getChildText_(element, childName, ns) {
  const child = element.getChild(childName, ns);
  return child ? child.getText() : '';
}
