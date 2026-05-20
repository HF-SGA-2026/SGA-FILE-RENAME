const SYSTEM_FILE_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const SUPPORTED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "heic", "heif", "mov", "pdf"]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);
const BATCH_SIZE = 12;
const LARGE_FOLDER_BYTES = 900 * 1024 * 1024;
const LARGE_FOLDER_FILES = 5000;
const PREVIEW_RENDER_LIMIT = 1000;

const state = {
  mainFolderName: "",
  allFiles: [],
  fileRecords: [],
  parentFolders: new Map(),
  selectedParents: new Set(),
  previewRows: [],
  failures: [],
  currentZipBlob: null,
  currentZipUrl: "",
  currentZipName: "",
  currentOutputPath: "",
  processing: false,
  metrics: {
    total: 0,
    completed: 0,
    heicCompleted: 0,
    startTime: 0
  }
};

const els = {
  dropZone: document.getElementById("dropZone"),
  chooseFolderButton: document.getElementById("chooseFolderButton"),
  folderInput: document.getElementById("folderInput"),
  clearButton: document.getElementById("clearButton"),
  selectAllButton: document.getElementById("selectAllButton"),
  deselectAllButton: document.getElementById("deselectAllButton"),
  renameButton: document.getElementById("renameButton"),
  downloadButton: document.getElementById("downloadButton"),
  clearLogButton: document.getElementById("clearLogButton"),
  parentList: document.getElementById("parentList"),
  folderSummary: document.getElementById("folderSummary"),
  previewBody: document.getElementById("previewBody"),
  previewCount: document.getElementById("previewCount"),
  messageLog: document.getElementById("messageLog"),
  statusText: document.getElementById("statusText"),
  percentText: document.getElementById("percentText"),
  progressBar: document.getElementById("progressBar"),
  totalFiles: document.getElementById("totalFiles"),
  completedFiles: document.getElementById("completedFiles"),
  remainingFiles: document.getElementById("remainingFiles"),
  elapsedTime: document.getElementById("elapsedTime"),
  etaTime: document.getElementById("etaTime"),
  filesPerSecond: document.getElementById("filesPerSecond"),
  heicSpeed: document.getElementById("heicSpeed"),
  zipInfo: document.getElementById("zipInfo"),
  libraryStatus: document.getElementById("libraryStatus")
};

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  updateLibraryStatus();
  resetUi();
});

function bindEvents() {
  els.chooseFolderButton.addEventListener("click", async event => {
    event.preventDefault();
    event.stopPropagation();
    if (state.processing) return;
    els.folderInput.value = "";
    els.folderInput.click();
  });

  els.folderInput.addEventListener("change", event => {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      addLog("Folder selection canceled.");
      return;
    }
    setStatus("Scanning folders...");
    addLog("Scanning selected folder...");
    loadFileList(files);
  });

  els.dropZone.addEventListener("dragover", event => {
    event.preventDefault();
    els.dropZone.classList.add("dragging");
  });

  els.dropZone.addEventListener("dragleave", () => {
    els.dropZone.classList.remove("dragging");
  });

  els.dropZone.addEventListener("drop", async event => {
    event.preventDefault();
    els.dropZone.classList.remove("dragging");
    setStatus("Scanning folders...");
    addLog("Scanning dropped folder...");
    const files = await filesFromDrop(event.dataTransfer);
    loadFileList(files);
  });

  els.clearButton.addEventListener("click", clearAll);
  els.selectAllButton.addEventListener("click", () => setAllParents(true));
  els.deselectAllButton.addEventListener("click", () => setAllParents(false));
  els.renameButton.addEventListener("click", processFolder);
  els.downloadButton.addEventListener("click", downloadZip);
  els.downloadButton.addEventListener("dragstart", event => {
    if (!state.currentZipBlob) return;
    const url = ensureZipObjectUrl();
    const fileName = state.currentZipName || "SGA FILE RENAME.zip";
    event.dataTransfer.setData("DownloadURL", `application/zip:${fileName}:${url}`);
    event.dataTransfer.setData("text/uri-list", url);
    event.dataTransfer.effectAllowed = "copy";
  });
  els.clearLogButton.addEventListener("click", () => {
    els.messageLog.innerHTML = "";
  });
}

function updateLibraryStatus() {
  const hasZip = Boolean(window.JSZip);
  const hasHeic = Boolean(window.heic2any);
  if (hasZip && hasHeic) {
    els.libraryStatus.textContent = "JSZIP AND HEIC CONVERTER READY";
    els.libraryStatus.className = "library-status ok";
  } else if (hasZip) {
    els.libraryStatus.textContent = "JSZIP READY; HEIC CONVERTER UNAVAILABLE";
    els.libraryStatus.className = "library-status warn";
  } else {
    els.libraryStatus.textContent = "JSZIP UNAVAILABLE";
    els.libraryStatus.className = "library-status warn";
  }
}

function loadFileList(files) {
  clearWorkingState();
  setStatus("Scanning folders...");

  const normalized = files
    .map(file => ({ file, path: normalizePath(file.webkitRelativePath || file.relativePath || file.name) }))
    .filter(item => item.path && !isSystemFile(item.path));

  if (!normalized.length) {
    addLog("No usable files were found. Choose the main folder itself, not a parent folder inside it.", "warn");
    resetUi();
    return;
  }

  const mainFolder = commonMainFolder(normalized.map(item => item.path));
  state.mainFolderName = mainFolder || "Updated Folder";
  state.allFiles = normalized;

  for (const item of normalized) {
    const parts = item.path.split("/").filter(Boolean);
    if (parts.length < 4) {
      continue;
    }

    const [main, parent, secondary] = parts;
    const fileName = parts[parts.length - 1];
    const extension = getExtension(fileName);
    const originalExtension = getOriginalExtension(fileName);
    const isSupported = SUPPORTED_EXTENSIONS.has(extension);
    const isHeic = HEIC_EXTENSIONS.has(extension);
    const record = {
      file: item.file,
      originalPath: item.path,
      main,
      parent,
      secondary,
      fileName,
      extension,
      originalExtension,
      isSupported,
      isHeic
    };

    state.fileRecords.push(record);

    if (!state.parentFolders.has(parent)) {
      state.parentFolders.set(parent, {
        name: parent,
        secondaryFolders: new Set(),
        supportedCount: 0,
        heicCount: 0
      });
    }

    const parentInfo = state.parentFolders.get(parent);
    parentInfo.secondaryFolders.add(secondary);
    if (isSupported) parentInfo.supportedCount += 1;
    if (isHeic) parentInfo.heicCount += 1;
  }

  if (!state.parentFolders.size) {
    addLog("No parent folders with secondary folders were found. Expected Main Folder / Parent Folder / Secondary Folder / files.", "warn");
  }

  state.selectedParents = new Set(state.parentFolders.keys());
  renderParentList();
  updatePreview();
  updateControls();

  const totalBytes = normalized.reduce((sum, item) => sum + (item.file.size || 0), 0);
  els.folderSummary.textContent = `${state.mainFolderName}: ${state.parentFolders.size} parent folders, ${state.fileRecords.length} files in secondary folders.`;
  setStatus("Finished");
  addLog(`Loaded "${state.mainFolderName}" with ${state.parentFolders.size} parent folders.`);

  if (totalBytes > LARGE_FOLDER_BYTES || normalized.length > LARGE_FOLDER_FILES) {
    addLog("This folder may be too large for browser memory or download limits. A server-side version is better for very large folders.", "warn");
  }
}

function renderParentList() {
  els.parentList.innerHTML = "";

  if (!state.parentFolders.size) {
    els.parentList.innerHTML = '<div class="empty-state">No parent folders detected.</div>';
    return;
  }

  for (const parent of [...state.parentFolders.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const id = `parent-${slug(parent.name)}`;
    const label = document.createElement("label");
    label.className = "parent-item";
    label.innerHTML = `
      <input type="checkbox" id="${id}" ${state.selectedParents.has(parent.name) ? "checked" : ""}>
      <span class="parent-name"></span>
      <span class="parent-meta">${parent.secondaryFolders.size} folders, ${parent.supportedCount} files</span>
    `;
    label.querySelector(".parent-name").textContent = parent.name;
    label.querySelector("input").addEventListener("change", event => {
      if (event.target.checked) {
        state.selectedParents.add(parent.name);
      } else {
        state.selectedParents.delete(parent.name);
      }
      state.currentZipBlob = null;
      revokeZipObjectUrl();
      state.currentOutputPath = "";
      els.downloadButton.disabled = true;
      els.downloadButton.draggable = false;
      els.zipInfo.textContent = "ZIP will be available after processing.";
      updatePreview();
      updateControls();
    });
    els.parentList.appendChild(label);
  }
}

function setAllParents(checked) {
  state.selectedParents = checked ? new Set(state.parentFolders.keys()) : new Set();
  state.currentZipBlob = null;
  revokeZipObjectUrl();
  state.currentOutputPath = "";
  renderParentList();
  updatePreview();
  updateControls();
  els.downloadButton.disabled = true;
  els.downloadButton.draggable = false;
  els.zipInfo.textContent = "ZIP will be available after processing.";
}

function updatePreview() {
  const selectedRecords = getSelectedSupportedRecords();
  const counters = new Map();
  state.previewRows = selectedRecords.map(record => {
    const key = `${record.parent}\u0000${record.secondary}`;
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);
    const newExt = record.isHeic ? "jpg" : record.originalExtension;
    const newFileName = `${record.secondary}_${String(next).padStart(3, "0")}.${newExt}`;
    const newPath = pathJoin(record.main, record.parent, record.secondary, newFileName);
    return { ...record, newFileName, newPath };
  });

  els.previewCount.textContent = `${state.previewRows.length} files`;
  els.totalFiles.textContent = state.previewRows.length;
  els.remainingFiles.textContent = state.previewRows.length;
  els.completedFiles.textContent = "0";
  els.filesPerSecond.textContent = "0.0";
  els.heicSpeed.textContent = "0.0";
  els.elapsedTime.textContent = "00:00";
  els.etaTime.textContent = "--:--";
  setProgress(0);

  if (!state.previewRows.length) {
    els.previewBody.innerHTML = '<tr><td colspan="4" class="empty-state">No selected supported files to rename.</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const row of state.previewRows.slice(0, PREVIEW_RENDER_LIMIT)) {
    const tr = document.createElement("tr");
    tr.append(
      cell(row.parent),
      cell(row.secondary),
      cell(row.fileName),
      cell(row.newFileName)
    );
    fragment.appendChild(tr);
  }

  els.previewBody.innerHTML = "";
  els.previewBody.appendChild(fragment);

  if (state.previewRows.length > PREVIEW_RENDER_LIMIT) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="4" class="empty-state">Preview limited to the first ${PREVIEW_RENDER_LIMIT} rows for speed. ${state.previewRows.length} files will be processed.</td>`;
    els.previewBody.appendChild(tr);
  }
}

async function processFolder() {
  updateLibraryStatus();

  if (!window.JSZip) {
    addLog("JSZip is not available. Open the website with internet access or add the local JSZip vendor file.", "error");
    return;
  }

  if (!state.previewRows.length) {
    addLog("Select at least one parent folder containing supported files.", "warn");
    return;
  }

  state.processing = true;
  state.failures = [];
  state.currentZipBlob = null;
  revokeZipObjectUrl();
  state.currentZipName = `${state.mainFolderName || "SGA FILE RENAME"}.zip`;
  state.currentOutputPath = "";
  state.metrics = {
    total: state.previewRows.length,
    completed: 0,
    heicCompleted: 0,
    startTime: performance.now()
  };

  els.renameButton.disabled = true;
  els.downloadButton.disabled = true;
  els.downloadButton.draggable = false;
  setStatus("Renaming files...");
  addLog("Renaming files and preparing ZIP...");
  updateMetrics();

  const zip = new JSZip();
  const renamedByOriginalPath = new Map(state.previewRows.map(row => [row.originalPath, row]));

  // Browser ZIP creation keeps the archive in memory. A server-side version is better for very large folders.
  try {
    for (let start = 0; start < state.allFiles.length; start += BATCH_SIZE) {
      const batch = state.allFiles.slice(start, start + BATCH_SIZE);
      await Promise.all(batch.map(item => addFileToZip(zip, item, renamedByOriginalPath)));
      updateMetrics();
      await yieldToBrowser();
    }

    setStatus("Creating ZIP...");
    addLog("Creating ZIP...");

    state.currentZipBlob = await zip.generateAsync(
      {
        type: "blob",
        compression: "STORE",
        streamFiles: true,
        platform: "UNIX"
      },
      metadata => {
        const zipPercent = Math.min(100, Math.round(metadata.percent || 0));
        els.zipInfo.textContent = `ZIP creation ${zipPercent}% complete`;
      }
    );

    setProgress(100);
    setStatus("Finished");
    updateMetrics(true);
    els.downloadButton.disabled = false;
    els.downloadButton.draggable = true;
    els.zipInfo.textContent = `ZIP ready: ${formatBytes(state.currentZipBlob.size)}`;
    addLog(`Finished. ZIP ready with ${state.failures.length} failed file${state.failures.length === 1 ? "" : "s"}. Use Download ZIP to save it.`);
  } catch (error) {
    addLog(`ZIP creation failed: ${error.message}`, "error");
    setStatus("Finished");
  } finally {
    state.processing = false;
    updateControls();
  }
}

async function addFileToZip(zip, item, renamedByOriginalPath) {
  if (isSystemFile(item.path)) return;

  const renameRow = renamedByOriginalPath.get(item.path);
  if (!renameRow) {
    zip.file(item.path, item.file, {
      binary: true,
      compression: "STORE",
      date: item.file.lastModified ? new Date(item.file.lastModified) : undefined
    });
    return;
  }

  try {
    let zipFile = renameRow.file;
    let status = "Renaming files...";

    if (renameRow.isHeic) {
      status = "Converting HEIC files...";
      setStatus(status);
      if (!window.heic2any) {
        throw new Error("HEIC converter is unavailable.");
      }
      const converted = await window.heic2any({
        blob: renameRow.file,
        toType: "image/jpeg",
        quality: 0.92
      });
      zipFile = Array.isArray(converted) ? converted[0] : converted;
      state.metrics.heicCompleted += 1;
    }

    zip.file(renameRow.newPath, zipFile, {
      binary: true,
      compression: "STORE",
      date: renameRow.file.lastModified ? new Date(renameRow.file.lastModified) : undefined
    });
  } catch (error) {
    state.failures.push({ path: item.path, message: error.message });
    addLog(`Failed: ${item.path} (${error.message})`, "error");
    zip.file(item.path, item.file, {
      binary: true,
      compression: "STORE",
      date: item.file.lastModified ? new Date(item.file.lastModified) : undefined
    });
  } finally {
    state.metrics.completed += 1;
    updateMetrics();
  }
}

function getSelectedSupportedRecords() {
  return state.fileRecords
    .filter(record => state.selectedParents.has(record.parent) && record.isSupported)
    .sort((a, b) => a.originalPath.localeCompare(b.originalPath, undefined, { numeric: true, sensitivity: "base" }));
}

async function downloadZip() {
  if (!state.currentZipBlob) {
    addLog("No ZIP is ready yet. Click Rename Files first.", "warn");
    return;
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: state.currentZipName || "SGA FILE RENAME.zip",
        types: [{
          description: "ZIP archive",
          accept: { "application/zip": [".zip"] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(state.currentZipBlob);
      await writable.close();
      addLog("ZIP saved to the location you chose.");
      return;
    } catch (error) {
      if (error.name === "AbortError") {
        addLog("Save canceled. Trying normal browser download instead.", "warn");
      } else {
        addLog(`Save dialog failed: ${error.message}. Trying normal browser download instead.`, "warn");
      }
    }
  }

  try {
    const url = ensureZipObjectUrl();
    const link = document.createElement("a");
    link.href = url;
    link.download = state.currentZipName || "SGA FILE RENAME.zip";
    link.style.display = "none";
    document.body.appendChild(link);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    link.remove();
    addLog("Download started.");
  } catch (error) {
    addLog(`Download could not start: ${error.message}. Open the website in a regular browser and try again.`, "error");
    setStatus("Finished");
  }
}

function updateControls() {
  const hasParents = state.parentFolders.size > 0;
  els.selectAllButton.disabled = !hasParents || state.processing;
  els.deselectAllButton.disabled = !hasParents || state.processing;
  els.renameButton.disabled = state.processing || !state.previewRows.length;
  els.downloadButton.disabled = state.processing || !state.currentZipBlob;
  els.downloadButton.draggable = !els.downloadButton.disabled;
  els.renameButton.textContent = "Rename Files";
  els.downloadButton.textContent = "Download ZIP";
}

function updateMetrics(done = false) {
  const elapsedSeconds = Math.max(0.001, (performance.now() - state.metrics.startTime) / 1000);
  const completed = state.metrics.completed;
  const remaining = Math.max(0, state.metrics.total - completed);
  const perSecond = completed / elapsedSeconds;
  const heicPerSecond = state.metrics.heicCompleted / elapsedSeconds;
  const etaSeconds = perSecond > 0 ? remaining / perSecond : 0;

  els.totalFiles.textContent = state.metrics.total;
  els.completedFiles.textContent = completed;
  els.remainingFiles.textContent = remaining;
  els.elapsedTime.textContent = formatDuration(elapsedSeconds);
  els.etaTime.textContent = done ? "00:00" : (completed ? formatDuration(etaSeconds) : "--:--");
  els.filesPerSecond.textContent = perSecond.toFixed(1);
  els.heicSpeed.textContent = heicPerSecond.toFixed(1);
  setProgress(state.metrics.total ? (completed / state.metrics.total) * 100 : 0);
}

function setProgress(percent) {
  const safe = Math.max(0, Math.min(100, percent));
  els.progressBar.style.width = `${safe}%`;
  els.percentText.textContent = `${Math.round(safe)}%`;
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function addLog(message, type = "info") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  entry.innerHTML = `<span class="log-time">${time}</span>`;
  entry.append(document.createTextNode(message));
  els.messageLog.prepend(entry);
}

function clearAll() {
  els.folderInput.value = "";
  clearWorkingState();
  resetUi();
  addLog("Cleared current folder.");
}

function clearWorkingState() {
  state.mainFolderName = "";
  state.allFiles = [];
  state.fileRecords = [];
  state.parentFolders = new Map();
  state.selectedParents = new Set();
  state.previewRows = [];
  state.failures = [];
  state.currentZipBlob = null;
  revokeZipObjectUrl();
  state.currentZipName = "";
  state.currentOutputPath = "";
  state.processing = false;
}

function resetUi() {
  els.parentList.innerHTML = "";
  els.folderSummary.textContent = "No folder loaded.";
  els.previewBody.innerHTML = '<tr><td colspan="4" class="empty-state">Load a folder to preview renames.</td></tr>';
  els.previewCount.textContent = "0 files";
  els.zipInfo.textContent = "ZIP will be available after processing.";
  setStatus("Waiting for a folder.");
  setProgress(0);
  els.totalFiles.textContent = "0";
  els.completedFiles.textContent = "0";
  els.remainingFiles.textContent = "0";
  els.elapsedTime.textContent = "00:00";
  els.etaTime.textContent = "--:--";
  els.filesPerSecond.textContent = "0.0";
  els.heicSpeed.textContent = "0.0";
  els.downloadButton.disabled = true;
  els.downloadButton.draggable = false;
  els.renameButton.textContent = "Rename Files";
  els.downloadButton.textContent = "Download ZIP";
  updateControls();
}

function ensureZipObjectUrl() {
  if (!state.currentZipUrl && state.currentZipBlob) {
    state.currentZipUrl = URL.createObjectURL(state.currentZipBlob);
  }
  return state.currentZipUrl;
}

function revokeZipObjectUrl() {
  if (state.currentZipUrl) {
    URL.revokeObjectURL(state.currentZipUrl);
    state.currentZipUrl = "";
  }
}

async function filesFromDrop(dataTransfer) {
  const items = Array.from(dataTransfer.items || []);
  const entries = items
    .map(item => item.webkitGetAsEntry ? item.webkitGetAsEntry() : null)
    .filter(Boolean);

  if (entries.length) {
    const files = [];
    for (const entry of entries) {
      await readEntry(entry, "", files);
    }
    return files;
  }

  return Array.from(dataTransfer.files || []);
}

function readEntry(entry, prefix, files) {
  return new Promise(resolve => {
    if (entry.isFile) {
      entry.file(file => {
        file.relativePath = normalizePath(`${prefix}${file.name}`);
        files.push(file);
        resolve();
      }, () => resolve());
      return;
    }

    if (entry.isDirectory) {
      const reader = entry.createReader();
      const directoryPrefix = `${prefix}${entry.name}/`;
      const readBatch = () => {
        reader.readEntries(async entries => {
          if (!entries.length) {
            resolve();
            return;
          }
          for (const child of entries) {
            await readEntry(child, directoryPrefix, files);
          }
          readBatch();
        }, () => resolve());
      };
      readBatch();
      return;
    }

    resolve();
  });
}

function commonMainFolder(paths) {
  const first = paths[0]?.split("/").filter(Boolean)[0];
  return first || "";
}

function isSystemFile(path) {
  const name = path.split("/").pop().toLowerCase();
  return SYSTEM_FILE_NAMES.has(name) || name.startsWith("._");
}

function getExtension(fileName) {
  const last = fileName.split(".").pop();
  return last && last !== fileName ? last.toLowerCase() : "";
}

function getOriginalExtension(fileName) {
  const last = fileName.split(".").pop();
  return last && last !== fileName ? last : "";
}

function normalizePath(path) {
  return String(path || "").replaceAll("\\", "/").replace(/^\/+/, "");
}

function pathJoin(...parts) {
  return parts.map(part => String(part).replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
}

function slug(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "-");
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}
