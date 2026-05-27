# SGA File Nexus

This is the website version of SGA File Nexus. It runs as a local browser website using plain HTML, CSS, and JavaScript.

## Run the Website

Open `index.html` in a modern desktop browser.

For the best folder picker, deletion permissions, and report downloads, run a small local website server from this folder:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Website Flow

1. Drop the main folder into the upload area, or use **Choose Main Folder**.
2. Select the parent folders that should be scanned.
3. Review backed-up files in Step 2. Use search, sorting, duplicate-type filters, and collapsible groups to focus large review lists.
4. Select the flagged files you want to discard.
5. Click **Move to Discarded**, confirm the action, then undo briefly or restore discarded files during the session.
6. Download the deletion report.

## Browser Permissions

Deletion requires browser folder-handle permission. If files are added with drag-and-drop or a fallback file picker, the website can still scan and report, but the browser may block direct deletion and mark those files as skipped in the report.

## Folder Rules

Recommended structure:

```text
Main Folder/
  Parent Folder A/
    Kitchen/
      IMG_0012.jpg
      IMG_0013.jpg
    Living Room/
      IMG_0014.png
  Parent Folder B/
    Bedroom/
      IMG_0015.jpg
```

The website does not alter:

- the main folder
- parent folders
- secondary parent folders

Files at the project root, one folder deep, or inside secondary folders are scanned. System files such as `.DS_Store`, `Thumbs.db`, `desktop.ini`, and `._` files are skipped.

Supported project formats include images (`.jpg`, `.jpeg`, `.png`, `.heic`, `.tif`, `.tiff`, `.webp`), documents (`.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`), CAD/design files (`.3dm`, `.dwg`, `.dxf`, `.skp`, `.rvt`, `.obj`, `.fbx`), and videos (`.mov`, `.mp4`). Other file types are still scanned and can appear in duplicate or backed-up review results.

## Backed-Up File Rules

Files are flagged when their names include backup or duplicate signals such as:

```text
copy
backup
back up
duplicate
old
final copy
revised copy
filename - copy
filename_copy
filename_backup
filename_old
(1), (2), (3)
```

The scanner also compares file sizes, modified dates, exact filenames across folders, and files with the same base name and extension within related folders. Similar files are grouped together in the review list, and the newest version is recommended to keep unless you choose otherwise.

## Safety

Files are never deleted automatically or permanently. The app shows a confirmation modal with the selected file count and total storage size, then moves selected files into a temporary Discarded state. You can undo the latest discard briefly or restore all discarded files during the session. Folders are never deleted.

After files are discarded, the app creates a downloadable CSV report with the scan date/time, parent folders scanned, files flagged, files moved to discarded, files still active, and errors encountered.
