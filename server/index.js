const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execFile, execSync, spawn } = require('child_process');

const app = express();
const PORT = 4000;

// Directories
const UPLOAD_DIR = path.join(__dirname, '..', 'uploaded_documents');
const WORKFLOWS_DIR = path.join(__dirname, '..', 'saved_workflows');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(WORKFLOWS_DIR)) fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });

// Scope subdirectories
const SCOPE_DIRS = {
    personal: path.join(UPLOAD_DIR, 'Personal'),
    team: path.join(UPLOAD_DIR, 'Teams'),
    global: path.join(UPLOAD_DIR, 'Global'),
};
Object.values(SCOPE_DIRS).forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Map scope name to its directory
function scopeDir(scope) {
    return SCOPE_DIRS[scope] || SCOPE_DIRS.personal;
}

// PostgreSQL path for psql commands
const PG_BIN = '/opt/homebrew/opt/postgresql@16/bin';
const PSQL = path.join(PG_BIN, 'psql');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Multer config — save to uploaded_documents/ (preserves folder structure)
const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
        const scope = req.query.scope || 'personal';
        const relativePath = req.query.relativePath || '';
        const dir = scopeDir(scope);

        // If relativePath contains subdirectories, create them
        if (relativePath) {
            const subDir = path.join(dir, path.dirname(relativePath));
            fs.mkdirSync(subDir, { recursive: true });
            cb(null, subDir);
        } else {
            cb(null, dir);
        }
    },
    filename: (req, file, cb) => {
        const scope = req.query.scope || 'personal';
        const relativePath = req.query.relativePath || '';
        const dir = scopeDir(scope);

        // Use just the filename, not the full relative path
        const fileName = relativePath ? path.basename(relativePath) : file.originalname;
        const destDir = relativePath ? path.join(dir, path.dirname(relativePath)) : dir;
        const target = path.join(destDir, fileName);

        if (fs.existsSync(target)) {
            const ext = path.extname(fileName);
            const base = path.basename(fileName, ext);
            cb(null, `${base}_${Date.now()}${ext}`);
        } else {
            cb(null, fileName);
        }
    },
});

const upload = multer({
    storage,
    fileFilter: (_req, file, cb) => {
        const allowed = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ];
        cb(null, allowed.includes(file.mimetype));
    },
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
});

// ─── Helper: get vectorized filenames from PostgreSQL ────

function getVectorizedFiles() {
    try {
        const result = execSync(
            `${PSQL} -d vectordb -t -A -c "SELECT DISTINCT filename FROM document_vectors;"`,
            { encoding: 'utf-8', timeout: 5000 }
        );
        return new Set(result.trim().split('\n').filter(Boolean));
    } catch {
        // DB may not exist yet or table not created
        return new Set();
    }
}

// ─── Document Upload Routes ──────────────────────────────

// Upload a single file (accepts ?scope=personal|team|global)
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No valid file provided' });
    }
    const scope = req.query.scope || 'personal';
    console.log(`✓ Uploaded: ${req.file.originalname} → ${scope}/${req.file.filename}`);
    res.json({
        message: 'File uploaded successfully',
        file: {
            name: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size,
            path: req.file.path,
            scope,
        },
    });
});

// List uploaded files with vectorization status, grouped by scope
// Now recursively scans subdirectories and returns relativePath
app.get('/api/files', (req, res) => {
    const vectorized = getVectorizedFiles();
    const requestedScope = req.query.scope; // optional: filter to one scope

    const result = {};
    const allFiles = [];

    // Recursively scan a directory and return file info
    function scanDir(baseDir, currentDir, scope) {
        if (!fs.existsSync(currentDir)) return [];
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        const files = [];
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                files.push(...scanDir(baseDir, fullPath, scope));
            } else {
                const stat = fs.statSync(fullPath);
                const relativePath = path.relative(baseDir, fullPath);
                files.push({
                    name: entry.name,
                    relativePath,  // e.g. "docs/aws/ec2.pdf" or just "file.pdf"
                    size: stat.size,
                    uploadedAt: stat.mtime.toISOString(),
                    status: vectorized.has(entry.name) ? 'vectorized' : 'uploaded',
                    scope,
                });
            }
        }
        return files;
    }

    for (const [scope, dir] of Object.entries(SCOPE_DIRS)) {
        if (requestedScope && requestedScope !== scope) continue;
        const files = scanDir(dir, dir, scope);
        for (const f of files) allFiles.push(f);
        result[scope] = files;
    }

    res.json({ files: allFiles, byScope: result });
});

// Delete a file (searches across all scope subdirectories, also removes vectors from DB)
app.delete('/api/files/:name', (req, res) => {
    const fileName = req.params.name;
    const scope = req.query.scope; // optional: hint which scope to look in
    const relativePath = req.query.relativePath; // optional: exact relative path

    let filePath = null;

    // If relativePath is provided, use it directly
    if (relativePath && scope && SCOPE_DIRS[scope]) {
        const candidate = path.join(SCOPE_DIRS[scope], relativePath);
        if (fs.existsSync(candidate)) filePath = candidate;
    }

    if (!filePath && scope && SCOPE_DIRS[scope]) {
        const candidate = path.join(SCOPE_DIRS[scope], fileName);
        if (fs.existsSync(candidate)) filePath = candidate;
    }
    // Fallback: search all scopes
    if (!filePath) {
        for (const dir of Object.values(SCOPE_DIRS)) {
            const candidate = path.join(dir, fileName);
            if (fs.existsSync(candidate)) { filePath = candidate; break; }
        }
    }
    // Legacy: check root upload dir
    if (!filePath) {
        const candidate = path.join(UPLOAD_DIR, fileName);
        if (fs.existsSync(candidate)) filePath = candidate;
    }

    if (!filePath) {
        return res.status(404).json({ error: 'File not found' });
    }

    fs.unlinkSync(filePath);

    // Clean up empty parent directories (but not the scope root)
    const parentDir = path.dirname(filePath);
    const scopeRoot = (scope && SCOPE_DIRS[scope]) || UPLOAD_DIR;
    if (parentDir !== scopeRoot) {
        try {
            let dir = parentDir;
            while (dir !== scopeRoot && dir.startsWith(scopeRoot)) {
                const entries = fs.readdirSync(dir);
                if (entries.length === 0) {
                    fs.rmdirSync(dir);
                    dir = path.dirname(dir);
                } else break;
            }
        } catch { /* ignore */ }
    }

    // Also clean up vectors from DB
    try {
        const safeName = fileName.replace(/'/g, "''");
        execSync(
            `${PSQL} -d vectordb -c "DELETE FROM document_vectors WHERE filename = '${safeName}'"`,
            { encoding: 'utf-8', timeout: 5000 }
        );
    } catch {
        // Ignore if DB not available
    }
    console.log(`\u2717 Deleted: ${relativePath || fileName}`);
    res.json({ message: 'File deleted' });
});

// ─── Vectorization with progress tracking ────────────────

// In-memory job tracker
const vectorizeJobs = new Map();

// Start vectorization (returns immediately with a job ID)
app.post('/api/vectorize', (req, res) => {
    const { files, scope } = req.body;
    const scriptPath = path.join(__dirname, '..', 'scripts', 'vectorize.py');
    const pythonBin = path.join(__dirname, '..', 'venv', 'bin', 'python3');
    const targetDir = scope ? scopeDir(scope) : UPLOAD_DIR;

    // Determine which files to process
    let fileList = files || [];
    if (fileList.length === 0) {
        try {
            fileList = fs.readdirSync(targetDir).filter((f) => {
                const ext = path.extname(f).toLowerCase();
                return [
                    '.pdf', '.docx', '.doc', '.pptx', '.xlsx', '.xls',
                    '.csv', '.html', '.htm', '.md', '.png', '.jpg', '.jpeg',
                ].includes(ext);
            });
        } catch {
            fileList = [];
        }
    }

    if (fileList.length === 0) {
        return res.json({ message: 'No files to vectorize', jobId: null });
    }

    const jobId = `vec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job = {
        status: 'running',
        total: fileList.length,
        completed: 0,
        currentFile: fileList[0],
        results: [],
        error: null,
        startedAt: new Date().toISOString(),
    };
    vectorizeJobs.set(jobId, job);

    console.log(`⚡ Vectorize job ${jobId}: ${fileList.length} file(s) from ${scope || 'all scopes'}`);

    // Respond immediately with the job ID
    res.json({ message: 'Vectorization started', jobId, total: fileList.length });

    // Spawn ONE Python process for ALL files (model loaded once)
    const args = [scriptPath, '--dir', targetDir, '--files', ...fileList];
    const env = {
        ...process.env,
        PATH: `${PG_BIN}:${process.env.PATH}`,
    };

    const proc = spawn(pythonBin, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 3600_000,  // 1 hour total
    });

    // Parse JSON progress events from stdout line-by-line
    let buffer = '';
    proc.stdout.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();  // keep incomplete last line in buffer

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const evt = JSON.parse(line);
                switch (evt.event) {
                    case 'file_start':
                        job.currentFile = evt.file;
                        job.completed = evt.index;
                        console.log(`  [${evt.index + 1}/${evt.total}] Processing: ${evt.file}`);
                        break;
                    case 'file_done':
                        job.results.push({ file: evt.file, status: 'success', chunks: evt.chunks, elapsed: evt.elapsed });
                        job.completed = evt.index + 1;
                        console.log(`  ✓ ${evt.file} → ${evt.chunks} chunks in ${evt.elapsed}s`);
                        break;
                    case 'file_error':
                        job.results.push({ file: evt.file, status: 'error', error: evt.error });
                        job.completed = evt.index + 1;
                        console.error(`  ✗ ${evt.file}: ${evt.error}`);
                        break;
                    case 'done':
                        console.log(`  📊 ${evt.message}: ${evt.processed} vectors from ${evt.chunks || 0} chunks`);
                        break;
                    case 'log':
                        console.log(`  📝 ${evt.message}`);
                        break;
                    case 'error':
                        console.error(`  ❌ ${evt.message}`);
                        job.error = evt.message;
                        break;
                }
            } catch {
                // Not JSON — just log it
                if (line.trim()) console.log(`  [py] ${line}`);
            }
        }
    });

    proc.stderr.on('data', (chunk) => {
        const msg = chunk.toString().trim();
        if (msg) console.error(`  [py-err] ${msg}`);
    });

    proc.on('close', (code) => {
        job.completed = job.total;
        job.currentFile = null;
        if (code !== 0 && !job.error) {
            job.error = `Python process exited with code ${code}`;
        }
        job.status = job.results.some((r) => r.status === 'error')
            ? 'completed_with_errors'
            : (job.error ? 'completed_with_errors' : 'completed');
        console.log(`✅ Vectorize job ${jobId} finished: ${job.results.filter(r => r.status === 'success').length}/${job.total} succeeded`);

        // Clean up old jobs after 10 minutes
        setTimeout(() => vectorizeJobs.delete(jobId), 600_000);
    });

    proc.on('error', (err) => {
        job.error = err.message;
        job.status = 'completed_with_errors';
        console.error(`  ❌ Failed to start Python: ${err.message}`);
    });
});

// Poll vectorization progress
app.get('/api/vectorize/status/:jobId', (req, res) => {
    const job = vectorizeJobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }
    res.json({
        status: job.status,
        total: job.total,
        completed: job.completed,
        currentFile: job.currentFile,
        results: job.results,
        startedAt: job.startedAt,
    });
});

// ─── Workflow Management Routes ──────────────────────────

// Save a new workflow
app.post('/api/workflows', (req, res) => {
    const { name, description, nodes, edges, nodeConfigs } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Workflow name is required' });
    }

    const id = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const workflow = {
        id,
        name,
        description: description || '',
        nodes,
        edges,
        nodeConfigs,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
    };

    const filePath = path.join(WORKFLOWS_DIR, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf-8');
    console.log(`💾 Workflow saved: ${name}(${id})`);
    res.json({ message: 'Workflow saved', workflow: { id, name, createdAt: workflow.createdAt } });
});

// List all saved workflows
app.get('/api/workflows', (_req, res) => {
    const workflows = fs.readdirSync(WORKFLOWS_DIR)
        .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
        .map((f) => {
            try {
                const raw = fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf-8');
                const wf = JSON.parse(raw);
                return {
                    id: wf.id,
                    name: wf.name,
                    description: wf.description || '',
                    nodeCount: (wf.nodes || []).length,
                    edgeCount: (wf.edges || []).length,
                    createdAt: wf.createdAt,
                    updatedAt: wf.updatedAt,
                    version: wf.version || 1,
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    res.json({ workflows });
});

// Get a specific workflow
app.get('/api/workflows/:id', (req, res) => {
    const filePath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Workflow not found' });
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    res.json(JSON.parse(raw));
});

// Update an existing workflow
app.put('/api/workflows/:id', (req, res) => {
    const filePath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Workflow not found' });
    }

    const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const updated = {
        ...existing,
        ...req.body,
        id: existing.id, // preserve ID
        createdAt: existing.createdAt, // preserve creation time
        updatedAt: new Date().toISOString(),
        version: (existing.version || 1) + 1,
    };

    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), 'utf-8');
    console.log(`📝 Workflow updated: ${updated.name}(${updated.id}) v${updated.version}`);
    res.json({ message: 'Workflow updated', workflow: updated });
});

// Delete a workflow
app.delete('/api/workflows/:id', (req, res) => {
    const filePath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Workflow not found' });
    }
    const wf = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    fs.unlinkSync(filePath);
    console.log(`✗ Workflow deleted: ${wf.name}(${req.params.id})`);
    res.json({ message: 'Workflow deleted' });
});

// Download a workflow as JSON file
app.get('/api/workflows/:id/download', (req, res) => {
    const filePath = path.join(WORKFLOWS_DIR, `${req.params.id}.json`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Workflow not found' });
    }
    const wf = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const safeName = wf.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename = "${safeName}.json"`);
    res.send(JSON.stringify(wf, null, 2));
});

// ─── Start ───────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 Upload server running at http://localhost:${PORT}`);
    console.log(`📁 Documents directory: ${UPLOAD_DIR}`);
    console.log(`📂 Workflows directory: ${WORKFLOWS_DIR}\n`);
});

