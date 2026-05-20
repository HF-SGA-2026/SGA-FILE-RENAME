# SGA FILE RENAME

This is the website version of SGA FILE RENAME. It runs as a local browser website using plain HTML, CSS, and JavaScript.

## Run the Website

Open `index.html` in a modern desktop browser.

For the best folder picker and ZIP download behavior, run a small local website server from this folder:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Website Flow

1. Drop the main folder into the upload area, or use **Choose Main Folder**.
2. Select the parent folders that should be processed.
3. Review the planned renames in Step 2. The table is capped after 13 visible rows and scrolls for the rest.
4. Click **Rename Files**.
5. Click **Download ZIP**.

## Vendor Libraries

The website expects these local files for full offline use:

```text
vendor/jszip.min.js
vendor/heic2any.min.js
```

If those files are missing, `index.html` falls back to CDN copies:

- JSZip: `https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js`
- heic2any: `https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js`

## Folder Rules

Expected structure:

```text
Main Folder/
  Parent Folder A/
    Kitchen/
      IMG_0012.heic
      IMG_0013.jpg
    Living Room/
      IMG_0014.png
  Parent Folder B/
    Bedroom/
      IMG_0015.jpg
```

The website does not rename:

- the main folder
- parent folders
- secondary parent folders

Only supported files inside secondary parent folders of selected parent folders are renamed.

## Renaming Rule

Files are renamed to:

```text
SecondaryParentFolderName_001.ext
SecondaryParentFolderName_002.ext
SecondaryParentFolderName_003.ext
```

Supported file types are common image files plus `.mov` and `.pdf`. HEIC and HEIF files in selected folders are converted to JPEG and use `.jpg`.

Unsupported files are copied unchanged so the folder structure remains intact. Hidden/system files such as `.DS_Store`, `Thumbs.db`, and `desktop.ini` are skipped.

## Large Folder Note

The website builds the ZIP in the browser. Very large folders can hit browser memory or download limits. A server-side version is better for very large folders.
