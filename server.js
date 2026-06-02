import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// MongoDB driver
import { MongoClient } from 'mongodb';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const DB_DIR = path.resolve(__dirname, './db');
const MONGODB_URI = process.env.MONGODB_URI;

// Ensure DB directory exists for local fallback
if (!MONGODB_URI && !fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// ------------------ LOCAL JSON DATABASE ADAPTER ------------------
class JsonDb {
  constructor(dbName) {
    this.filePath = path.join(DB_DIR, `${dbName}.json`);
    this.data = { pages: [], blocks: [], workspaces: [] };
    this.load();
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
      } catch (err) {
        console.error(`Error reading database file ${this.filePath}:`, err);
      }
    } else {
      this.save();
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error(`Error writing database file ${this.filePath}:`, err);
    }
  }
}

// Cache of local JSON database connections
const jsonConnections = new Map();
function getJsonDb(dbName) {
  let db = jsonConnections.get(dbName);
  if (!db) {
    db = new JsonDb(dbName);
    jsonConnections.set(dbName, db);
  }
  return db;
}

// ------------------ DATABASE ABSTRACTION LAYER ------------------
let mongoClient = null;

// Initialise Database Connectors
async function initMainDb() {
  if (MONGODB_URI) {
    console.log('🔌 Connecting to MongoDB Atlas...');
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    const db = mongoClient.db('main');
    await db.collection('workspaces').createIndex({ id: 1 }, { unique: true });
    console.log('✅ MongoDB Main Database Initialised.');
  } else {
    console.log('📂 Initialising Local JSON File Main Database...');
    const db = getJsonDb('main');
    console.log('✅ JSON File Main Database Initialised.');
  }
}

// Helper to get workspace database client
async function getWorkspaceDb(dbName) {
  if (MONGODB_URI) {
    const db = mongoClient.db(dbName);
    return {
      getPages: async () => {
        return await db.collection('pages').find({}).sort({ title: 1 }).toArray();
      },
      createPage: async (page) => {
        await db.collection('pages').updateOne(
          { id: page.id },
          { $set: page },
          { upsert: true }
        );
        return page;
      },
      updatePage: async (id, title) => {
        await db.collection('pages').updateOne(
          { id },
          { $set: { title, updated_at: new Date() } }
        );
      },
      getBlocks: async (pageId) => {
        return await db.collection('blocks').find({ page_id: pageId }).sort({ sort_order: 1 }).toArray();
      },
      saveBlock: async (block) => {
        await db.collection('blocks').updateOne(
          { id: block.id },
          { $set: { ...block, sort_order: parseFloat(block.sort_order) } },
          { upsert: true }
        );
      },
      deleteBlock: async (id) => {
        await db.collection('blocks').deleteOne({ id });
      }
    };
  } else {
    // Pure Local JSON File DB Mode
    const db = getJsonDb(dbName);
    return {
      getPages: async () => {
        return [...db.data.pages].sort((a, b) => a.title.localeCompare(b.title));
      },
      createPage: async (page) => {
        const idx = db.data.pages.findIndex(p => p.id === page.id);
        if (idx !== -1) {
          db.data.pages[idx] = { ...db.data.pages[idx], ...page };
        } else {
          db.data.pages.push(page);
        }
        db.save();
        return page;
      },
      updatePage: async (id, title) => {
        const page = db.data.pages.find(p => p.id === id);
        if (page) {
          page.title = title;
          page.updated_at = new Date().toISOString();
          db.save();
        }
      },
      getBlocks: async (pageId) => {
        return db.data.blocks
          .filter(b => b.page_id === pageId)
          .sort((a, b) => a.sort_order - b.sort_order);
      },
      saveBlock: async (block) => {
        const idx = db.data.blocks.findIndex(b => b.id === block.id);
        const formattedBlock = { ...block, sort_order: parseFloat(block.sort_order) };
        if (idx !== -1) {
          db.data.blocks[idx] = formattedBlock;
        } else {
          db.data.blocks.push(formattedBlock);
        }
        db.save();
      },
      deleteBlock: async (id) => {
        db.data.blocks = db.data.blocks.filter(b => b.id !== id);
        db.save();
      }
    };
  }
}

// Global DB connector middleware
async function getDb(req, res, next) {
  const dbName = req.headers['x-workspace-db'] || req.query.workspace_db;
  if (!dbName) {
    return res.status(400).json({ error: 'Workspace DB target missing' });
  }
  try {
    req.wsDb = await getWorkspaceDb(dbName);
    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve database client', message: err.message });
  }
}

// ------------------ REST ENDPOINTS ------------------

// Workspaces
app.get('/api/workspaces', async (req, res) => {
  try {
    if (MONGODB_URI) {
      const db = mongoClient.db('main');
      const workspaces = await db.collection('workspaces').find({}).sort({ created_at: -1 }).toArray();
      res.json({ success: true, workspaces });
    } else {
      const db = getJsonDb('main');
      const workspaces = [...db.data.workspaces].reverse();
      res.json({ success: true, workspaces });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workspaces', async (req, res) => {
  const { name, db_name } = req.body;
  if (!name || !db_name) {
    return res.status(400).json({ error: 'Workspace details missing' });
  }
  const id = `ws_${Math.random().toString(36).substr(2, 9)}`;
  const workspace = { id, name, db_name, created_at: new Date() };

  try {
    if (MONGODB_URI) {
      const db = mongoClient.db('main');
      await db.collection('workspaces').insertOne(workspace);
    } else {
      const db = getJsonDb('main');
      db.data.workspaces.push(workspace);
      db.save();
    }
    // Pre-initialise workspace DB
    await getWorkspaceDb(db_name);
    res.json({ success: true, workspace });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pages
app.get('/api/pages', getDb, async (req, res) => {
  try {
    const pages = await req.wsDb.getPages();
    res.json({ success: true, pages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pages', getDb, async (req, res) => {
  const { id, title, icon, parent_page_id } = req.body;
  const page = { 
    id: id || `pg_${Math.random().toString(36).substr(2, 9)}`, 
    title: title || 'Untitled Note', 
    icon: icon || '📄', 
    parent_page_id: parent_page_id || null 
  };
  try {
    const newPage = await req.wsDb.createPage(page);
    res.json({ success: true, page: newPage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pages/update', getDb, async (req, res) => {
  const { id, title } = req.body;
  try {
    await req.wsDb.updatePage(id, title);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Blocks
app.get('/api/blocks', getDb, async (req, res) => {
  const { page_id } = req.query;
  if (!page_id) return res.status(400).json({ error: 'Page ID missing' });
  try {
    const blocks = await req.wsDb.getBlocks(page_id);
    res.json({ success: true, blocks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/save_block', getDb, async (req, res) => {
  const block = req.body;
  try {
    await req.wsDb.saveBlock(block);
    // Broadcast change to other users in the page room
    io.to(block.page_id).emit('block-saved', block);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/delete_block', getDb, async (req, res) => {
  const { id, page_id } = req.body;
  try {
    await req.wsDb.deleteBlock(id);
    io.to(page_id).emit('block-deleted', id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve frontend build folder in production
const clientBuildPath = path.join(__dirname, './client/dist');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

// ------------------ SOCKET.IO REALTIME ------------------
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // User joins a dynamic page room
  socket.on('join-page', (pageId) => {
    socket.join(pageId);
    console.log(`👤 Socket ${socket.id} joined page: ${pageId}`);
  });

  // User leaves a page room
  socket.on('leave-page', (pageId) => {
    socket.leave(pageId);
    console.log(`👤 Socket ${socket.id} left page: ${pageId}`);
  });

  // Client-to-Client live cursor movement broadcasts
  socket.on('cursor-move', (data) => {
    // Broadcast coordinates to everyone else in the same room
    socket.to(data.pageId).emit('cursor-moved', {
      userId: socket.id,
      userName: data.userName,
      x: data.x,
      y: data.y
    });
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
    io.emit('cursor-disconnected', socket.id);
  });
});

// Run server
initMainDb().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`🚀 Real-time server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('🛑 Database connection failed, exiting...', err);
  process.exit(1);
});
