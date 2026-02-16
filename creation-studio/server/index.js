const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execFile, execSync } = require('child_process');

const app = express();
const PORT = 4000;

// Directories
const UPLOAD_DIR = path.join(__dirname, '..', 'uploaded_documents');
const WORKFLOWS_DIR = path.join(__dirname, '..', 'saved_workflows');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(WORKFLOWS_DIR)) fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });

// PostgreSQL path for psql commands
const PG_BIN = '/opt/homebrew/opt/postgresql@16/bin';
const PSQL = path.join(PG_BIN, 'psql');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Multer config — save to uploaded_documents/
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
        // Preserve original name; prepend timestamp if collision
        const target = path.join(UPLOAD_DIR, file.originalname);
        if (fs.existsSync(target)) {
            const ext = path.extname(file.originalname);
            const base = path.basename(file.originalname, ext);
            cb(null, `${base}_${Date.now()}${ext}`);
        } else {
            cb(null, file.originalname);
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
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
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

// Upload a single file
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No valid file provided' });
    }
    console.log(`✓ Uploaded: ${req.file.originalname} → ${req.file.filename}`);
    res.json({
        message: 'File uploaded successfully',
        file: {
            name: req.file.filename,
            originalName: req.file.originalname,
            size: req.file.size,
            path: req.file.path,
        },
    });
});

// List uploaded files with vectorization status
app.get('/api/files', (_req, res) => {
    const vectorized = getVectorizedFiles();
    const files = fs.readdirSync(UPLOAD_DIR)
        .filter((name) => !name.startsWith('.')) // skip hidden files
        .map((name) => {
            const stat = fs.statSync(path.join(UPLOAD_DIR, name));
            return {
                name,
                size: stat.size,
                uploadedAt: stat.mtime.toISOString(),
                status: vectorized.has(name) ? 'vectorized' : 'uploaded',
            };
        });
    res.json({ files });
});

// Delete a file (also remove its vectors from DB)
app.delete('/api/files/:name', (req, res) => {
    const filePath = path.join(UPLOAD_DIR, req.params.name);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    fs.unlinkSync(filePath);
    // Also clean up vectors from DB
    try {
        const safeName = req.params.name.replace(/'/g, "''");
        execSync(
            `${PSQL} -d vectordb -c "DELETE FROM document_vectors WHERE filename = '${safeName}'"`,
            { encoding: 'utf-8', timeout: 5000 }
        );
    } catch {
        // Ignore if DB not available
    }
    console.log(`✗ Deleted: ${req.params.name}`);
    res.json({ message: 'File deleted' });
});

// Vectorize uploaded documents
app.post('/api/vectorize', (req, res) => {
    const { files } = req.body;
    const scriptPath = path.join(__dirname, '..', 'scripts', 'vectorize.py');
    const pythonBin = path.join(__dirname, '..', 'venv', 'bin', 'python3');

    const args = [scriptPath, '--dir', UPLOAD_DIR];
    if (files && files.length > 0) {
        args.push('--files', ...files);
    }

    console.log(`⚡ Vectorizing ${files ? files.length : 'all'} documents...`);

    const env = {
        ...process.env,
        PATH: `${PG_BIN}: ${process.env.PATH}`,
    };

    execFile(pythonBin, args, { timeout: 300_000, env }, (error, stdout, stderr) => {
        if (error) {
            console.error('Vectorize error:', stderr || error.message);
            return res.status(500).json({ error: stderr || error.message });
        }
        console.log(stdout);
        res.json({ message: 'Vectorization complete', output: stdout });
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

