import type { WorkflowGraph } from '../../types/workflow';

export interface WorkflowPreset {
  id: string;
  name: string;
  description: string;
  graph: WorkflowGraph;
}

export const WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    id: 'preset-basic-veo',
    name: 'Sinh Video Google Veo cơ bản',
    description: 'Quy trình cơ bản: Viết prompt -> Sinh video bằng Google Veo / Flow -> Xuất video và chuyển sang Sub Mode.',
    graph: {
      id: 'graph-preset-basic-veo',
      name: 'Sinh Video Google Veo cơ bản',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        {
          id: 'node-prompt-1',
          type: 'genericNode',
          position: { x: 80, y: 150 },
          data: {
            nodeType: 'text-prompt',
            category: 'input',
            label: 'Text Prompt (Kịch bản)',
            config: {
              prompt: 'A cinematic drone shot flying over a bustling neon night market in Hanoi, vibrant colors, steam rising from food stalls, 4k 60fps',
              negativePrompt: 'blurry, low quality, distorted, cartoon',
            },
          },
        },
        {
          id: 'node-veo-1',
          type: 'genericNode',
          position: { x: 500, y: 120 },
          data: {
            nodeType: 'google-flow-video',
            category: 'model',
            label: 'Google Flow / Veo Video',
            config: {
              modelVariant: 'veo-2.0-generate-001',
              durationSeconds: 5,
              aspectRatio: '16:9',
              fps: 24,
              seed: 42,
            },
          },
        },
        {
          id: 'node-export-1',
          type: 'genericNode',
          position: { x: 920, y: 80 },
          data: {
            nodeType: 'export-video',
            category: 'output',
            label: 'Xuất Video (MP4 Master)',
            config: {
              fileName: 'Hanoi_Night_Market_Veo.mp4',
              format: 'mp4',
              bitrate: 'high',
            },
          },
        },
        {
          id: 'node-submode-1',
          type: 'genericNode',
          position: { x: 920, y: 280 },
          data: {
            nodeType: 'send-to-sub-mode',
            category: 'output',
            label: 'Chuyển sang Sub Mode',
            config: {
              autoOpenEditor: true,
              taskName: 'Video chợ đêm Hà Nội (Veo)',
            },
          },
        },
      ],
      edges: [
        {
          id: 'e-prompt-veo',
          source: 'node-prompt-1',
          target: 'node-veo-1',
          sourceHandle: 'text',
          targetHandle: 'prompt',
          animated: true,
        },
        {
          id: 'e-veo-export',
          source: 'node-veo-1',
          target: 'node-export-1',
          sourceHandle: 'video',
          targetHandle: 'video_in',
        },
        {
          id: 'e-veo-submode',
          source: 'node-veo-1',
          target: 'node-submode-1',
          sourceHandle: 'video',
          targetHandle: 'video_in',
        },
      ],
    },
  },

  {
    id: 'preset-character-shot-chaining',
    name: 'Last-Frame Chaining & Khóa Nhân vật',
    description: 'Tạo 2 cảnh quay liền mạch giữ nguyên khuôn mặt nhân vật, nối khung cuối Shot 1 vào Shot 2 kèm kiểm tra QC.',
    graph: {
      id: 'graph-preset-character-chaining',
      name: 'Last-Frame Chaining & Khóa Nhân vật',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        {
          id: 'node-char-1',
          type: 'genericNode',
          position: { x: 60, y: 80 },
          data: {
            nodeType: 'character-ref',
            category: 'input',
            label: 'Hồ sơ Nhân vật Chính',
            config: {
              characterName: 'Điệp viên Vanh',
              referenceImageUrl: '',
              gender: 'male',
              ageGroup: '28 tuổi',
            },
          },
        },
        {
          id: 'node-prompt-shot1',
          type: 'genericNode',
          position: { x: 60, y: 300 },
          data: {
            nodeType: 'text-prompt',
            category: 'input',
            label: 'Prompt Shot 1 (Cận cảnh)',
            config: {
              prompt: 'Medium close-up of a handsome Vietnamese agent wearing a dark trenchcoat, standing under rain, looking sideways with intense focus.',
              negativePrompt: 'blurry, smiling, cartoon',
            },
          },
        },
        {
          id: 'node-veo-shot1',
          type: 'genericNode',
          position: { x: 420, y: 150 },
          data: {
            nodeType: 'google-flow-video',
            category: 'model',
            label: 'Veo Video - Shot 1',
            config: {
              modelVariant: 'veo-2.0-generate-001',
              durationSeconds: 4,
              aspectRatio: '16:9',
              fps: 24,
              seed: 1001,
            },
          },
        },
        {
          id: 'node-prompt-shot2',
          type: 'genericNode',
          position: { x: 420, y: 460 },
          data: {
            nodeType: 'text-prompt',
            category: 'input',
            label: 'Prompt Shot 2 (Hành động)',
            config: {
              prompt: 'The agent turns forward, draws a gadget and runs towards the camera in the rainy street.',
              negativePrompt: 'blurry, cartoon, extra limbs',
            },
          },
        },
        {
          id: 'node-veo-shot2',
          type: 'genericNode',
          position: { x: 800, y: 250 },
          data: {
            nodeType: 'google-flow-video',
            category: 'model',
            label: 'Veo Video - Shot 2 (Chained)',
            config: {
              modelVariant: 'veo-2.0-generate-001',
              durationSeconds: 5,
              aspectRatio: '16:9',
              fps: 24,
              seed: 1002,
            },
          },
        },
        {
          id: 'node-qc-1',
          type: 'genericNode',
          position: { x: 800, y: 60 },
          data: {
            nodeType: 'qc-check',
            category: 'consistency',
            label: 'Kiểm duyệt Tính nhất quán (QC Check)',
            config: {
              faceSimilarityThreshold: 85,
              colorTolerance: 15,
              autoReject: true,
            },
          },
        },
        {
          id: 'node-concat-1',
          type: 'genericNode',
          position: { x: 1180, y: 200 },
          data: {
            nodeType: 'concat',
            category: 'editing',
            label: 'Ghép Shot 1 & Shot 2',
            config: {
              transitionDuration: 0.3,
            },
          },
        },
        {
          id: 'node-export-chain',
          type: 'genericNode',
          position: { x: 1500, y: 200 },
          data: {
            nodeType: 'export-video',
            category: 'output',
            label: 'Xuất Master Phim 2 Shot',
            config: {
              fileName: 'Agent_Action_Sequence.mp4',
              format: 'mp4',
              bitrate: 'high',
            },
          },
        },
      ],
      edges: [
        {
          id: 'e-char-veo1',
          source: 'node-char-1',
          target: 'node-veo-shot1',
          sourceHandle: 'character',
          targetHandle: 'character',
        },
        {
          id: 'e-p1-veo1',
          source: 'node-prompt-shot1',
          target: 'node-veo-shot1',
          sourceHandle: 'text',
          targetHandle: 'prompt',
          animated: true,
        },
        {
          id: 'e-char-veo2',
          source: 'node-char-1',
          target: 'node-veo-shot2',
          sourceHandle: 'character',
          targetHandle: 'character',
        },
        {
          id: 'e-lastframe-veo2',
          source: 'node-veo-shot1',
          target: 'node-veo-shot2',
          sourceHandle: 'last_frame',
          targetHandle: 'init_frame',
          animated: true,
        },
        {
          id: 'e-p2-veo2',
          source: 'node-prompt-shot2',
          target: 'node-veo-shot2',
          sourceHandle: 'text',
          targetHandle: 'prompt',
          animated: true,
        },
        {
          id: 'e-qc-shot1',
          source: 'node-veo-shot1',
          target: 'node-qc-1',
          sourceHandle: 'last_frame',
          targetHandle: 'shot_a',
        },
        {
          id: 'e-qc-shot2',
          source: 'node-veo-shot2',
          target: 'node-qc-1',
          sourceHandle: 'last_frame',
          targetHandle: 'shot_b',
        },
        {
          id: 'e-concat-s1',
          source: 'node-veo-shot1',
          target: 'node-concat-1',
          sourceHandle: 'video',
          targetHandle: 'video_a',
        },
        {
          id: 'e-concat-s2',
          source: 'node-veo-shot2',
          target: 'node-concat-1',
          sourceHandle: 'video',
          targetHandle: 'video_b',
        },
        {
          id: 'e-concat-export',
          source: 'node-concat-1',
          target: 'node-export-chain',
          sourceHandle: 'video_out',
          targetHandle: 'video_in',
        },
      ],
    },
  },
];
