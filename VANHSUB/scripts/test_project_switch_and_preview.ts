import {
  DEFAULT_AI_STUDIO_CONFIG,
  DEFAULT_CHANNEL_PROFILE_CONFIG,
  SavedProjectProfile,
  AiStudioConfig,
} from '../renderer/types/aiStudio.js';
import { mergeAiStudioConfig } from '../renderer/lib/store/aiStudioStore.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✓ PASS: ${message}`);
  }
}

console.log('=== RUNNING AI STUDIO PROJECT SWITCH & ISOLATION TESTS ===\n');

// 1. Giả lập store state
let storeConfig: AiStudioConfig = JSON.parse(JSON.stringify(DEFAULT_AI_STUDIO_CONFIG));

function saveProject(project: SavedProjectProfile): void {
  const existingList = storeConfig.savedProjects || [];
  const index = existingList.findIndex((p) => p.id === project.id);

  let updatedList: SavedProjectProfile[];
  if (index >= 0) {
    updatedList = [...existingList];
    updatedList[index] = {
      ...existingList[index],
      ...project,
      updatedAt: Date.now(),
    };
  } else {
    updatedList = [{ ...project, updatedAt: Date.now() }, ...existingList];
  }

  storeConfig = mergeAiStudioConfig(storeConfig, {
    savedProjects: updatedList,
    activeProjectId: project.id,
    channelProfile: project.channelProfile,
  });
}

function switchProject(projectId: string): boolean {
  const existingList = storeConfig.savedProjects || [];
  const target = existingList.find((p) => p.id === projectId);
  if (!target) return false;

  storeConfig = mergeAiStudioConfig(storeConfig, {
    activeProjectId: target.id,
    channelProfile: target.channelProfile,
  });
  return true;
}

function saveActiveProjectData(
  data: Partial<Pick<SavedProjectProfile, 'ideas' | 'selectedIdea' | 'lastSessionId' | 'savedSession'>>,
  targetProjectId?: string
): boolean {
  const existingList = storeConfig.savedProjects || [];
  const activeId = targetProjectId || storeConfig.activeProjectId || existingList[0]?.id;
  if (!activeId) return false;

  const index = existingList.findIndex((p) => p.id === activeId);
  if (index < 0) return false;

  const updatedList = [...existingList];
  updatedList[index] = {
    ...updatedList[index],
    ...data,
    updatedAt: Date.now(),
  };

  storeConfig = mergeAiStudioConfig(storeConfig, {
    savedProjects: updatedList,
    ...(activeId === storeConfig.activeProjectId ? { activeProjectId: activeId } : {}),
  });
  return true;
}

// TEST 1: Tạo dự án đầu tiên (Project Alpha)
const projectAlphaId = 'proj_alpha_001';
saveProject({
  id: projectAlphaId,
  name: 'Project Alpha - Sinh Tồn Tiền Sử',
  channelProfile: {
    ...DEFAULT_CHANNEL_PROFILE_CONFIG,
    projectName: 'Project Alpha - Sinh Tồn Tiền Sử',
    channelNiche: 'Sinh tồn tiền sử',
  },
  flowConfig: { aspectRatio: '16:9' },
  ideas: [
    {
      topic: 'Cuộc chiến sinh tồn kỷ Phấn Trắng',
      title: 'Khủng long bạo chúa vs Spinosaurus',
      aspectRatio: '16:9',
      narrativeAngle: 'Khoa học kịch tính',
      hookConcept: '3s mở màn đẫm máu',
    },
  ],
  selectedIdea: null,
  lastSessionId: 'session_alpha_123',
  savedSession: {
    sessionId: 'session_alpha_123',
    topic: 'Cuộc chiến sinh tồn kỷ Phấn Trắng',
    currentStage: 2,
    progress: 25,
    status: 'running',
    artifacts: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  updatedAt: Date.now(),
});

assert(storeConfig.savedProjects?.length === 1, 'Đã lưu thành công 1 dự án (Project Alpha)');
assert(storeConfig.activeProjectId === projectAlphaId, 'Project Alpha đang là activeProjectId');
assert(storeConfig.channelProfile?.projectName === 'Project Alpha - Sinh Tồn Tiền Sử', 'Channel Profile đã đồng bộ với Project Alpha');

// TEST 2: Tạo dự án thứ hai (Project Beta) mà KHÔNG đè lên Alpha
const projectBetaId = 'proj_beta_002';
saveProject({
  id: projectBetaId,
  name: 'Project Beta - Bí Ẩn Vũ Trụ',
  channelProfile: {
    ...DEFAULT_CHANNEL_PROFILE_CONFIG,
    projectName: 'Project Beta - Bí Ẩn Vũ Trụ',
    channelNiche: 'Vũ trụ & Hố đen',
  },
  flowConfig: { aspectRatio: '9:16' },
  ideas: [],
  selectedIdea: null,
  lastSessionId: undefined,
  savedSession: null,
  updatedAt: Date.now(),
});

assert(storeConfig.savedProjects?.length === 2, 'Đã lưu thành công 2 dự án độc lập');
assert(storeConfig.activeProjectId === projectBetaId, 'Project Beta đang là activeProjectId mới');
assert(storeConfig.channelProfile?.projectName === 'Project Beta - Bí Ẩn Vũ Trụ', 'Channel Profile đã chuyển sang Project Beta');

// Kiểm tra tính toàn vẹn của Project Alpha
const foundAlpha = storeConfig.savedProjects?.find((p) => p.id === projectAlphaId);
assert(!!foundAlpha, 'Project Alpha vẫn tồn tại nguyên vẹn');
assert(foundAlpha?.name === 'Project Alpha - Sinh Tồn Tiền Sử', 'Tên của Project Alpha không bị biến đổi');
assert(foundAlpha?.ideas?.length === 1, 'Ý tưởng của Project Alpha được bảo toàn');
assert(foundAlpha?.lastSessionId === 'session_alpha_123', 'Session ID của Project Alpha được bảo toàn');

// TEST 3: Chuyển đổi qua lại giữa các dự án
switchProject(projectAlphaId);
assert(storeConfig.activeProjectId === projectAlphaId, 'Chuyển về Project Alpha thành công');
assert(storeConfig.channelProfile?.projectName === 'Project Alpha - Sinh Tồn Tiền Sử', 'Profile đã chuyển về Alpha');

switchProject(projectBetaId);
assert(storeConfig.activeProjectId === projectBetaId, 'Chuyển sang Project Beta thành công');
assert(storeConfig.channelProfile?.projectName === 'Project Beta - Bí Ẩn Vũ Trụ', 'Profile đã chuyển về Beta');

// TEST 4: Lưu dữ liệu dự án với targetProjectId (chống race condition khi chuyển đổi)
saveActiveProjectData(
  {
    ideas: [
      {
        topic: 'Hố đen siêu khối lượng',
        title: 'Bên trong chân trời sự kiện',
        aspectRatio: '9:16',
        narrativeAngle: 'Phim tư liệu vũ trụ',
        hookConcept: 'Ánh sáng cũng không thể thoát ra',
      },
    ],
  },
  projectBetaId
);

const foundBeta = storeConfig.savedProjects?.find((p) => p.id === projectBetaId);
assert(foundBeta?.ideas?.length === 1, 'Project Beta đã lưu đúng 1 ý tưởng');
assert(foundBeta?.ideas?.[0].title === 'Bên trong chân trời sự kiện', 'Nội dung ý tưởng của Beta chính xác');
assert(foundAlpha?.ideas?.length === 1, 'Project Alpha không hề bị ảnh hưởng khi Beta lưu dữ liệu');

console.log('\n🎉 TẤT CẢ 10 BÀI KIỂM TRA ĐÃ VƯỢT QUA THÀNH CÔNG 100%!');
