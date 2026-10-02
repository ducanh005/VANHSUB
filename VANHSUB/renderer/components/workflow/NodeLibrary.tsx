import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  Type,
  Sparkles,
  Sliders,
  ShieldCheck,
  Scissors,
  Share2,
  Layers,
  ChevronDown,
  ChevronRight,
  GripVertical,
  X,
} from 'lucide-react';
import { NODE_DEFINITIONS, getNodesByCategory } from '../../lib/workflow/nodeRegistry';
import { CATEGORY_STYLES } from '../../lib/workflow/portColors';
import { useWorkflowStore } from '../../lib/store/workflowStore';
import type { NodeCategory } from '../../types/workflow';

const CATEGORY_ICONS: Record<NodeCategory, React.ComponentType<{ className?: string }>> = {
  input: Type,
  model: Sparkles,
  control: Sliders,
  consistency: ShieldCheck,
  editing: Scissors,
  output: Share2,
  logic: Layers,
};

export interface NodeLibraryProps {
  onClose?: () => void;
}

export default function NodeLibrary({ onClose }: NodeLibraryProps = {}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const addNode = useWorkflowStore((s) => s.addNode);

  const groupedNodes = useMemo(() => {
    return getNodesByCategory();
  }, []);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [cat]: !prev[cat],
    }));
  };

  const handleDragStart = (e: React.DragEvent, nodeType: string) => {
    e.dataTransfer.setData('application/reactflow', nodeType);
    e.dataTransfer.effectAllowed = 'move';
  };

  const filteredCategories = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return groupedNodes;

    const result: Record<string, typeof NODE_DEFINITIONS[string][]> = {};
    for (const [category, nodes] of Object.entries(groupedNodes)) {
      const filtered = nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(term) ||
          n.type.toLowerCase().includes(term) ||
          n.description.toLowerCase().includes(term)
      );
      if (filtered.length > 0) {
        result[category] = filtered;
      }
    }
    return result;
  }, [groupedNodes, searchTerm]);

  return (
    <aside className="w-72 h-full bg-surface border-r border-border flex flex-col overflow-hidden select-none">
      {/* Search Header */}
      <div className="p-3.5 border-b border-border space-y-2.5 bg-surface">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
            <h2 className="text-sm font-bold text-white tracking-wide">Thư viện Node</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-text-muted bg-surface-2 px-2 py-0.5 rounded">
              {Object.keys(NODE_DEFINITIONS).length} nodes
            </span>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded text-text-muted hover:text-white hover:bg-surface-2 transition-colors"
                title="Đóng Thư viện Node"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-text-muted" />
          <input
            type="text"
            placeholder="Tìm kiếm node..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full text-xs rounded-lg bg-bg border border-border pl-9 pr-3 py-2 text-text placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
          />
        </div>
      </div>

      {/* Categories & Nodes list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
        {Object.entries(filteredCategories).map(([catKey, nodes]) => {
          const category = catKey as NodeCategory;
          const catStyle = CATEGORY_STYLES[category] || CATEGORY_STYLES.logic;
          const IconComp = CATEGORY_ICONS[category] || Layers;
          const isCollapsed = Boolean(collapsedCategories[catKey]);

          return (
            <div key={catKey} className="rounded-md border border-border bg-surface overflow-hidden">
              {/* Category Accordion Header */}
              <button
                onClick={() => toggleCategory(catKey)}
                className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-surface-2 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <IconComp className="w-3.5 h-3.5 text-text-muted" />
                  <span className="text-xs font-semibold text-text">
                    {catStyle.label}
                  </span>
                  <span className="text-[10px] font-mono text-text-muted">
                    ({nodes.length})
                  </span>
                </div>
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                )}
              </button>

              {/* Node Items */}
              {!isCollapsed && (
                <div className="p-1.5 pt-0 space-y-1">
                  {nodes.map((node) => (
                    <div
                      key={node.type}
                      draggable
                      onDragStart={(e) => handleDragStart(e, node.type)}
                      className="group flex items-center justify-between p-2 rounded-lg bg-bg hover:bg-surface-2 border border-border hover:border-indigo-500/50 cursor-grab active:cursor-grabbing transition-all text-text hover:text-white"
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        <GripVertical className="w-3 h-3 text-text-faint group-hover:text-text-muted shrink-0" />
                        <div className="truncate">
                          <div className="text-xs font-medium truncate">
                            {node.label}
                          </div>
                          <div className="text-[10px] text-text-muted truncate" title={node.description}>
                            {node.description}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          addNode(node.type);
                        }}
                        title="Thêm vào giữa Canvas"
                        className="p-1 rounded bg-surface group-hover:bg-indigo-600 text-text-muted group-hover:text-white transition-colors shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {Object.keys(filteredCategories).length === 0 && (
          <div className="text-center py-8 text-xs text-text-muted">
            Không tìm thấy node phù hợp với "{searchTerm}"
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="p-3 border-t border-border bg-bg text-[11px] text-text-muted flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
        <span>Kéo-thả hoặc bấm (+) để đưa node vào canvas</span>
      </div>
    </aside>
  );
}
