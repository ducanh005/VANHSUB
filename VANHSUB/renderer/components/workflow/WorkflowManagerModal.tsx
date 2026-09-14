import React, { useState } from 'react';
import {
  FolderKanban,
  Trash2,
  RotateCcw,
  AlertTriangle,
  Clock,
  Layers,
  CheckCircle2,
  X,
  ExternalLink,
  Search,
} from 'lucide-react';
import { useWorkflowStore, type SavedWorkflowItem } from '../../lib/store/workflowStore';
import { toast } from 'sonner';

interface WorkflowManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WorkflowManagerModal({ isOpen, onClose }: WorkflowManagerModalProps) {
  const [activeTab, setActiveTab] = useState<'active' | 'trash'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmPermanentId, setConfirmPermanentId] = useState<string | null>(null);
  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);

  const savedWorkflows = useWorkflowStore((s) => s.savedWorkflows);
  const graphId = useWorkflowStore((s) => s.graphId);
  const loadSavedWorkflow = useWorkflowStore((s) => s.loadSavedWorkflow);
  const softDeleteWorkflow = useWorkflowStore((s) => s.softDeleteWorkflow);
  const restoreWorkflow = useWorkflowStore((s) => s.restoreWorkflow);
  const permanentDeleteWorkflow = useWorkflowStore((s) => s.permanentDeleteWorkflow);
  const emptyTrash = useWorkflowStore((s) => s.emptyTrash);

  if (!isOpen) return null;

  const activeList = savedWorkflows.filter((w) => !w.deletedAt);
  const trashList = savedWorkflows.filter((w) => Boolean(w.deletedAt));

  const filteredActive = activeList.filter((w) =>
    w.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredTrash = trashList.filter((w) =>
    w.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleOpenWorkflow = (id: string) => {
    const success = loadSavedWorkflow(id);
    if (success) {
      toast.success('Đã tải workflow lên canvas!');
      onClose();
    } else {
      toast.error('Không thể mở workflow này.');
    }
  };

  const handleConfirmSoftDelete = () => {
    if (!confirmDeleteId) return;
    const target = savedWorkflows.find((w) => w.id === confirmDeleteId);
    softDeleteWorkflow(confirmDeleteId);
    toast.info(`Đã chuyển workflow "${target?.name || ''}" vào Thùng rác (lưu giữ 30 ngày).`);
    setConfirmDeleteId(null);
  };

  const handleConfirmPermanentDelete = () => {
    if (!confirmPermanentId) return;
    const target = savedWorkflows.find((w) => w.id === confirmPermanentId);
    permanentDeleteWorkflow(confirmPermanentId);
    toast.success(`Đã xoá vĩnh viễn workflow "${target?.name || ''}".`);
    setConfirmPermanentId(null);
  };

  const handleConfirmEmptyTrash = () => {
    emptyTrash();
    toast.success('Đã dọn sạch toàn bộ Thùng rác.');
    setShowEmptyTrashConfirm(false);
  };

  const calculateDaysRemaining = (deletedAt?: string) => {
    if (!deletedAt) return 30;
    const deletedTime = new Date(deletedAt).getTime();
    const elapsedDays = Math.floor((Date.now() - deletedTime) / (1000 * 60 * 60 * 24));
    return Math.max(0, 30 - elapsedDays);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <FolderKanban className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Quản Lý Workflow Đã Lưu</h2>
              <p className="text-xs text-slate-400">Danh sách workflow và khu vực thùng rác khôi phục</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector & Search */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800/80 bg-slate-950/40 gap-3">
          <div className="flex items-center gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('active')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'active'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Đang hoạt động ({activeList.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('trash')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'trash'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-950/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Thùng rác ({trashList.length})</span>
            </button>
          </div>

          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm workflow..."
              className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 placeholder:text-slate-500"
            />
          </div>

          {activeTab === 'trash' && trashList.length > 0 && (
            <button
              onClick={() => setShowEmptyTrashConfirm(true)}
              className="px-2.5 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/60 text-xs font-semibold text-rose-300 transition-colors cursor-pointer shrink-0 flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Dọn sạch thùng rác</span>
            </button>
          )}
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3 scrollbar-thin scrollbar-thumb-slate-800">
          {activeTab === 'active' && (
            <>
              {filteredActive.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-500 space-y-2">
                  <FolderKanban className="w-10 h-10 stroke-1" />
                  <p className="text-xs">
                    {searchQuery ? 'Không tìm thấy workflow phù hợp.' : 'Chưa có workflow nào được lưu.'}
                  </p>
                </div>
              ) : (
                filteredActive.map((item) => {
                  const isCurrent = graphId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                        isCurrent
                          ? 'bg-indigo-950/20 border-indigo-800/80'
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`p-2 rounded-lg shrink-0 ${
                            isCurrent
                              ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          <Layers className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white truncate">{item.name}</span>
                            {isCurrent && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 font-medium shrink-0">
                                Đang mở
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                            <span>{item.nodesCount || item.graph?.nodes?.length || 0} nodes</span>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3 text-slate-500" />
                              {new Date(item.updatedAt).toLocaleDateString('vi-VN')} {new Date(item.updatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleOpenWorkflow(item.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-colors cursor-pointer"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Mở</span>
                        </button>

                        <button
                          onClick={() => setConfirmDeleteId(item.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-900/50 transition-colors cursor-pointer"
                          title="Xoá workflow vào Thùng rác"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}

          {activeTab === 'trash' && (
            <>
              {filteredTrash.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-500 space-y-2">
                  <Trash2 className="w-10 h-10 stroke-1" />
                  <p className="text-xs">
                    {searchQuery ? 'Không tìm thấy workflow trong thùng rác.' : 'Thùng rác trống.'}
                  </p>
                </div>
              ) : (
                filteredTrash.map((item) => {
                  const daysLeft = calculateDaysRemaining(item.deletedAt);
                  return (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-xl border border-rose-900/40 bg-rose-950/10 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2 rounded-lg bg-rose-900/20 text-rose-400 border border-rose-800/30 shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-200 line-through truncate opacity-80">
                              {item.name}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-medium shrink-0">
                              Còn {daysLeft} ngày
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                            <span>Đã xoá: {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString('vi-VN') : 'Gần đây'}</span>
                            <span>•</span>
                            <span>{item.nodesCount || item.graph?.nodes?.length || 0} nodes</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => {
                            restoreWorkflow(item.id);
                            toast.success(`Đã khôi phục workflow "${item.name}"!`);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 text-xs font-semibold transition-colors cursor-pointer"
                          title="Khôi phục lại danh sách đang hoạt động"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Khôi phục</span>
                        </button>

                        <button
                          onClick={() => setConfirmPermanentId(item.id)}
                          className="p-1.5 rounded-lg text-rose-400 hover:text-rose-200 hover:bg-rose-900/60 border border-rose-800/40 transition-colors cursor-pointer"
                          title="Xoá vĩnh viễn không thể khôi phục"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>

        {/* Footer Note */}
        <div className="px-6 py-3 border-t border-slate-800 text-[11px] text-slate-500 bg-slate-950 flex items-center justify-between shrink-0">
          <span>Workflow trong Thùng rác sẽ tự động dọn dẹp sau 30 ngày.</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* Confirmation Dialog: Soft Delete */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-100">
          <div className="max-w-md w-full p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Xác nhận chuyển vào Thùng rác?</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Workflow này sẽ được chuyển vào Thùng rác và được lưu giữ trong vòng <b>30 ngày</b>. Bạn có thể khôi phục lại bất kỳ lúc nào trước khi hết hạn.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmSoftDelete}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-950/50 transition-colors cursor-pointer"
              >
                Chuyển vào Thùng rác
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Permanent Delete */}
      {confirmPermanentId && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-100">
          <div className="max-w-md w-full p-5 rounded-2xl bg-slate-900 border border-rose-900/60 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Xoá vĩnh viễn Workflow?</h3>
                <p className="text-xs text-rose-300 mt-1 leading-relaxed">
                  Hành động này <b>không thể hoàn tác</b>. Toàn bộ cấu trúc node và cấu hình của workflow này sẽ bị xoá vĩnh viễn khỏi máy của bạn.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setConfirmPermanentId(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmPermanentDelete}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-950/50 transition-colors cursor-pointer"
              >
                Xoá vĩnh viễn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog: Empty Trash */}
      {showEmptyTrashConfirm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-100">
          <div className="max-w-md w-full p-5 rounded-2xl bg-slate-900 border border-rose-900/60 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Dọn sạch toàn bộ Thùng rác?</h3>
                <p className="text-xs text-rose-300 mt-1 leading-relaxed">
                  Tất cả các workflow trong Thùng rác ({trashList.length} workflow) sẽ bị xoá vĩnh viễn và không thể khôi phục lại.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setShowEmptyTrashConfirm(false)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Hủy
              </button>
              <button
                onClick={handleConfirmEmptyTrash}
                className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md shadow-rose-950/50 transition-colors cursor-pointer"
              >
                Dọn sạch ngay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
