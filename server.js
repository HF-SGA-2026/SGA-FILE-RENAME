const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const PORT = Number(process.env.PORT || 3000);
const WEB_ROOT = path.join(__dirname, "website-deploy");
const REVIEW_BIN = "Review_Bin";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

const session = {
  rootPath: "",
  movedFiles: new Map()
};

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : {};
}

function chooseFolderWithWindowsDialog() {
  return new Promise((resolve, reject) => {
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dialog.Description = 'Choose the same project folder you scanned so SGA File Nexus can move selected files to Review_Bin safely.'",
      "$dialog.ShowNewFolderButton = $false",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }"
    ].join("; ");

    execFile("powershell.exe", ["-NoProfile", "-STA", "-Command", script], { windowsHide: false }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message || "Folder picker could not be opened."));
        return;
      }
      const selected = stdout.trim();
      if (!selected) {
        reject(new Error("Folder selection was cancelled."));
        return;
      }
      resolve(selected);
    });
  });
}

function sendFileToRecycleBin(filePath) {
  return new Promise((resolve, reject) => {
    const filePath64 = Buffer.from(filePath, "utf8").toString("base64");
    const script = [
      `$target = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${filePath64}'))`,
      "Add-Type -AssemblyName Microsoft.VisualBasic",
      "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($args[0], [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)"
    ].join("; ");
    const encoded = Buffer.from(script.replace("$args[0]", "$target"), "utf16le").toString("base64");

    execFile("powershell.exe", ["-NoProfile", "-EncodedCommand", encoded], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message || "File could not be moved to Recycle Bin."));
        return;
      }
      resolve();
    });
  });
}

function normalizeRoot(rootPath) {
  if (typeof rootPath !== "string" || !rootPath.trim()) {
    throw new Error("A root folder path is required.");
  }
  const resolved = path.resolve(rootPath.trim());
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error("Root folder does not exist or is not a folder.");
  }
  return resolved;
}

function assertRootConfigured() {
  if (!session.rootPath) throw new Error("No selected root folder is configured.");
}

function safeRelativePath(inputPath) {
  if (typeof inputPath !== "string" || !inputPath.trim()) {
    throw new Error("File path is required.");
  }
  const clean = inputPath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (/^[a-zA-Z]:/.test(clean) || clean.startsWith("//")) {
    throw new Error("Absolute browser-supplied paths are not accepted.");
  }
  const parts = clean.split("/").filter(Boolean);
  if (!parts.length || parts.includes("..")) {
    throw new Error("Unsafe file path rejected.");
  }
  if (parts.includes(REVIEW_BIN)) {
    throw new Error("Review_Bin paths are managed by the server.");
  }
  const rootName = path.basename(session.rootPath).toLowerCase();
  if (parts[0] && parts[0].toLowerCase() === rootName) {
    parts.shift();
  }
  if (!parts.length) {
    throw new Error("File path points to the selected root folder, not a file.");
  }
  return parts.join(path.sep);
}

function sourcePathFor(relativePath) {
  assertRootConfigured();
  const resolved = path.resolve(session.rootPath, safeRelativePath(relativePath));
  assertInsideRoot(resolved);
  return resolved;
}

function reviewBinPathFor(relativePath) {
  assertRootConfigured();
  const resolved = path.resolve(session.rootPath, REVIEW_BIN, safeRelativePath(relativePath));
  assertInsideRoot(resolved);
  return resolved;
}

function assertInsideRoot(candidate) {
  const rootWithSep = session.rootPath.endsWith(path.sep) ? session.rootPath : `${session.rootPath}${path.sep}`;
  if (candidate !== session.rootPath && !candidate.startsWith(rootWithSep)) {
    throw new Error("Path outside the selected root folder was rejected.");
  }
}

function uniqueDestination(destination) {
  if (!fs.existsSync(destination)) return destination;
  const dir = path.dirname(destination);
  const ext = path.extname(destination);
  const base = path.basename(destination, ext);
  let index = 2;
  let candidate = path.join(dir, `${base}_${index}${ext}`);
  while (fs.existsSync(candidate)) {
    index += 1;
    candidate = path.join(dir, `${base}_${index}${ext}`);
  }
  return candidate;
}

async function moveOneToReviewBin(relativePath) {
  const source = sourcePathFor(relativePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error("Source file does not exist.");
  }
  const destination = uniqueDestination(reviewBinPathFor(relativePath));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await fs.promises.rename(source, destination);
  session.movedFiles.set(safeRelativePath(relativePath), destination);
  log(`Moved to Review_Bin: ${source} -> ${destination}`);
  return destination;
}

async function recoverOneFromReviewBin(relativePath) {
  const key = safeRelativePath(relativePath);
  const source = sourcePathFor(relativePath);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error("Source file does not exist");
  }
  const destination = uniqueDestination(sourcePathFor(relativePath));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  await fs.promises.rename(source, destination);
  session.movedFiles.delete(key);
  log(`Recovered from Review_Bin: ${source} -> ${destination}`);
  return destination;
}

async function recycleOneFromReviewBin(relativePath) {
  const key = safeRelativePath(relativePath);
  const source = sourcePathFor(relativePath);

  assertInsideRoot(path.resolve(source));

  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error ("Source file does not exist.");
  }

  await sendFileToRecycleBin(source);

  session.movedFiles.delete(key);
  log(`Moved original file to Recycle Bin: ${source}`);

  return source;
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(res, 200, {
        ok: true,
        rootPath: session.rootPath,
        reviewBin: session.rootPath ? path.join(session.rootPath, REVIEW_BIN) : ""
      });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    const body = await readJson(req);

    if (url.pathname === "/api/select-folder") {
      session.rootPath = normalizeRoot(body.rootPath);
      session.movedFiles = new Map();
      log(`Selected root folder: ${session.rootPath}`);
      sendJson(res, 200, { ok: true, rootPath: session.rootPath });
      return;
    }

    if (url.pathname === "/api/choose-folder") {
      const selectedPath = await chooseFolderWithWindowsDialog();
      session.rootPath = normalizeRoot(selectedPath);
      session.movedFiles = new Map();
      log(`Selected root folder from picker: ${session.rootPath}`);
      sendJson(res, 200, { ok: true, rootPath: session.rootPath });
      return;
    }

    if (url.pathname === "/api/move-to-review-bin") {
      assertRootConfigured();
      const files = Array.isArray(body.files) ? body.files : [];
      const results = [];
      for (const filePath of files) {
        try {
          const movedTo = await moveOneToReviewBin(filePath);
          results.push({ ok: true, path: filePath, movedTo });
        } catch (error) {
          results.push({ ok: false, path: filePath, error: error.message });
          log(`Move failed for ${filePath}: ${error.message}`);
        }
      }
      sendJson(res, 200, { ok: true, results });
      return;
    }

    if (url.pathname === "/api/recover-from-review-bin") {
      assertRootConfigured();
      const files = Array.isArray(body.files) ? body.files : [];
      const results = [];
      for (const filePath of files) {
        try {
          const recoveredTo = await recoverOneFromReviewBin(filePath);
          results.push({ ok: true, path: filePath, recoveredTo });
        } catch (error) {
          results.push({ ok: false, path: filePath, error: error.message });
          log(`Recover failed for ${filePath}: ${error.message}`);
        }
      }
      sendJson(res, 200, { ok: true, results });
      return;
    }

    if (url.pathname === "/api/delete-permanently") {
      assertRootConfigured();
      const files = Array.isArray(body.files) ? body.files : [];
      const results = [];
      for (const filePath of files) {
        try {
          const recycledFrom = await recycleOneFromReviewBin(filePath);
          results.push({ ok: true, path: filePath, recycledFrom });
        } catch (error) {
          results.push({ ok: false, path: filePath, error: error.message });
          log(`Recycle failed for ${filePath}: ${error.message}`);
        }
      }
      sendJson(res, 200, { ok: true, results });
      return;
    }

    sendJson(res, 404, { ok: false, error: "API endpoint not found." });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message });
  }
}

function serveStatic(req, res, url) {
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const resolved = path.resolve(WEB_ROOT, `.${requested}`);
  const webRootWithSep = WEB_ROOT.endsWith(path.sep) ? WEB_ROOT : `${WEB_ROOT}${path.sep}`;
  if (resolved !== WEB_ROOT && !resolved.startsWith(webRootWithSep)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      sendText(res, error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(resolved).toLowerCase()] || "application/octet-stream"
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url);
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  log(`SGA File Nexus local server running at http://localhost:${PORT}`);
  log("Review_Bin moves are the safe default; delete action sends Review_Bin files to the OS Recycle Bin.");
});

// Future firm-server integration:
// Replace moveOneToReviewBin/recoverOneFromReviewBin with an adapter that talks to
// the firm's shared-drive or document-management service, while preserving the
// same path validation and per-file result contract used by the frontend.
