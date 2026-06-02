import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronUp, 
  ChevronDown, 
  Trash2, 
  Heading1, 
  Heading2, 
  Heading3, 
  Type, 
  CheckSquare, 
  List, 
  Code, 
  Info,
  Plus
} from 'lucide-react';

export interface Block {
  id: string;
  page_id: string;
  type: string;
  content: string;
  sort_order: number;
}

interface BlockEditorProps {
  pageId: string;
  blocks: Block[];
  onSaveBlock: (block: Block) => void;
  onDeleteBlock: (blockId: string) => void;
  onReorderBlocks: (reordered: Block[]) => void;
  onCursorMove: (x: number, y: number) => void;
}

interface SlashMenuItem {
  type: string;
  name: string;
  desc: string;
  icon: React.ReactNode;
}

export const BlockEditor: React.FC<BlockEditorProps> = ({
  pageId,
  blocks,
  onSaveBlock,
  onDeleteBlock,
  onReorderBlocks,
  onCursorMove,
}) => {
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [slashMenu, setSlashMenu] = useState<{
    visible: boolean;
    blockId: string;
    triggerIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const [slashSearch, setSlashSearch] = useState('');
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  const textareasRef = useRef<{ [key: string]: HTMLTextAreaElement | null }>({});
  const lastMouseEmitRef = useRef<number>(0);

  const menuItems: SlashMenuItem[] = [
    { type: 'text', name: 'Text', desc: 'Plain text paragraph', icon: <Type size={16} /> },
    { type: 'h1', name: 'Heading 1', desc: 'Large section heading', icon: <Heading1 size={16} /> },
    { type: 'h2', name: 'Heading 2', desc: 'Medium section heading', icon: <Heading2 size={16} /> },
    { type: 'h3', name: 'Heading 3', desc: 'Small section heading', icon: <Heading3 size={16} /> },
    { type: 'todo', name: 'To-do list', desc: 'Checkbox item list', icon: <CheckSquare size={16} /> },
    { type: 'bullet', name: 'Bulleted list', desc: 'Simple bulleted items', icon: <List size={16} /> },
    { type: 'code', name: 'Code block', desc: 'Preformatted code text', icon: <Code size={16} /> },
    { type: 'callout', name: 'Callout', desc: 'Important highlight box', icon: <Info size={16} /> },
  ];

  const filteredMenuItems = menuItems.filter(item => 
    item.name.toLowerCase().includes(slashSearch.toLowerCase()) ||
    item.type.toLowerCase().includes(slashSearch.toLowerCase())
  );

  const resizeTextarea = (id: string) => {
    const textarea = textareasRef.current[id];
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  };

  useEffect(() => {
    blocks.forEach(block => {
      resizeTextarea(block.id);
    });
  }, [blocks]);

  // Create initial block if empty
  useEffect(() => {
    if (blocks.length === 0 && pageId) {
      const initialBlock: Block = {
        id: `blk_${Math.random().toString(36).substr(2, 9)}`,
        page_id: pageId,
        type: 'text',
        content: '',
        sort_order: 1.0
      };
      onSaveBlock(initialBlock);
    }
  }, [blocks, pageId]);

  useEffect(() => {
    setSelectedSlashIndex(0);
  }, [slashSearch]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const now = Date.now();
    // Throttle cursor updates (50ms interval) to save socket network load
    if (now - lastMouseEmitRef.current > 50) {
      const rect = e.currentTarget.getBoundingClientRect();
      // Send coordinates relative to the editor canvas
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      onCursorMove(x, y);
      lastMouseEmitRef.current = now;
    }
  };

  const handleTextChange = (id: string, value: string) => {
    const block = blocks.find(b => b.id === id);
    if (!block) return;

    const selectionStart = textareasRef.current[id]?.selectionStart || 0;
    const textBeforeCursor = value.substring(0, selectionStart);
    const slashIndex = textBeforeCursor.lastIndexOf('/');

    if (slashIndex !== -1 && (slashIndex === 0 || textBeforeCursor[slashIndex - 1] === ' ' || textBeforeCursor[slashIndex - 1] === '\n')) {
      const query = textBeforeCursor.substring(slashIndex + 1);
      const textarea = textareasRef.current[id];
      if (textarea) {
        const rect = textarea.getBoundingClientRect();
        const parentRect = textarea.closest('.block-list')?.getBoundingClientRect();
        setSlashMenu({
          visible: true,
          blockId: id,
          triggerIndex: slashIndex,
          x: rect.left - (parentRect?.left || 0),
          y: rect.bottom - (parentRect?.top || 0) + 4
        });
        setSlashSearch(query);
      }
    } else {
      setSlashMenu(null);
    }

    onSaveBlock({ ...block, content: value });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, index: number, block: Block) => {
    const textarea = textareasRef.current[block.id];
    if (!textarea) return;

    if (slashMenu && slashMenu.visible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSlashIndex(prev => (prev + 1) % filteredMenuItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSlashIndex(prev => (prev - 1 + filteredMenuItems.length) % filteredMenuItems.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredMenuItems[selectedSlashIndex]) {
          convertBlockType(block.id, filteredMenuItems[selectedSlashIndex].type);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMenu(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      
      if ((block.type === 'bullet' || block.type === 'todo') && block.content.trim() === '') {
        convertBlockType(block.id, 'text');
        return;
      }

      const nextSortOrder = index < blocks.length - 1 
        ? (block.sort_order + blocks[index + 1].sort_order) / 2
        : block.sort_order + 1.0;

      const newBlock: Block = {
        id: `blk_${Math.random().toString(36).substr(2, 9)}`,
        page_id: pageId,
        type: block.type === 'bullet' || block.type === 'todo' ? block.type : 'text',
        content: '',
        sort_order: nextSortOrder
      };

      onSaveBlock(newBlock);
      setActiveBlockId(newBlock.id);
      
      setTimeout(() => {
        textareasRef.current[newBlock.id]?.focus();
      }, 50);
    }

    if (e.key === 'Backspace' && block.content === '' && index > 0) {
      e.preventDefault();
      onDeleteBlock(block.id);
      const prevBlockId = blocks[index - 1].id;
      setTimeout(() => {
        const prevTextarea = textareasRef.current[prevBlockId];
        if (prevTextarea) {
          prevTextarea.focus();
          const length = prevTextarea.value.length;
          prevTextarea.setSelectionRange(length, length);
        }
      }, 50);
    }

    if (e.key === 'ArrowUp' && textarea.selectionStart === 0 && index > 0) {
      e.preventDefault();
      const prevId = blocks[index - 1].id;
      textareasRef.current[prevId]?.focus();
    }

    if (e.key === 'ArrowDown' && textarea.selectionStart === textarea.value.length && index < blocks.length - 1) {
      e.preventDefault();
      const nextId = blocks[index + 1].id;
      textareasRef.current[nextId]?.focus();
    }
  };

  const convertBlockType = (blockId: string, newType: string) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;

    let updatedContent = block.content;
    if (slashMenu) {
      const triggerIdx = slashMenu.triggerIndex;
      updatedContent = block.content.substring(0, triggerIdx) + block.content.substring(triggerIdx + slashSearch.length + 1);
    }

    onSaveBlock({
      ...block,
      type: newType,
      content: updatedContent
    });
    setSlashMenu(null);

    setTimeout(() => {
      textareasRef.current[blockId]?.focus();
    }, 50);
  };

  const handleMoveBlock = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === blocks.length - 1) return;

    const newBlocks = [...blocks];
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    
    const temp = newBlocks[index].sort_order;
    newBlocks[index].sort_order = newBlocks[targetIdx].sort_order;
    newBlocks[targetIdx].sort_order = temp;

    newBlocks.sort((a, b) => a.sort_order - b.sort_order);
    onReorderBlocks(newBlocks);
    
    onSaveBlock(newBlocks[index]);
    onSaveBlock(newBlocks[targetIdx]);
  };

  const renderBlockElement = (block: Block, index: number) => {
    const textareaProps = {
      ref: (el: HTMLTextAreaElement | null) => { textareasRef.current[block.id] = el; },
      value: block.content,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => handleTextChange(block.id, e.target.value),
      onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => handleKeyDown(e, index, block),
      onFocus: () => setActiveBlockId(block.id),
      onBlur: () => {
        setTimeout(() => {
          if (activeBlockId === block.id) setActiveBlockId(null);
        }, 150);
      },
      placeholder: block.type === 'text' ? "Type '/' for commands..." : '',
      className: "block-input",
      rows: 1
    };

    switch (block.type) {
      case 'h1':
        return <div className="block-h1"><textarea {...textareaProps} /></div>;
      case 'h2':
        return <div className="block-h2"><textarea {...textareaProps} /></div>;
      case 'h3':
        return <div className="block-h3"><textarea {...textareaProps} /></div>;
      case 'bullet':
        return (
          <div className="block-bullet">
            <span className="bullet-marker">•</span>
            <textarea {...textareaProps} />
          </div>
        );
      case 'todo':
        const isChecked = block.content.startsWith('[x] ');
        const cleanContent = isChecked ? block.content.substring(4) : block.content;
        return (
          <div className="block-todo">
            <input 
              type="checkbox" 
              className="todo-checkbox" 
              checked={isChecked}
              onChange={() => {
                const newContent = isChecked ? cleanContent : `[x] ${cleanContent}`;
                onSaveBlock({ ...block, content: newContent });
              }}
            />
            <textarea 
              {...textareaProps} 
              value={cleanContent}
              onChange={(e) => {
                const prefix = isChecked ? '[x] ' : '';
                handleTextChange(block.id, prefix + e.target.value);
              }}
            />
          </div>
        );
      case 'code':
        return (
          <div className="block-code">
            <textarea {...textareaProps} placeholder="// write code here..." />
          </div>
        );
      case 'callout':
        return (
          <div className="block-callout">
            <span className="callout-emoji">💡</span>
            <textarea {...textareaProps} placeholder="Callout info..." />
          </div>
        );
      default:
        return <textarea {...textareaProps} />;
    }
  };

  return (
    <div 
      className="block-list" 
      onMouseMove={handleMouseMove}
      onClick={() => {
        if (blocks.length > 0 && activeBlockId === null) {
          const lastBlockId = blocks[blocks.length - 1].id;
          textareasRef.current[lastBlockId]?.focus();
        }
      }}
    >
      {blocks.map((block, index) => (
        <div 
          key={block.id} 
          className={`block-row ${block.type !== 'text' ? `block-${block.type}` : ''}`}
        >
          <div className="block-actions">
            <button 
              className="action-btn" 
              title="Move block up"
              disabled={index === 0}
              onClick={(e) => { e.stopPropagation(); handleMoveBlock(index, 'up'); }}
            >
              <ChevronUp size={14} />
            </button>
            <button 
              className="action-btn" 
              title="Move block down"
              disabled={index === blocks.length - 1}
              onClick={(e) => { e.stopPropagation(); handleMoveBlock(index, 'down'); }}
            >
              <ChevronDown size={14} />
            </button>
            <button 
              className="action-btn" 
              title="Delete block"
              onClick={(e) => { e.stopPropagation(); onDeleteBlock(block.id); }}
            >
              <Trash2 size={14} />
            </button>
          </div>

          <div className="block-content-wrapper">
            {renderBlockElement(block, index)}
          </div>
        </div>
      ))}

      {slashMenu && slashMenu.visible && filteredMenuItems.length > 0 && (
        <div 
          className="slash-menu"
          style={{ top: `${slashMenu.y}px`, left: `${slashMenu.x}px` }}
        >
          {filteredMenuItems.map((item, idx) => (
            <button
              key={item.type}
              className={`slash-item ${idx === selectedSlashIndex ? 'selected' : ''}`}
              onMouseEnter={() => setSelectedSlashIndex(idx)}
              onClick={() => convertBlockType(slashMenu.blockId, item.type)}
            >
              <span className="slash-item-icon">{item.icon}</span>
              <span className="slash-item-text">
                <span className="slash-item-name">{item.name}</span>
                <span className="slash-item-desc">{item.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <button 
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: 'none',
          border: 'none',
          color: 'var(--text-light)',
          fontSize: '0.85rem',
          cursor: 'pointer',
          padding: '8px 0',
          marginTop: '10px',
          alignSelf: 'flex-start'
        }}
        onClick={(e) => {
          e.stopPropagation();
          const lastOrder = blocks.length > 0 ? blocks[blocks.length - 1].sort_order : 0;
          const newBlock: Block = {
            id: `blk_${Math.random().toString(36).substr(2, 9)}`,
            page_id: pageId,
            type: 'text',
            content: '',
            sort_order: lastOrder + 1.0
          };
          onSaveBlock(newBlock);
          setActiveBlockId(newBlock.id);
          setTimeout(() => {
            textareasRef.current[newBlock.id]?.focus();
          }, 50);
        }}
      >
        <Plus size={14} /> Add block
      </button>
    </div>
  );
};
