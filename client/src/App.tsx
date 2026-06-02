import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { 
  Plus, 
  Settings, 
  AlertCircle,
  Database,
  Link,
  DatabaseZap,
  MousePointer2
} from 'lucide-react';
import { BlockEditor } from './components/BlockEditor';
import type { Block } from './components/BlockEditor';

interface Workspace {
  id: string;
  name: string;
  db_name: string;
  created_at?: string;
}

interface Page {
  id: string;
  title: string;
  icon: string | null;
  parent_page_id: string | null;
}

interface UserCursor {
  userId: string;
  userName: string;
  x: number;
  y: number;
}

// Generate a random username for testing presence
const USER_NAME = `User_${Math.floor(1000 + Math.random() * 9000)}`;

export default function App() {
  const [apiUrl, setApiUrl] = useState(() => {
    const saved = localStorage.getItem('notion_api_url');
    if (saved) return saved;
    // Auto-detect production URL (Vite dev server runs on 5173, backend runs on 5000)
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:5000';
    }
    return window.location.origin;
  });
  
  const [showConfig, setShowConfig] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [newWsDb, setNewWsDb] = useState('');
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'connected' | 'offline'>('offline');
  
  const [cursors, setCursors] = useState<{ [socketId: string]: UserCursor }>({});

  const socketRef = useRef<any>(null);
  const blocksRef = useRef<Block[]>([]);
  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  // Handle API base URL updates
  const handleSaveApiUrl = (url: string) => {
    setApiUrl(url);
    localStorage.setItem('notion_api_url', url);
    setShowConfig(false);
    setErrorMsg(null);
  };

  // Connect WebSockets (Socket.io)
  useEffect(() => {
    // Socket server URL is the same as the base API path
    const socketUrl = apiUrl;
    console.log(`🔌 Connecting to WebSocket Server at: ${socketUrl}`);
    
    const socket = io(socketUrl);
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('✅ WebSocket Connected!');
      setSyncStatus('connected');
      setErrorMsg(null);
      
      // If we already have a page active, join it immediately
      if (activePageId) {
        socket.emit('join-page', activePageId);
      }
    });

    socket.on('disconnect', () => {
      console.log('❌ WebSocket Disconnected');
      setSyncStatus('offline');
    });

    // Handle incoming real-time block updates from other clients
    socket.on('block-saved', (savedBlock: Block) => {
      if (savedBlock.page_id !== activePageId) return;
      
      let updated = [...blocksRef.current];
      const idx = updated.findIndex(b => b.id === savedBlock.id);
      if (idx !== -1) {
        updated[idx] = savedBlock;
      } else {
        updated.push(savedBlock);
      }
      updated.sort((a, b) => a.sort_order - b.sort_order);
      setBlocks(updated);
    });

    // Handle incoming block deletions from other clients
    socket.on('block-deleted', (deletedId: string) => {
      setBlocks(prev => prev.filter(b => b.id !== deletedId));
    });

    // Handle live cursor coordinates from other clients
    socket.on('cursor-moved', (data: UserCursor) => {
      setCursors(prev => ({
        ...prev,
        [data.userId]: data
      }));
    });

    // Remove cursor representation when client disconnects
    socket.on('cursor-disconnected', (socketId: string) => {
      setCursors(prev => {
        const copy = { ...prev };
        delete copy[socketId];
        return copy;
      });
    });

    return () => {
      socket.disconnect();
    };
  }, [apiUrl, activePageId]);

  // Handle joining room when page ID changes
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;

    if (activePageId) {
      socket.emit('join-page', activePageId);
    }
    setCursors({}); // Clear client cursors on route change

    return () => {
      if (activePageId) {
        socket.emit('leave-page', activePageId);
      }
    };
  }, [activePageId]);

  // Fetch workspaces list
  const fetchWorkspaces = async () => {
    try {
      const res = await axios.get(`${apiUrl}/api/workspaces`);
      if (res.data && res.data.success) {
        setWorkspaces(res.data.workspaces);
        if (res.data.workspaces.length > 0 && !activeWorkspace) {
          setActiveWorkspace(res.data.workspaces[0]);
        }
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Connection failed. Make sure your server is running on ${apiUrl}`);
    }
  };

  useEffect(() => {
    fetchWorkspaces();
  }, [apiUrl]);

  // Fetch pages inside the active workspace
  const fetchPages = async () => {
    if (!activeWorkspace) return;
    try {
      const res = await axios.get(`${apiUrl}/api/pages?workspace_db=${activeWorkspace.db_name}`, {
        headers: { 'X-Workspace-Db': activeWorkspace.db_name }
      });
      if (res.data && res.data.success) {
        setPages(res.data.pages);
        if (res.data.pages.length > 0 && !activePageId) {
          setActivePageId(res.data.pages[0].id);
        } else if (res.data.pages.length === 0) {
          setActivePageId(null);
          setBlocks([]);
        }
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg(`Failed to connect to workspace database: ${activeWorkspace.db_name}`);
    }
  };

  useEffect(() => {
    fetchPages();
  }, [activeWorkspace, apiUrl]);

  // Fetch blocks when the active page changes
  const fetchBlocks = async (pageId: string) => {
    if (!activeWorkspace || !pageId) return;
    try {
      const res = await axios.get(`${apiUrl}/api/blocks?page_id=${pageId}&workspace_db=${activeWorkspace.db_name}`, {
        headers: { 'X-Workspace-Db': activeWorkspace.db_name }
      });
      if (res.data && res.data.success) {
        setBlocks(res.data.blocks);
        setErrorMsg(null);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to load page blocks.");
    }
  };

  useEffect(() => {
    if (activePageId) {
      fetchBlocks(activePageId);
    } else {
      setBlocks([]);
    }
  }, [activePageId, activeWorkspace]);

  // Emit cursor coordinates over Socket.io
  const handleCursorMove = (x: number, y: number) => {
    const socket = socketRef.current;
    if (socket && socket.connected && activePageId) {
      socket.emit('cursor-move', {
        pageId: activePageId,
        userName: USER_NAME,
        x,
        y
      });
    }
  };

  // CRUD handlers
  const handleCreateWorkspace = async () => {
    if (!newWsName.trim() || !newWsDb.trim()) return;
    try {
      const res = await axios.post(`${apiUrl}/api/workspaces`, {
        name: newWsName,
        db_name: newWsDb
      });
      if (res.data && res.data.success) {
        const newWs = res.data.workspace;
        setWorkspaces(prev => [newWs, ...prev]);
        setActiveWorkspace(newWs);
        setShowCreateModal(false);
        setNewWsName('');
        setNewWsDb('');
        setErrorMsg(null);
      }
    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to save new workspace.");
    }
  };

  const handleCreatePage = async () => {
    if (!activeWorkspace) return;
    try {
      const newPageId = `pg_${Math.random().toString(36).substr(2, 9)}`;
      const res = await axios.post(
        `${apiUrl}/api/pages?workspace_db=${activeWorkspace.db_name}`,
        {
          id: newPageId,
          title: 'Untitled Note',
          icon: '📄',
          parent_page_id: null
        },
        { headers: { 'X-Workspace-Db': activeWorkspace.db_name } }
      );

      if (res.data && res.data.success) {
        const newPage = res.data.page;
        setPages(prev => [...prev, newPage]);
        setActivePageId(newPage.id);
        setBlocks([]);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("Failed to create new page.");
    }
  };

  const handleSaveBlock = async (block: Block) => {
    if (!activeWorkspace) return;
    
    // Update local state instantly for responsive user feedback
    const originalBlocks = [...blocks];
    const idx = blocks.findIndex(b => b.id === block.id);
    let newBlocks = [...blocks];
    if (idx !== -1) {
      newBlocks[idx] = block;
    } else {
      newBlocks.push(block);
    }
    newBlocks.sort((a, b) => a.sort_order - b.sort_order);
    setBlocks(newBlocks);

    try {
      await axios.post(
        `${apiUrl}/api/save_block?workspace_db=${activeWorkspace.db_name}`,
        block,
        { headers: { 'X-Workspace-Db': activeWorkspace.db_name } }
      );
    } catch (err) {
      console.error("Save block failed, reverting state", err);
      setBlocks(originalBlocks);
    }
  };

  const handleDeleteBlock = async (blockId: string) => {
    if (!activeWorkspace) return;
    
    const originalBlocks = [...blocks];
    setBlocks(prev => prev.filter(b => b.id !== blockId));

    try {
      await axios.post(
        `${apiUrl}/api/delete_block?workspace_db=${activeWorkspace.db_name}`,
        { id: blockId, page_id: activePageId },
        { headers: { 'X-Workspace-Db': activeWorkspace.db_name } }
      );
    } catch (err) {
      console.error("Delete block failed", err);
      setBlocks(originalBlocks);
    }
  };

  const handleReorderBlocks = (reordered: Block[]) => {
    setBlocks(reordered);
  };

  const handlePageTitleChange = async (newTitle: string) => {
    if (!activeWorkspace || !activePageId) return;
    
    setPages(prev => prev.map(p => p.id === activePageId ? { ...p, title: newTitle } : p));
    
    try {
      await axios.post(
        `${apiUrl}/api/pages/update?workspace_db=${activeWorkspace.db_name}`,
        { id: activePageId, title: newTitle },
        { headers: { 'X-Workspace-Db': activeWorkspace.db_name } }
      );
    } catch (err) {
      console.error("Failed to rename page", err);
    }
  };

  const activePage = pages.find(p => p.id === activePageId);

  return (
    <div className="app-container">
      
      {/* ------------------ SIDEBAR ------------------ */}
      <div className="sidebar">
        
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-icon">N</span>
            <span>Real-time Notion</span>
          </div>

          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Active Database (Workspace)
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <select 
                className="workspace-selector"
                value={activeWorkspace?.id || ''}
                onChange={(e) => {
                  const ws = workspaces.find(w => w.id === e.target.value);
                  if (ws) {
                    setActiveWorkspace(ws);
                    setActivePageId(null);
                  }
                }}
              >
                {workspaces.map(ws => (
                  <option key={ws.id} value={ws.id}>
                    📂 {ws.name} ({ws.db_name})
                  </option>
                ))}
              </select>
              <button 
                className="add-btn" 
                title="Create a new Database Workspace"
                onClick={() => setShowCreateModal(true)}
                style={{ padding: '8px', border: '1px solid var(--border-color)', borderRadius: '6px', backgroundColor: 'var(--bg-card)' }}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="sidebar-nav">
          <div className="section-title">
            <span>Pages / Notes</span>
            <button className="add-btn" onClick={handleCreatePage} title="New Note">
              <Plus size={14} />
            </button>
          </div>
          
          {pages.length === 0 ? (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-light)', padding: '0 8px', fontStyle: 'italic' }}>
              No pages inside this workspace. Click '+' to add one.
            </div>
          ) : (
            <ul className="nav-list">
              {pages.map(page => (
                <li key={page.id}>
                  <div 
                    className={`nav-item ${page.id === activePageId ? 'active' : ''}`}
                    onClick={() => setActivePageId(page.id)}
                  >
                    <span className="nav-icon">{page.icon || '📄'}</span>
                    <span className="nav-title">{page.title || 'Untitled Note'}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sidebar-footer">
          <div>User: <code>{USER_NAME}</code></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
            <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', flex: 1 }}>
              Server: <code>{apiUrl}</code>
            </span>
            <button 
              onClick={() => setShowConfig(!showConfig)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-color)' }}
              title="Change Server URL"
            >
              <Settings size={14} />
            </button>
          </div>
          
          <div className="config-status">
            <span className={`status-dot ${syncStatus === 'connected' ? 'active' : ''}`} style={{ backgroundColor: syncStatus === 'connected' ? '#10b981' : '#ef4444' }} />
            <span>
              {syncStatus === 'connected' ? 'WebSockets Active' : 'Offline'}
            </span>
          </div>
        </div>

      </div>

      {/* ------------------ MAIN CONTENT ------------------ */}
      <div className="main-content">
        
        {showConfig && (
          <div style={{ padding: '16px', backgroundColor: 'var(--accent-bg-soft)', borderBottom: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 600 }}>
              <Link size={16} /> Configure API / WebSocket Server URL:
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input 
                type="text" 
                className="form-input" 
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                style={{ flex: 1, padding: '6px 10px', fontSize: '0.85rem' }}
                placeholder="http://localhost:5000"
              />
              <button 
                className="btn btn-primary"
                onClick={() => handleSaveApiUrl(apiUrl)}
                style={{ padding: '6px 12px' }}
              >
                Save
              </button>
              <button 
                className="btn btn-secondary"
                onClick={() => setShowConfig(false)}
                style={{ padding: '6px 12px' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {errorMsg && (
          <div style={{ display: 'flex', gap: '10px', backgroundColor: '#fef2f2', borderBottom: '1px solid #fee2e2', padding: '12px 20px', color: '#b91c1c', fontSize: '0.85rem', fontWeight: 500 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>{errorMsg}</div>
          </div>
        )}

        {activePage ? (
          <>
            <div className="page-banner" />
            <div className="page-container" style={{ position: 'relative' }}>
              
              {/* Dynamic Presence Cursors */}
              {Object.values(cursors).map((cursor) => (
                <div 
                  key={cursor.userId}
                  className="live-cursor"
                  style={{ top: `${cursor.y}px`, left: `${cursor.x}px` }}
                >
                  <MousePointer2 className="cursor-pointer" size={18} fill="#2563eb" />
                  <span className="cursor-label">{cursor.userName}</span>
                </div>
              ))}

              <div className="page-icon-wrapper">
                {activePage.icon || '📄'}
              </div>
              
              <input 
                type="text"
                className="page-title-input"
                value={activePage.title}
                onChange={(e) => handlePageTitleChange(e.target.value)}
                placeholder="Untitled Note"
              />

              <BlockEditor 
                pageId={activePage.id}
                blocks={blocks}
                onSaveBlock={handleSaveBlock}
                onDeleteBlock={handleDeleteBlock}
                onReorderBlocks={handleReorderBlocks}
                onCursorMove={handleCursorMove}
              />

            </div>
          </>
        ) : (
          <div className="empty-page-placeholder">
            <DatabaseZap className="empty-icon" size={48} />
            <span className="empty-title">Select Workspace & Note</span>
            <p style={{ fontSize: '0.9rem', maxWidth: '380px' }}>
              Select a registered database workspace, then click or add a note to start real-time editing.
            </p>
            {pages.length > 0 ? (
              <button className="btn btn-primary" style={{ marginTop: '10px' }} onClick={() => setActivePageId(pages[0].id)}>
                Open First Page
              </button>
            ) : activeWorkspace ? (
              <button className="btn btn-primary" style={{ marginTop: '10px' }} onClick={handleCreatePage}>
                Create a Page
              </button>
            ) : null}
          </div>
        )}
      </div>

      {/* ------------------ CREATE WORKSPACE MODAL ------------------ */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            
            <div className="modal-header">
              <span className="modal-title">New Database Workspace</span>
              <button className="add-btn" onClick={() => setShowCreateModal(false)} style={{ fontSize: '1.25rem' }}>
                &times;
              </button>
            </div>
            
            <div className="modal-body">
              
              <div style={{ display: 'flex', gap: '8px', backgroundColor: '#eff6ff', padding: '12px', borderRadius: '8px', color: '#1e40af', fontSize: '0.85rem', lineHeight: '1.4' }}>
                <Database size={24} style={{ flexShrink: 0 }} />
                <div>
                  <strong>Local Fallback Mode:</strong> Workspace databases are created automatically as local JSON files. If you add a MongoDB Atlas URI in <code>.env</code>, it will create actual MongoDB databases automatically.
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Workspace Display Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. Work Stuff"
                  value={newWsName}
                  onChange={(e) => setNewWsName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Database File / DB Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. personal_workspace"
                  value={newWsDb}
                  onChange={(e) => setNewWsDb(e.target.value)}
                />
                <span className="form-help">
                  Only use lowercase alphanumeric characters and underscores (e.g. <code>work_db</code>).
                </span>
              </div>

            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                Cancel
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleCreateWorkspace}
                disabled={!newWsName.trim() || !newWsDb.trim()}
              >
                Create Workspace
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
