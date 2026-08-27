import Head from 'next/head';
import Link from 'next/link';
import {
  ArrowRight,
  Clock3,
  Cloud,
  Download,
  Film,
  History,
  Keyboard,
  MessageSquareText,
  Mic,
  MousePointerClick,
  Plus,
  Search,
  Settings,
  Sparkles,
  SquareStack,
  Wand2,
} from 'lucide-react';
// import '../styles/globals.css';

type NavItem = {
  label: string;
  icon: typeof HomeIcon;
  active?: boolean;
};

type TaskStatus = 'running' | 'done';

type TaskRow = {
  name: string;
  status: TaskStatus;
  phase: string;
  time: string;
  state: string;
};

const navItems: NavItem[] = [
  { label: 'Trang chủ', icon: HomeIcon, active: true },
  { label: 'Tài xuống', icon: Download },
  { label: 'Phụ đề', icon: Film },
  { label: 'Hiệu đính', icon: MessageSquareText },
  { label: 'Xuất video', icon: SquareStack },
  { label: 'Lồng tiếng', icon: Mic },
  { label: 'Cài đặt', icon: Settings },
];

const recipeCards = [
  {
    title: 'Video → Được lồng tiếng',
    subtitle: 'Đọc chính tả, dịch, lồng tiếng cho video',
    accent: 'from-violet-500/25 to-violet-500/5',
    icon: Sparkles,
    active: true,
  },
  {
    title: 'Video → Phụ đề song ngữ',
    subtitle: 'Phối hợp AI và bản dịch để tạo phụ đề',
    accent: 'from-cyan-500/25 to-cyan-500/5',
    icon: Wand2,
  },
  {
    title: 'Video → Phụ đề gốc',
    subtitle: 'Chỉ cần gốc nội dung và tự động phụ đề',
    accent: 'from-emerald-500/25 to-emerald-500/5',
    icon: Film,
  },
];

const taskRows: TaskRow[] = [
  { name: 'temp_translated.srt', status: 'running', phase: 'lồng tiếng', time: '08-22 23:48', state: 'Đã hoàn thành' },
  { name: 'temp_translated.srt', status: 'running', phase: 'lồng tiếng', time: '08-22 23:48', state: 'Đã hoàn thành' },
  { name: 'temp_translated.srt', status: 'running', phase: 'lồng tiếng', time: '08-22 23:48', state: 'Đã hoàn thành' },
  { name: 'temp_translated.srt', status: 'done', phase: 'lồng tiếng', time: '08-20 14:38', state: 'Đã hoàn thành' },
];

const tips = [
  { label: 'Tìm kiếm', icon: Search, shortcut: 'Ctrl K' },
  { label: 'Kéo thả tập video thả vào đây', icon: MousePointerClick, shortcut: null },
  { label: 'Phím tắt', icon: Keyboard, shortcut: '?' },
  { label: 'Cài đặt', icon: Settings, shortcut: 'Ctrl ,' },
];

const toolItems = [
  { label: 'Tải xuống video', icon: Download, detail: 'Dán link để tải xuống hoặc kéo thả video' },
  { label: 'Hiệu đính phụ đề', icon: MessageSquareText, detail: 'Kiểm tra và sửa từng câu' },
  { label: 'Tổng hợp video', icon: SquareStack, detail: 'Gộp phụ đề vào video' },
  { label: 'Lồng tiếng', icon: Mic, detail: 'Phụ đề + voiceover ai' },
];

function HomeIcon(props: { className?: string }) {
  return <span {...props} className={props.className ?? 'h-4 w-4'}>⌂</span>;
}

function StatusDot({ done }: { done?: boolean }) {
  return (
    <span
      className={done ? 'h-2.5 w-2.5 rounded-full bg-emerald-400' : 'h-2.5 w-2.5 rounded-full bg-amber-400'}
    />
  );
}

export default function HomePage() {
  return (
    <>
      <Head>
        <title>VANHSUB</title>
      </Head>

      <div className="min-h-screen bg-[#0b1017] text-slate-100">
        <div className="flex h-screen overflow-hidden">
          <aside className="w-[220px] border-r border-slate-800 bg-[#0d141d] px-4 py-4">
            <div className="mb-6 flex items-center gap-3 px-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-600/20 text-sky-400">
                <Film className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold text-slate-100">VANHSUB</div>
            </div>

            <nav className="space-y-1">
              {navItems.map(({ label, icon: Icon, active }) => (
                <button
                  key={label}
                  type="button"
                  className={[
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition',
                    active ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/70 hover:text-white',
                  ].join(' ')}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                </button>
              ))}
            </nav>

            <div className="mt-8 rounded-lg border border-slate-800 bg-slate-900/30 px-3 py-2 text-xs text-slate-400">
              <div className="mb-2 flex items-center justify-between">
                <span>Engine</span>
                <span className="text-emerald-400">Online</span>
              </div>
              <div className="text-slate-300">GPU: Vulkan</div>
            </div>
          </aside>

          <main className="flex-1 overflow-hidden bg-[#0d151d]">
            <header className="flex items-center justify-between border-b border-slate-800 bg-[#0b1118] px-5 py-3">
              <div className="flex flex-1 items-center gap-3">
                <div className="text-lg font-semibold text-white">Trang chủ</div>
                <div className="flex flex-1 items-center justify-center px-6">
                  <div className="flex w-full max-w-xl items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-slate-400">
                    <Search className="h-4 w-4" />
                    <input
                      aria-label="Tìm kiếm"
                      value="Tìm kiếm hoạt động..."
                      readOnly
                      className="w-full bg-transparent text-sm text-slate-300 placeholder:text-slate-500 focus:outline-none"
                    />
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">Ctrl K</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button type="button" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300">
                  Vulkan Tăng tốc
                </button>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-300">⚙</div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-300">◌</div>
              </div>
            </header>

            <div className="grid h-[calc(100vh-77px)] grid-cols-[minmax(0,1fr)_340px] gap-4 p-4">
              <section className="min-h-0 overflow-hidden rounded-2xl border border-slate-800 bg-[#0f1722] p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-semibold text-white">chào buổi tối</h1>
                    <p className="mt-1 text-sm text-slate-400">Tuesday, August 25 · Chọn một tác vụ để bắt đầu</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-300">
                    <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1">5 nhiệm vụ</span>
                    <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1">5 đã hoàn thành</span>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  {recipeCards.map(({ title, subtitle, accent, icon: Icon, active }) => (
                    <div
                      key={title}
                      className={[
                        'relative overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-br p-4',
                        active ? 'border-sky-500/40 bg-sky-500/10' : 'bg-slate-900/70',
                        accent,
                      ].join(' ')}
                    >
                      <div className="absolute right-3 top-3 text-slate-500/50">
                        <Icon className="h-10 w-10" />
                      </div>
                      <div className="mt-2 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900/70 text-sky-400 ring-1 ring-slate-700">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="mt-6 text-[13px] font-medium text-white">{title}</div>
                      <div className="mt-2 text-xs leading-5 text-slate-300">{subtitle}</div>
                      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-sky-500/40 bg-slate-900/60 px-2.5 py-1 text-[11px] text-sky-300">
                        <span>Cần mô hình</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-2xl border border-dashed border-sky-500/40 bg-slate-950/40 p-6 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-sky-500/40 bg-slate-900 text-sky-400">
                    <Plus className="h-5 w-5" />
                  </div>
                  <div className="text-base font-medium text-white">Quy trình tùy chỉnh</div>
                  <div className="mt-2 text-sm text-slate-400">Mở trình hướng dẫn để gắn video + phụ đề hoặc tự chọn workflow.</div>
                </div>

                <div className="mt-5 rounded-2xl border border-slate-800 bg-[#111a24] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-base font-semibold text-white">Nhiệm vụ gần đây</h2>
                    <button type="button" className="text-sm text-sky-400">Xem tất cả</button>
                  </div>

                  <div className="space-y-2">
                    {taskRows.map((task, index) => (
                      <div
                        key={`${task.name}-${index}`}
                        className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-3 text-sm"
                      >
                        <div className="flex items-center gap-3">
                          <StatusDot done={task.status === 'done'} />
                          <span className="text-slate-200">{task.name}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-400">
                          <span>{task.phase}</span>
                          <span>{task.time}</span>
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                            {task.state}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <aside className="space-y-4 overflow-hidden rounded-2xl border border-slate-800 bg-[#0f1722] p-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">Sẵn sàng mô hình</div>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">sẵn sàng</span>
                  </div>

                  <div className="space-y-2 text-sm text-slate-300">
                    <div className="flex items-center justify-between">
                      <span>Vulkan</span>
                      <span className="text-emerald-300">Bật</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>GPU</span>
                      <span className="text-slate-300">NVIDIA RTX</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Nhân bản AI</span>
                      <span className="text-sky-300">5 dịch vụ</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                  <div className="mb-3 text-sm font-semibold text-white">Hộp công cụ</div>
                  <div className="space-y-2">
                    {toolItems.map(({ label, icon: Icon, detail }) => (
                      <div key={label} className="flex items-center gap-3 rounded-xl p-2 hover:bg-slate-800/80">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800 text-sky-300">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white">{label}</div>
                          <div className="truncate text-[11px] text-slate-400">{detail}</div>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                  <div className="mb-3 text-sm font-semibold text-white">Mẹo nhanh</div>
                  <div className="space-y-2">
                    {tips.map(({ label, icon: Icon, shortcut }) => (
                      <div key={label} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-slate-800/80">
                        <div className="flex items-center gap-2 text-sm text-slate-300">
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-800 text-slate-300">
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span>{label}</span>
                        </div>
                        {shortcut && (
                          <kbd className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[10px] text-slate-300">
                            {shortcut}
                          </kbd>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}

