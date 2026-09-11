import type { NodeDefinition } from '../../types/workflow';

export const NODE_DEFINITIONS: Record<string, NodeDefinition> = {
  // ==========================================
  // 1. INPUT NODES
  // ==========================================
  'text-prompt': {
    type: 'text-prompt',
    category: 'input',
    label: 'Text Prompt',
    description: 'Văn bản mô tả nội dung hoặc kịch bản chi tiết cần sinh.',
    inputs: [],
    outputs: [
      { id: 'text', label: 'Prompt', dataType: 'text', description: 'Chuỗi văn bản prompt' },
    ],
    configSchema: {
      prompt: {
        type: 'textarea',
        label: 'Nội dung Prompt',
        description: 'Mô tả chi tiết hình ảnh hoặc cảnh quay muốn tạo',
        defaultValue: 'Cinematic shot of a cyberpunk city street at night, neon lights reflecting on wet asphalt, 8k masterpiece',
        placeholder: 'Nhập prompt...',
      },
      negativePrompt: {
        type: 'textarea',
        label: 'Negative Prompt',
        description: 'Các yếu tố muốn loại bỏ khỏi kết quả',
        defaultValue: 'blurry, low quality, distorted, artifacts',
        placeholder: 'Nhập negative prompt...',
      },
    },
    defaultData: {
      prompt: 'Cinematic shot of a cyberpunk city street at night, neon lights reflecting on wet asphalt, 8k masterpiece',
      negativePrompt: 'blurry, low quality, distorted, artifacts',
    },
  },

  'load-image': {
    type: 'load-image',
    category: 'input',
    label: 'Tải Ảnh (Load Image)',
    description: 'Nạp hình ảnh tham chiếu từ ổ cứng hoặc đường dẫn URL.',
    inputs: [],
    outputs: [
      { id: 'image', label: 'Hình ảnh', dataType: 'image', description: 'Dữ liệu hình ảnh tải vào' },
    ],
    configSchema: {
      sourceUrl: {
        type: 'file',
        label: 'Đường dẫn / Tệp ảnh',
        description: 'Chọn ảnh từ máy tính hoặc dán URL ảnh tham chiếu',
        defaultValue: '',
      },
      aspectRatio: {
        type: 'select',
        label: 'Tỷ lệ khung hình',
        defaultValue: '16:9',
        options: [
          { label: '16:9 (Ngang - Cinema/YouTube)', value: '16:9' },
          { label: '9:16 (Dọc - TikTok/Reels)', value: '9:16' },
          { label: '1:1 (Vuông - Avatar)', value: '1:1' },
          { label: '4:3 (Truyền hình cổ điển)', value: '4:3' },
          { label: '21:9 (Ultrawide)', value: '21:9' },
        ],
      },
    },
    defaultData: {
      sourceUrl: '',
      aspectRatio: '16:9',
    },
  },

  'load-video': {
    type: 'load-video',
    category: 'input',
    label: 'Tải Video (Load Video)',
    description: 'Nạp tệp video có sẵn để thực hiện hậu kỳ, upscale hoặc cắt ghép.',
    inputs: [],
    outputs: [
      { id: 'video', label: 'Video', dataType: 'video', description: 'Dữ liệu video đầu vào' },
      { id: 'last_frame', label: 'Khung hình cuối', dataType: 'image', description: 'Last frame của video' },
    ],
    configSchema: {
      videoUrl: {
        type: 'file',
        label: 'Tệp video nguồn',
        defaultValue: '',
      },
      loop: {
        type: 'boolean',
        label: 'Lặp lại video',
        defaultValue: false,
      },
    },
    defaultData: {
      videoUrl: '',
      loop: false,
    },
  },

  'character-ref': {
    type: 'character-ref',
    category: 'input',
    label: 'Hồ sơ Nhân vật (Character Ref)',
    description: 'Chọn nhân vật từ Character Bible để khóa khuôn mặt và trang phục.',
    inputs: [],
    outputs: [
      { id: 'character', label: 'Nhân vật', dataType: 'character_ref', description: 'Gói định danh nhân vật' },
      { id: 'face_image', label: 'Ảnh khuôn mặt', dataType: 'image', description: 'Ảnh chân dung tham chiếu' },
    ],
    configSchema: {
      characterName: {
        type: 'string',
        label: 'Tên nhân vật',
        defaultValue: 'Nhân vật chính',
      },
      referenceImageUrl: {
        type: 'file',
        label: 'Ảnh mẫu chân dung',
        defaultValue: '',
      },
      gender: {
        type: 'select',
        label: 'Giới tính',
        defaultValue: 'male',
        options: [
          { label: 'Nam', value: 'male' },
          { label: 'Nữ', value: 'female' },
          { label: 'Khác', value: 'other' },
        ],
      },
      ageGroup: {
        type: 'string',
        label: 'Độ tuổi / Nhận dạng',
        defaultValue: '25-30 tuổi',
      },
    },
    defaultData: {
      characterName: 'Nhân vật chính',
      referenceImageUrl: '',
      gender: 'male',
      ageGroup: '25-30 tuổi',
    },
  },

  'scene-ref': {
    type: 'scene-ref',
    category: 'input',
    label: 'Bối cảnh (Scene Ref)',
    description: 'Định nghĩa bối cảnh không gian, ánh sáng và kiến trúc đồng bộ.',
    inputs: [],
    outputs: [
      { id: 'scene', label: 'Bối cảnh', dataType: 'scene_ref', description: 'Dữ liệu bối cảnh tham chiếu' },
    ],
    configSchema: {
      sceneName: {
        type: 'string',
        label: 'Tên bối cảnh',
        defaultValue: 'Phòng thí nghiệm tương lai',
      },
      environment: {
        type: 'select',
        label: 'Môi trường',
        defaultValue: 'indoor',
        options: [
          { label: 'Trong nhà (Indoor)', value: 'indoor' },
          { label: 'Ngoài trời (Outdoor)', value: 'outdoor' },
          { label: 'Vũ trụ / Ảo (Sci-fi Space)', value: 'space' },
        ],
      },
      lightingMood: {
        type: 'string',
        label: 'Ánh sáng & Màu sắc chủ đạo',
        defaultValue: 'Moody neon cyan and amber, soft volumetric fog',
      },
    },
    defaultData: {
      sceneName: 'Phòng thí nghiệm tương lai',
      environment: 'indoor',
      lightingMood: 'Moody neon cyan and amber, soft volumetric fog',
    },
  },

  'camera-path': {
    type: 'camera-path',
    category: 'input',
    label: 'Đường đi Camera (Camera Path)',
    description: 'Chỉ định chuyển động quay phim (Pan, Tilt, Zoom, Orbit).',
    inputs: [],
    outputs: [
      { id: 'camera_control', label: 'Điều khiển Camera', dataType: 'any', description: 'Vector chuyển động camera' },
    ],
    configSchema: {
      motionType: {
        type: 'select',
        label: 'Kiểu chuyển động',
        defaultValue: 'pan_right',
        options: [
          { label: 'Tĩnh (Static Shot)', value: 'static' },
          { label: 'Lia phải (Pan Right)', value: 'pan_right' },
          { label: 'Lia trái (Pan Left)', value: 'pan_left' },
          { label: 'Góc ngước (Tilt Up)', value: 'tilt_up' },
          { label: 'Góc chúi (Tilt Down)', value: 'tilt_down' },
          { label: 'Tiến tới (Zoom / Dolly In)', value: 'zoom_in' },
          { label: 'Lùi ra (Zoom / Dolly Out)', value: 'zoom_out' },
          { label: 'Xoay quanh (Orbit 360)', value: 'orbit' },
        ],
      },
      speed: {
        type: 'slider',
        label: 'Tốc độ chuyển động',
        defaultValue: 5,
        min: 1,
        max: 10,
        step: 1,
      },
    },
    defaultData: {
      motionType: 'pan_right',
      speed: 5,
    },
  },

  // ==========================================
  // 2. MODEL NODES
  // ==========================================
  'google-flow-video': {
    type: 'google-flow-video',
    category: 'model',
    label: 'Google Flow / Veo Video',
    description: 'Sinh video thế hệ mới bằng Google Veo / Flow thông qua Gemini API.',
    inputs: [
      { id: 'prompt', label: 'Prompt', dataType: 'text', description: 'Kịch bản câu lệnh' },
      { id: 'init_frame', label: 'Khung hình đầu (Init Frame)', dataType: 'image', description: 'Khung tham chiếu hoặc last-frame shot trước' },
      { id: 'character', label: 'Nhân vật (Lock)', dataType: 'character_ref', description: 'Khóa nhân vật' },
      { id: 'camera', label: 'Camera Path', dataType: 'any', description: 'Đường chuyển động máy quay' },
    ],
    outputs: [
      { id: 'video', label: 'Video Clip', dataType: 'video', description: 'Video hoàn thành' },
      { id: 'last_frame', label: 'Khung cuối (Last Frame)', dataType: 'image', description: 'Khung hình cuối để chain sang shot sau' },
    ],
    configSchema: {
      modelVariant: {
        type: 'select',
        label: 'Phiên bản Model',
        defaultValue: 'veo-2.0-generate-001',
        options: [
          { label: 'Google Veo 2.0 (Chất lượng điện ảnh cao)', value: 'veo-2.0-generate-001' },
          { label: 'Google Veo Fast (Tốc độ render cao)', value: 'veo-fast-001' },
          { label: 'Gemini Omni Flash Video', value: 'gemini-omni-flash-video' },
        ],
      },
      durationSeconds: {
        type: 'slider',
        label: 'Thời lượng (giây)',
        defaultValue: 5,
        min: 3,
        max: 10,
        step: 1,
      },
      aspectRatio: {
        type: 'select',
        label: 'Tỉ lệ khung hình',
        defaultValue: '16:9',
        options: [
          { label: '16:9 (Landscape)', value: '16:9' },
          { label: '9:16 (Portrait / Reels)', value: '9:16' },
          { label: '1:1 (Square)', value: '1:1' },
        ],
      },
      fps: {
        type: 'select',
        label: 'Tốc độ khung hình (FPS)',
        defaultValue: 24,
        options: [
          { label: '24 FPS (Chuẩn điện ảnh)', value: 24 },
          { label: '30 FPS (Chuẩn video thông dụng)', value: 30 },
          { label: '60 FPS (Mượt mà)', value: 60 },
        ],
      },
      seed: {
        type: 'number',
        label: 'Seed (-1 cho ngẫu nhiên)',
        defaultValue: -1,
      },
    },
    defaultData: {
      modelVariant: 'veo-2.0-generate-001',
      durationSeconds: 5,
      aspectRatio: '16:9',
      fps: 24,
      seed: -1,
    },
  },

  'kling-video': {
    type: 'kling-video',
    category: 'model',
    label: 'Kling AI Video',
    description: 'Sinh video AI độ chân thực cao qua dịch vụ Kling AI.',
    inputs: [
      { id: 'prompt', label: 'Prompt', dataType: 'text' },
      { id: 'init_frame', label: 'Init Frame', dataType: 'image' },
    ],
    outputs: [
      { id: 'video', label: 'Video', dataType: 'video' },
      { id: 'last_frame', label: 'Last Frame', dataType: 'image' },
    ],
    configSchema: {
      mode: {
        type: 'select',
        label: 'Chế độ render',
        defaultValue: 'standard',
        options: [
          { label: 'Standard (Nhanh, tiết kiệm)', value: 'standard' },
          { label: 'Professional (Chất lượng cao nhất)', value: 'pro' },
        ],
      },
      durationSeconds: {
        type: 'slider',
        label: 'Thời lượng (giây)',
        defaultValue: 5,
        min: 5,
        max: 10,
        step: 5,
      },
    },
    defaultData: {
      mode: 'standard',
      durationSeconds: 5,
    },
  },

  'sd-image': {
    type: 'sd-image',
    category: 'model',
    label: 'SD / Flux Image Generator',
    description: 'Tạo hình ảnh chất lượng siêu cao để làm storyboard hoặc init-frame.',
    inputs: [
      { id: 'prompt', label: 'Prompt', dataType: 'text' },
      { id: 'character', label: 'Character Lock', dataType: 'character_ref' },
    ],
    outputs: [
      { id: 'image', label: 'Ảnh đầu ra', dataType: 'image' },
    ],
    configSchema: {
      model: {
        type: 'select',
        label: 'Model sinh ảnh',
        defaultValue: 'flux-schnell',
        options: [
          { label: 'FLUX.1 [schnell] (Nhanh, đẹp)', value: 'flux-schnell' },
          { label: 'FLUX.1 [dev] (Chất lượng tối đa)', value: 'flux-dev' },
          { label: 'Stable Diffusion XL (SDXL)', value: 'sdxl' },
        ],
      },
      steps: {
        type: 'slider',
        label: 'Số bước lấy mẫu (Sampling Steps)',
        defaultValue: 25,
        min: 10,
        max: 50,
        step: 1,
      },
      cfgScale: {
        type: 'slider',
        label: 'Độ tuân thủ Prompt (CFG)',
        defaultValue: 7.5,
        min: 1,
        max: 15,
        step: 0.5,
      },
    },
    defaultData: {
      model: 'flux-schnell',
      steps: 25,
      cfgScale: 7.5,
    },
  },

  'whisper-transcribe': {
    type: 'whisper-transcribe',
    category: 'model',
    label: 'Whisper Transcribe (ASR)',
    description: 'Chuyển đổi lời thoại trong video thành phụ đề tiếng Việt / đa ngôn ngữ.',
    inputs: [
      { id: 'video', label: 'Video nguồn', dataType: 'video' },
      { id: 'audio', label: 'Âm thanh nguồn', dataType: 'audio' },
    ],
    outputs: [
      { id: 'subtitles', label: 'Phụ đề Text', dataType: 'text' },
    ],
    configSchema: {
      modelSize: {
        type: 'select',
        label: 'Kích cỡ Model Whisper',
        defaultValue: 'base',
        options: [
          { label: 'Base (Nhanh, nhẹ)', value: 'base' },
          { label: 'Small (Chính xác hơn)', value: 'small' },
          { label: 'Medium (Chuyên nghiệp)', value: 'medium' },
        ],
      },
      language: {
        type: 'select',
        label: 'Ngôn ngữ nhận dạng',
        defaultValue: 'auto',
        options: [
          { label: 'Tự động phát hiện (Auto)', value: 'auto' },
          { label: 'Tiếng Việt (vi)', value: 'vi' },
          { label: 'Tiếng Anh (en)', value: 'en' },
        ],
      },
    },
    defaultData: {
      modelSize: 'base',
      language: 'auto',
    },
  },

  'tts-voice': {
    type: 'tts-voice',
    category: 'model',
    label: 'Lồng tiếng AI (TTS Voice)',
    description: 'Sinh giọng đọc truyền cảm cho kịch bản từ VietTTS hoặc OpenAI TTS.',
    inputs: [
      { id: 'text', label: 'Văn bản kịch bản', dataType: 'text' },
    ],
    outputs: [
      { id: 'audio', label: 'Audio Lồng tiếng', dataType: 'audio' },
    ],
    configSchema: {
      voice: {
        type: 'select',
        label: 'Giọng đọc',
        defaultValue: 'viettts-hanoi-female',
        options: [
          { label: 'VietTTS - Hà Nội Nữ (Chuẩn)', value: 'viettts-hanoi-female' },
          { label: 'VietTTS - Hà Nội Nam (Trầm ấm)', value: 'viettts-hanoi-male' },
          { label: 'VietTTS - Sài Gòn Nữ (Dịu dàng)', value: 'viettts-saigon-female' },
        ],
      },
      speed: {
        type: 'slider',
        label: 'Tốc độ nói',
        defaultValue: 1.0,
        min: 0.7,
        max: 1.5,
        step: 0.05,
      },
    },
    defaultData: {
      voice: 'viettts-hanoi-female',
      speed: 1.0,
    },
  },

  // ==========================================
  // 3. CONTROL NODES
  // ==========================================
  'controlnet': {
    type: 'controlnet',
    category: 'control',
    label: 'ControlNet Guider',
    description: 'Điều khiển dáng điệu cơ thể (Pose), chiều sâu (Depth) hoặc viền nét (Canny).',
    inputs: [
      { id: 'image', label: 'Ảnh hướng dẫn', dataType: 'image' },
    ],
    outputs: [
      { id: 'control_out', label: 'Tín hiệu Control', dataType: 'any' },
    ],
    configSchema: {
      controlType: {
        type: 'select',
        label: 'Loại ControlNet',
        defaultValue: 'depth',
        options: [
          { label: 'Depth (Chiều sâu 3D)', value: 'depth' },
          { label: 'OpenPose (Tư thế người)', value: 'openpose' },
          { label: 'Canny Edge (Viền nét kiến trúc)', value: 'canny' },
        ],
      },
      weight: {
        type: 'slider',
        label: 'Trọng số ảnh hưởng (Weight)',
        defaultValue: 0.8,
        min: 0.1,
        max: 1.5,
        step: 0.05,
      },
    },
    defaultData: {
      controlType: 'depth',
      weight: 0.8,
    },
  },

  'lora-loader': {
    type: 'lora-loader',
    category: 'control',
    label: 'LoRA Loader',
    description: 'Nạp mô hình LoRA tinh chỉnh phong cách riêng hoặc khuôn mặt nhân vật.',
    inputs: [],
    outputs: [
      { id: 'lora_out', label: 'LoRA Stack', dataType: 'any' },
    ],
    configSchema: {
      loraName: {
        type: 'string',
        label: 'Tên hoặc URL LoRA',
        defaultValue: 'vietnam-cinematic-style.safetensors',
      },
      loraScale: {
        type: 'slider',
        label: 'Cường độ LoRA',
        defaultValue: 0.85,
        min: 0.0,
        max: 1.5,
        step: 0.05,
      },
    },
    defaultData: {
      loraName: 'vietnam-cinematic-style.safetensors',
      loraScale: 0.85,
    },
  },

  'seed-lock': {
    type: 'seed-lock',
    category: 'control',
    label: 'Khóa Seed (Seed Lock)',
    description: 'Cố định hạt giống ngẫu nhiên để tái lập kết quả đồng nhất 100%.',
    inputs: [],
    outputs: [
      { id: 'seed_out', label: 'Seed', dataType: 'any' },
    ],
    configSchema: {
      seedValue: {
        type: 'number',
        label: 'Giá trị Seed',
        defaultValue: 424242,
      },
      randomizeEachRun: {
        type: 'boolean',
        label: 'Tự đổi seed sau mỗi lần render',
        defaultValue: false,
      },
    },
    defaultData: {
      seedValue: 424242,
      randomizeEachRun: false,
    },
  },

  // ==========================================
  // 4. CONSISTENCY NODES
  // ==========================================
  'character-lock': {
    type: 'character-lock',
    category: 'consistency',
    label: 'Khóa Nhân vật (Character Lock)',
    description: 'Giữ khuôn mặt, trang phục và phụ kiện nhất quán xuyên suốt các shots.',
    inputs: [
      { id: 'character_in', label: 'Nhân vật nguồn', dataType: 'character_ref' },
    ],
    outputs: [
      { id: 'character_locked', label: 'Nhân vật đã khóa', dataType: 'character_ref' },
    ],
    configSchema: {
      faceWeight: {
        type: 'slider',
        label: 'Mức độ ưu tiên nhận diện khuôn mặt',
        defaultValue: 0.9,
        min: 0.5,
        max: 1.0,
        step: 0.05,
      },
      costumeLock: {
        type: 'boolean',
        label: 'Cố định cả trang phục',
        defaultValue: true,
      },
    },
    defaultData: {
      faceWeight: 0.9,
      costumeLock: true,
    },
  },

  'style-lock': {
    type: 'style-lock',
    category: 'consistency',
    label: 'Khóa Phong cách (Style Lock)',
    description: 'Khóa tông màu, ống kính máy quay (anamorphic/35mm) và độ hạt phim.',
    inputs: [],
    outputs: [
      { id: 'style_out', label: 'Style Token', dataType: 'any' },
    ],
    configSchema: {
      colorPalette: {
        type: 'select',
        label: 'Bảng màu điện ảnh',
        defaultValue: 'teal_orange',
        options: [
          { label: 'Teal & Orange (Hollywood)', value: 'teal_orange' },
          { label: 'Cyberpunk Neon (Xanh/Hồng)', value: 'cyberpunk' },
          { label: 'Vintage Noir (Đen trắng cổ điển)', value: 'noir' },
          { label: 'Warm Earthy (Tông đất ấm cúng)', value: 'warm' },
        ],
      },
      lensType: {
        type: 'select',
        label: 'Mô phỏng ống kính',
        defaultValue: 'anamorphic_35mm',
        options: [
          { label: 'Anamorphic 35mm (Hiệu ứng flare ngang)', value: 'anamorphic_35mm' },
          { label: '50mm Prime (Tự nhiên như mắt người)', value: 'prime_50mm' },
          { label: 'Wide Angle 24mm (Góc rộng kịch tính)', value: 'wide_24mm' },
        ],
      },
    },
    defaultData: {
      colorPalette: 'teal_orange',
      lensType: 'anamorphic_35mm',
    },
  },

  'scene-continuity': {
    type: 'scene-continuity',
    category: 'consistency',
    label: 'Đồng bộ Bối cảnh (Scene Continuity)',
    description: 'Bảo toàn hướng ánh sáng, bóng đổ và thời tiết giữa các cảnh liên tiếp.',
    inputs: [
      { id: 'scene_in', label: 'Bối cảnh', dataType: 'scene_ref' },
    ],
    outputs: [
      { id: 'scene_out', label: 'Bối cảnh liên tục', dataType: 'scene_ref' },
    ],
    configSchema: {
      timeOfDay: {
        type: 'select',
        label: 'Thời gian trong ngày',
        defaultValue: 'sunset',
        options: [
          { label: 'Bình minh (Golden Dawn)', value: 'dawn' },
          { label: 'Giữa trưa (High Noon)', value: 'noon' },
          { label: 'Hoàng hôn (Sunset / Magic Hour)', value: 'sunset' },
          { label: 'Nửa đêm (Midnight Neon)', value: 'night' },
        ],
      },
    },
    defaultData: {
      timeOfDay: 'sunset',
    },
  },

  'qc-check': {
    type: 'qc-check',
    category: 'consistency',
    label: 'Kiểm duyệt Tính nhất quán (QC Check)',
    description: 'Chấm điểm sai lệch nhân vật và màu sắc giữa 2 shot qua embedding cosine distance.',
    inputs: [
      { id: 'shot_a', label: 'Khung hình Shot N-1', dataType: 'image' },
      { id: 'shot_b', label: 'Khung hình Shot N', dataType: 'image' },
    ],
    outputs: [
      { id: 'qc_passed', label: 'Duyệt (Pass)', dataType: 'any' },
    ],
    configSchema: {
      faceSimilarityThreshold: {
        type: 'slider',
        label: 'Ngưỡng tương đồng khuôn mặt (%)',
        defaultValue: 85,
        min: 60,
        max: 98,
        step: 1,
      },
      colorTolerance: {
        type: 'slider',
        label: 'Dung sai chênh lệch màu (%)',
        defaultValue: 15,
        min: 5,
        max: 30,
        step: 1,
      },
      autoReject: {
        type: 'boolean',
        label: 'Tự động báo lỗi nếu không đạt ngưỡng',
        defaultValue: true,
      },
    },
    defaultData: {
      faceSimilarityThreshold: 85,
      colorTolerance: 15,
      autoReject: true,
    },
  },

  // ==========================================
  // 5. EDITING NODES
  // ==========================================
  'trim': {
    type: 'trim',
    category: 'editing',
    label: 'Cắt gọt Video (Trim)',
    description: 'Cắt đoạn video theo mốc thời gian bắt đầu và kết thúc.',
    inputs: [
      { id: 'video_in', label: 'Video vào', dataType: 'video' },
    ],
    outputs: [
      { id: 'video_out', label: 'Video đã cắt', dataType: 'video' },
    ],
    configSchema: {
      startTime: {
        type: 'number',
        label: 'Thời điểm bắt đầu (giây)',
        defaultValue: 0,
      },
      endTime: {
        type: 'number',
        label: 'Thời điểm kết thúc (giây)',
        defaultValue: 5,
      },
    },
    defaultData: {
      startTime: 0,
      endTime: 5,
    },
  },

  'concat': {
    type: 'concat',
    category: 'editing',
    label: 'Ghép nối Video (Concat)',
    description: 'Nối 2 đoạn video liên tiếp thành một chuỗi video liền mạch.',
    inputs: [
      { id: 'video_a', label: 'Video 1 (Shot trước)', dataType: 'video' },
      { id: 'video_b', label: 'Video 2 (Shot sau)', dataType: 'video' },
    ],
    outputs: [
      { id: 'video_out', label: 'Video ghép', dataType: 'video' },
    ],
    configSchema: {
      transitionDuration: {
        type: 'slider',
        label: 'Thời gian chuyển tiếp (giây)',
        defaultValue: 0.5,
        min: 0,
        max: 2.0,
        step: 0.1,
      },
    },
    defaultData: {
      transitionDuration: 0.5,
    },
  },

  'transition': {
    type: 'transition',
    category: 'editing',
    label: 'Hiệu ứng Chuyển cảnh (Transition)',
    description: 'Tạo hiệu ứng hòa trộn (Dissolve, Fade, Wipe) giữa 2 đoạn clip.',
    inputs: [
      { id: 'video_a', label: 'Clip A', dataType: 'video' },
      { id: 'video_b', label: 'Clip B', dataType: 'video' },
    ],
    outputs: [
      { id: 'video_out', label: 'Video chuyển cảnh', dataType: 'video' },
    ],
    configSchema: {
      effect: {
        type: 'select',
        label: 'Hiệu ứng',
        defaultValue: 'cross_dissolve',
        options: [
          { label: 'Hòa tan mờ dần (Cross Dissolve)', value: 'cross_dissolve' },
          { label: 'Chớp đen (Fade to Black)', value: 'fade_black' },
          { label: 'Chớp trắng (Fade to White)', value: 'fade_white' },
          { label: 'Lướt ngang (Wipe Left)', value: 'wipe_left' },
        ],
      },
    },
    defaultData: {
      effect: 'cross_dissolve',
    },
  },

  'color-match': {
    type: 'color-match',
    category: 'editing',
    label: 'Cân bằng Màu (Color Match)',
    description: 'Chỉnh phổ màu của video đích khớp 100% với video/ảnh tham chiếu.',
    inputs: [
      { id: 'video_target', label: 'Video cần chỉnh', dataType: 'video' },
      { id: 'reference_image', label: 'Ảnh mẫu màu', dataType: 'image' },
    ],
    outputs: [
      { id: 'video_out', label: 'Video đã cân màu', dataType: 'video' },
    ],
    configSchema: {
      intensity: {
        type: 'slider',
        label: 'Độ mạnh cân màu',
        defaultValue: 0.75,
        min: 0.1,
        max: 1.0,
        step: 0.05,
      },
    },
    defaultData: {
      intensity: 0.75,
    },
  },

  'upscale': {
    type: 'upscale',
    category: 'editing',
    label: 'Nâng cấp Độ phân giải (Upscale)',
    description: 'Khử răng cưa và nâng độ phân giải lên 4K sắc nét bằng AI.',
    inputs: [
      { id: 'video_in', label: 'Video nguồn', dataType: 'video' },
    ],
    outputs: [
      { id: 'video_out', label: 'Video 4K', dataType: 'video' },
    ],
    configSchema: {
      scaleFactor: {
        type: 'select',
        label: 'Hệ số phóng to',
        defaultValue: '2x',
        options: [
          { label: '2x (1080p -> 4K)', value: '2x' },
          { label: '4x (720p -> 4K)', value: '4x' },
        ],
      },
    },
    defaultData: {
      scaleFactor: '2x',
    },
  },

  // ==========================================
  // 6. OUTPUT NODES
  // ==========================================
  'export-video': {
    type: 'export-video',
    category: 'output',
    label: 'Xuất Video (Export File)',
    description: 'Đóng gói và lưu file video hoàn thiện vào ổ đĩa máy tính.',
    inputs: [
      { id: 'video_in', label: 'Video hoàn thiện', dataType: 'video' },
      { id: 'audio_in', label: 'Audio lồng tiếng', dataType: 'audio' },
    ],
    outputs: [],
    configSchema: {
      fileName: {
        type: 'string',
        label: 'Tên tệp xuất',
        defaultValue: 'VANHSUB_Output_Master.mp4',
      },
      format: {
        type: 'select',
        label: 'Định dạng container',
        defaultValue: 'mp4',
        options: [
          { label: 'MP4 (H.264 / AAC - Tương thích tối đa)', value: 'mp4' },
          { label: 'MKV (Chất lượng không nén)', value: 'mkv' },
          { label: 'WebM (Tối ưu web)', value: 'webm' },
        ],
      },
      bitrate: {
        type: 'select',
        label: 'Chất lượng Bitrate',
        defaultValue: 'high',
        options: [
          { label: 'Cao nhất (High Bitrate 20Mbps)', value: 'high' },
          { label: 'Trung bình (Standard 10Mbps)', value: 'medium' },
        ],
      },
    },
    defaultData: {
      fileName: 'VANHSUB_Output_Master.mp4',
      format: 'mp4',
      bitrate: 'high',
    },
  },

  'send-to-sub-mode': {
    type: 'send-to-sub-mode',
    category: 'output',
    label: 'Chuyển sang Sub Mode (Sub Mode Link)',
    description: 'Chuyển thẳng video đã sinh vào Sub Mode để phiên âm ASR, chỉnh phụ đề & lồng tiếng.',
    inputs: [
      { id: 'video_in', label: 'Video sinh từ Workflow', dataType: 'video' },
    ],
    outputs: [],
    configSchema: {
      autoOpenEditor: {
        type: 'boolean',
        label: 'Tự động mở màn hình Hiệu đính phụ đề sau khi chuyển',
        defaultValue: true,
      },
      taskName: {
        type: 'string',
        label: 'Tên Task trong Sub Mode',
        defaultValue: 'Video từ Workflow Canvas',
      },
    },
    defaultData: {
      autoOpenEditor: true,
      taskName: 'Video từ Workflow Canvas',
    },
  },

  // ==========================================
  // 7. LOGIC NODES
  // ==========================================
  'batch': {
    type: 'batch',
    category: 'logic',
    label: 'Xử lý Hàng loạt (Batch)',
    description: 'Tạo nhiều biến thể clip với các seed hoặc prompts khác nhau.',
    inputs: [
      { id: 'prompt_in', label: 'Prompt gốc', dataType: 'text' },
    ],
    outputs: [
      { id: 'batch_out', label: 'Danh sách Prompts', dataType: 'text' },
    ],
    configSchema: {
      batchSize: {
        type: 'slider',
        label: 'Số lượng biến thể',
        defaultValue: 3,
        min: 2,
        max: 8,
        step: 1,
      },
    },
    defaultData: {
      batchSize: 3,
    },
  },

  'loop': {
    type: 'loop',
    category: 'logic',
    label: 'Vòng lặp (Loop)',
    description: 'Lặp lại luồng sinh video cho danh sách cảnh quay trong kịch bản.',
    inputs: [
      { id: 'in', label: 'Đầu vào', dataType: 'any' },
    ],
    outputs: [
      { id: 'out', label: 'Đầu ra từng vòng', dataType: 'any' },
    ],
    configSchema: {
      iterations: {
        type: 'number',
        label: 'Số lần lặp',
        defaultValue: 4,
      },
    },
    defaultData: {
      iterations: 4,
    },
  },

  'conditional': {
    type: 'conditional',
    category: 'logic',
    label: 'Rẽ nhánh Điều kiện (Conditional)',
    description: 'Phân nhánh luồng xử lý tùy theo kết quả QC đạt hay trượt.',
    inputs: [
      { id: 'condition', label: 'Tín hiệu QC', dataType: 'any' },
      { id: 'input_video', label: 'Video', dataType: 'video' },
    ],
    outputs: [
      { id: 'true_branch', label: 'Nếu Đạt (Pass)', dataType: 'video' },
      { id: 'false_branch', label: 'Nếu Không đạt (Retry/Fallback)', dataType: 'video' },
    ],
    configSchema: {
      conditionType: {
        type: 'select',
        label: 'Điều kiện',
        defaultValue: 'qc_passed',
        options: [
          { label: 'QC Pass (Điểm >= Ngưỡng)', value: 'qc_passed' },
          { label: 'Video thời lượng > 5s', value: 'duration_check' },
        ],
      },
    },
    defaultData: {
      conditionType: 'qc_passed',
    },
  },
};

/**
 * Trả về danh sách node definitions được nhóm theo Category
 */
export function getNodesByCategory() {
  const grouped: Record<string, NodeDefinition[]> = {};
  for (const node of Object.values(NODE_DEFINITIONS)) {
    if (!grouped[node.category]) {
      grouped[node.category] = [];
    }
    grouped[node.category].push(node);
  }
  return grouped;
}
