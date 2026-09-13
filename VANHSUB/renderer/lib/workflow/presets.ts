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
              modelVariant: 'veo-3.1-quality',
              qualityPreset: 'quality',
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
              modelVariant: 'veo-3.1-quality',
              qualityPreset: 'quality',
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
              modelVariant: 'veo-3.1-quality',
              qualityPreset: 'quality',
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
  {
    id: 'preset-mspaint-storytelling',
    name: 'MS Paint Meme: Ảo Tưởng YouTuber Mới',
    description: 'Quy trình sản xuất video kể chuyện dài phong cách MS Paint Meme: Node Master Style toàn bộ video -> Kịch bản 4 hồi -> Khóa nhân vật Bob -> Sinh Keyframe thô sơ biểu cảm -> Hàng đợi chống spam -> Diễn hoạt Veo 3.1 Lite -> Chuyển sang Sub Mode lồng tiếng TTS & Phụ đề Karaoke.',
    graph: {
      id: 'graph-preset-mspaint-storytelling',
      name: 'MS Paint Meme: Ảo Tưởng YouTuber Mới (5-6 Phút)',
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [
        {
          id: 'node-script-master',
          type: 'genericNode',
          position: { x: 50, y: 50 },
          data: {
            nodeType: 'text-prompt',
            category: 'input',
            label: 'Kịch bản Kể Chuyện (Script & VO)',
            config: {
              prompt: 'Kịch bản 5-6 phút: Ảo tưởng của những người mới xây kênh YouTube. Từ hưng phấn lúc 11h đêm, tính tiền mua xe Mec, đến cú tát 4 views lúc 8h sáng.',
              negativePrompt: 'photorealistic, 3d render, detailed shading, professional digital art, beautiful gradient',
            },
          },
        },
        {
          id: 'node-master-style',
          type: 'genericNode',
          position: { x: 50, y: 360 },
          data: {
            nodeType: 'style-lock',
            category: 'consistency',
            label: 'Phong Cách Toàn Bộ Video (Master Style: MS Paint Meme)',
            config: {
              stylePrompt:
                '[CHARACTER] illustrated in a crude amateur MS Paint cartoon style. Intentionally awkward anatomy, exaggerated proportions, oversized head, simplified body, rough uneven black outlines, messy hand-drawn linework, imperfect curves, scribbled details, inconsistent stroke thickness. Flat vivid colors, solid color blocks, almost no shading, no gradients. Goofy exaggerated facial expression, absurd humorous appearance, simple recognizable features. Looks like a low-budget internet meme drawing made in MS Paint, intentionally crude and poorly drawn but highly expressive. White plain background, centered composition, isolated character, 2D flat illustration, low resolution, rough edges, amateur digital doodle, chaotic sketch lines, no realism, no 3D rendering, no photorealism. 1:1 square composition.',
              negativePrompt:
                'photorealistic, 3D render, smooth shading, professional digital art, realistic gradients, realistic human proportions, high definition',
              colorPalette: 'flat_vivid',
              lensType: 'flat_2d',
            },
          },
        },
        {
          id: 'node-character-ref',
          type: 'genericNode',
          position: { x: 50, y: 720 },
          data: {
            nodeType: 'character-ref',
            category: 'input',
            label: 'Nhân Vật Chủ Đạo (Bob - YouTuber Mới)',
            config: {
              characterName: 'Newbie YouTuber Bob',
              description:
                'Chàng trai ngáo ngơ hài hước phong cách vẽ tay MS Paint meme: mắt to tròn lồi như mất ngủ, đầu to người nhỏ, mặc vest đen xộc xệch hoặc áo phông đơn giản, nét vẽ nguệch ngoạc ngu ngốc nhưng vô cùng biểu cảm.',
              referenceImageUrl: '',
              gender: 'male',
              ageGroup: 'Crude MS Paint Doodle',
            },
          },
        },
        {
          id: 'node-keyframe-hook',
          type: 'genericNode',
          position: { x: 480, y: 80 },
          data: {
            nodeType: 'google-imagen',
            category: 'model',
            label: 'Keyframe 1 (Hook: F5 Điên Cuồng)',
            config: {
              imageEngine: 'banana-pro',
              prompt: 'A funny clumsy newbie YouTuber character Bob with crazy bloodshot eyes staring at a computer screen in a dark room, goofy grinning face, pressing F5 frantically, 1:1 square composition.',
              aspectRatio: '1:1',
            },
          },
        },
        {
          id: 'node-veo-hook',
          type: 'genericNode',
          position: { x: 880, y: 80 },
          data: {
            nodeType: 'google-flow-video',
            category: 'model',
            label: 'Veo 3.1 - Shot 1 (Hook F5)',
            config: {
              modelVariant: 'veo-3.1-lite',
              qualityPreset: 'lite',
              durationSeconds: 5,
              aspectRatio: '1:1',
              fps: 24,
              seed: 2001,
            },
          },
        },
        {
          id: 'node-queue-1',
          type: 'genericNode',
          position: { x: 880, y: 240 },
          data: {
            nodeType: 'queue-gate',
            category: 'logic',
            label: 'Hàng Đợi Chống Spam 1 (Delay 20s)',
            config: {
              delaySeconds: 20,
              mode: 'fixed_delay',
            },
          },
        },
        {
          id: 'node-keyframe-delusion',
          type: 'genericNode',
          position: { x: 480, y: 380 },
          data: {
            nodeType: 'google-imagen',
            category: 'model',
            label: 'Keyframe 2 (Hồi 1: Nút Vàng & Siêu Xe)',
            config: {
              imageEngine: 'banana-pro',
              prompt: 'The goofy character Bob wearing a messy ill-fitting black suit, proudly holding a giant shiny golden YouTube play button plaque, childish crudely drawn dollar bills raining down, absurd triumphant grin, 1:1 square.',
              aspectRatio: '1:1',
            },
          },
        },
        {
          id: 'node-veo-delusion',
          type: 'genericNode',
          position: { x: 880, y: 380 },
          data: {
            nodeType: 'google-flow-video',
            category: 'model',
            label: 'Veo 3.1 - Shot 2 (Ảo Tưởng Nút Vàng)',
            config: {
              modelVariant: 'veo-3.1-lite',
              qualityPreset: 'lite',
              durationSeconds: 5,
              aspectRatio: '1:1',
              fps: 24,
              seed: 2002,
            },
          },
        },
        {
          id: 'node-queue-2',
          type: 'genericNode',
          position: { x: 880, y: 540 },
          data: {
            nodeType: 'queue-gate',
            category: 'logic',
            label: 'Hàng Đợi Chống Spam 2 (Delay 20s)',
            config: {
              delaySeconds: 20,
              mode: 'fixed_delay',
            },
          },
        },
        {
          id: 'node-keyframe-reality',
          type: 'genericNode',
          position: { x: 480, y: 680 },
          data: {
            nodeType: 'google-imagen',
            category: 'model',
            label: 'Keyframe 3 (Hồi 2: Thực Tế 4 Views)',
            config: {
              imageEngine: 'banana-pro',
              prompt: 'The goofy character Bob waking up in morning, looking at smartphone with totally hollow dead soulless eyes, jaw dropped in shock, small comical blue tear dripping, big text on screen saying "4 VIEWS", 1:1 square.',
              aspectRatio: '1:1',
            },
          },
        },
        {
          id: 'node-veo-reality',
          type: 'genericNode',
          position: { x: 880, y: 680 },
          data: {
            nodeType: 'google-flow-video',
            category: 'model',
            label: 'Veo 3.1 - Shot 3 (Cú Tát Thực Tế)',
            config: {
              modelVariant: 'veo-3.1-lite',
              qualityPreset: 'lite',
              durationSeconds: 5,
              aspectRatio: '1:1',
              fps: 24,
              seed: 2003,
            },
          },
        },
        {
          id: 'node-concat-master',
          type: 'genericNode',
          position: { x: 1280, y: 380 },
          data: {
            nodeType: 'concat',
            category: 'editing',
            label: 'Ghép Master Sequence',
            config: {
              transitionDuration: 0.2,
            },
          },
        },
        {
          id: 'node-submode-master',
          type: 'genericNode',
          position: { x: 1600, y: 380 },
          data: {
            nodeType: 'send-to-sub-mode',
            category: 'output',
            label: 'Chuyển Sub Mode (TTS + Sub Karaoke)',
            config: {
              autoOpenEditor: true,
              taskName: 'Video MS Paint: Ảo Tưởng YouTuber Mới',
            },
          },
        },
      ],
      edges: [
        // Kịch bản nối vào Keyframe 1
        {
          id: 'e-script-kf1',
          source: 'node-script-master',
          target: 'node-keyframe-hook',
          sourceHandle: 'text',
          targetHandle: 'prompt',
          animated: true,
        },
        // Master Style Lock nối vào 3 Keyframe
        {
          id: 'e-style-kf1',
          source: 'node-master-style',
          target: 'node-keyframe-hook',
          sourceHandle: 'style_out',
          targetHandle: 'style',
          animated: true,
        },
        {
          id: 'e-style-kf2',
          source: 'node-master-style',
          target: 'node-keyframe-delusion',
          sourceHandle: 'style_out',
          targetHandle: 'style',
          animated: true,
        },
        {
          id: 'e-style-kf3',
          source: 'node-master-style',
          target: 'node-keyframe-reality',
          sourceHandle: 'style_out',
          targetHandle: 'style',
          animated: true,
        },
        // Master Style Lock nối vào 3 Shot Veo
        {
          id: 'e-style-veo1',
          source: 'node-master-style',
          target: 'node-veo-hook',
          sourceHandle: 'style_out',
          targetHandle: 'style',
          animated: true,
        },
        {
          id: 'e-style-veo2',
          source: 'node-master-style',
          target: 'node-veo-delusion',
          sourceHandle: 'style_out',
          targetHandle: 'style',
          animated: true,
        },
        {
          id: 'e-style-veo3',
          source: 'node-master-style',
          target: 'node-veo-reality',
          sourceHandle: 'style_out',
          targetHandle: 'style',
          animated: true,
        },
        // Khóa nhân vật nối vào 3 Keyframe
        {
          id: 'e-char-kf1',
          source: 'node-character-ref',
          target: 'node-keyframe-hook',
          sourceHandle: 'character',
          targetHandle: 'character',
        },
        {
          id: 'e-char-kf2',
          source: 'node-character-ref',
          target: 'node-keyframe-delusion',
          sourceHandle: 'character',
          targetHandle: 'character',
        },
        {
          id: 'e-char-kf3',
          source: 'node-character-ref',
          target: 'node-keyframe-reality',
          sourceHandle: 'character',
          targetHandle: 'character',
        },
        // Keyframe -> Veo Shot
        {
          id: 'e-kf1-veo1',
          source: 'node-keyframe-hook',
          target: 'node-veo-hook',
          sourceHandle: 'image',
          targetHandle: 'init_frame',
          animated: true,
        },
        {
          id: 'e-kf2-veo2',
          source: 'node-keyframe-delusion',
          target: 'node-veo-delusion',
          sourceHandle: 'image',
          targetHandle: 'init_frame',
          animated: true,
        },
        {
          id: 'e-kf3-veo3',
          source: 'node-keyframe-reality',
          target: 'node-veo-reality',
          sourceHandle: 'image',
          targetHandle: 'init_frame',
          animated: true,
        },
        // Hàng đợi chống spam tuần tự giữa các Shot Veo
        {
          id: 'e-veo1-queue1',
          source: 'node-veo-hook',
          target: 'node-queue-1',
          sourceHandle: 'video',
          targetHandle: 'in',
          animated: true,
        },
        {
          id: 'e-queue1-veo2',
          source: 'node-queue-1',
          target: 'node-veo-delusion',
          sourceHandle: 'out',
          targetHandle: 'queue_trigger',
          animated: true,
        },
        {
          id: 'e-veo2-queue2',
          source: 'node-veo-delusion',
          target: 'node-queue-2',
          sourceHandle: 'video',
          targetHandle: 'in',
          animated: true,
        },
        {
          id: 'e-queue2-veo3',
          source: 'node-queue-2',
          target: 'node-veo-reality',
          sourceHandle: 'out',
          targetHandle: 'queue_trigger',
          animated: true,
        },
        // Ghép 3 shot vào Master Concat
        {
          id: 'e-veo1-concat',
          source: 'node-veo-hook',
          target: 'node-concat-master',
          sourceHandle: 'video',
          targetHandle: 'video_a',
        },
        {
          id: 'e-veo2-concat',
          source: 'node-veo-delusion',
          target: 'node-concat-master',
          sourceHandle: 'video',
          targetHandle: 'video_b',
        },
        {
          id: 'e-veo3-concat',
          source: 'node-veo-reality',
          target: 'node-concat-master',
          sourceHandle: 'video',
          targetHandle: 'video_c',
        },
        // Chuyển sang Sub Mode
        {
          id: 'e-concat-submode',
          source: 'node-concat-master',
          target: 'node-submode-master',
          sourceHandle: 'video_out',
          targetHandle: 'video_in',
        },
      ],
    },
  },
];
