import fs from 'fs';
import path from 'path';
import os from 'os';
import { app } from 'electron';
import type { WorkflowNodeEvent, ExecutionContext, ResolvedInputs, NodeExecutionOutput } from './types';
import { AdapterRegistry } from './adapters/AdapterRegistry';
import { QcEngine } from './qcEngine';
import { VideoProcessor } from './videoProcessor';
import { TaskStore } from '../store/taskStore';
import { SettingsStore } from '../store/settingsStore';

export interface WorkflowGraphData {
  id: string;
  name: string;
  nodes: Array<{
    id: string;
    type?: string;
    data: {
      nodeType: string;
      category: string;
      label: string;
      config: Record<string, any>;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
}

export class WorkflowExecutionEngine {
  private activeRuns = new Set<string>();

  public cancel(workflowId: string): void {
    this.activeRuns.delete(workflowId);
  }

  public isRunning(workflowId: string): boolean {
    return this.activeRuns.has(workflowId);
  }

  /**
   * Thực thi toàn bộ đồ thị Node DAG
   */
  public async execute(
    graph: WorkflowGraphData,
    onEvent: (event: WorkflowNodeEvent) => void
  ): Promise<{ success: boolean; outputs: Record<string, any>; error?: string }> {
    const workflowId = graph.id || `wf_${Date.now()}`;
    this.activeRuns.add(workflowId);

    const isCancelled = () => !this.activeRuns.has(workflowId);

    // Thư mục làm việc tạm thời cho workflow
    const tempDir = path.join(
      app?.getPath?.('temp') || os.tmpdir(),
      'vanhsub_workflow',
      workflowId
    );
    fs.mkdirSync(tempDir, { recursive: true });

    // Thư mục export mặc định
    const exportDir = SettingsStore.get('exportDir') || path.join(os.homedir(), 'Downloads');

    const nodes = graph.nodes || [];
    const edges = graph.edges || [];

    // Bản đồ node id -> node object
    const nodeMap = new Map<string, (typeof nodes)[0]>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    // 1. Xây dựng đồ thị DAG: Bậc vào (in-degree) và danh sách kề (adjacency list)
    const inDegree = new Map<string, number>();
    const pendingDependencies = new Map<string, number>();
    const adjacency = new Map<string, Array<{ target: string; sourceHandle?: string; targetHandle?: string }>>();
    const incomingEdges = new Map<string, Array<{ source: string; sourceHandle?: string; targetHandle?: string }>>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      pendingDependencies.set(node.id, 0);
      adjacency.set(node.id, []);
      incomingEdges.set(node.id, []);
    }

    for (const edge of edges) {
      if (inDegree.has(edge.target)) {
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
        pendingDependencies.set(edge.target, (pendingDependencies.get(edge.target) || 0) + 1);
      }
      adjacency.get(edge.source)?.push({
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      });
      incomingEdges.get(edge.target)?.push({
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      });
    }

    // 2. Phát hiện chu trình (Cycle Detection bằng thuật toán Kahn)
    const inDegreeCopy = new Map(inDegree);
    const queueForCycle: string[] = [];
    for (const [id, deg] of inDegreeCopy.entries()) {
      if (deg === 0) queueForCycle.push(id);
    }

    let visitedCount = 0;
    while (queueForCycle.length > 0) {
      const curr = queueForCycle.shift()!;
      visitedCount++;
      for (const edge of adjacency.get(curr) || []) {
        const nextDeg = (inDegreeCopy.get(edge.target) || 0) - 1;
        inDegreeCopy.set(edge.target, nextDeg);
        if (nextDeg === 0) {
          queueForCycle.push(edge.target);
        }
      }
    }

    if (visitedCount < nodes.length) {
      const err = 'Đồ thị chứa chu trình khép kín (Cycle Loop)! Vui lòng kiểm tra lại dây nối các node.';
      this.activeRuns.delete(workflowId);
      return { success: false, outputs: {}, error: err };
    }

    // 3. Khởi tạo trạng thái thực thi
    const nodeOutputs = new Map<string, NodeExecutionOutput>();
    const nodeStatus = new Map<string, WorkflowNodeEvent['status']>();

    for (const node of nodes) {
      nodeStatus.set(node.id, 'queued');
      onEvent({
        workflowId,
        nodeId: node.id,
        status: 'queued',
        progress: 0,
      });
    }

    // Cơ chế Last-Frame Chaining toàn cục theo thứ tự thời gian
    let globalLastFrameUrl: string | undefined = undefined;

    // Hàng đợi các node sẵn sàng chạy (bậc vào = 0)
    const readyQueue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) readyQueue.push(id);
    }

    // Danh sách các node đang chạy đồng thời (Concurrency Control)
    const runningPromises = new Map<string, Promise<void>>();
    const maxConcurrency = 2; // Tối đa 2 model chạy đồng thời để tránh rate limit

    const markDescendantsBlocked = (failedNodeId: string) => {
      const queue = [failedNodeId];
      while (queue.length > 0) {
        const parent = queue.shift()!;
        for (const edge of adjacency.get(parent) || []) {
          if (nodeStatus.get(edge.target) !== 'blocked' && nodeStatus.get(edge.target) !== 'failed') {
            nodeStatus.set(edge.target, 'blocked');
            onEvent({
              workflowId,
              nodeId: edge.target,
              status: 'blocked',
              error: `Bị chặn do node cha #${parent.slice(-5)} gặp lỗi`,
            });
            queue.push(edge.target);
          }
        }
      }
    };

    try {
      while ((readyQueue.length > 0 || runningPromises.size > 0) && !isCancelled()) {
        // Khởi động các node sẵn sàng chạy cho tới khi đầy concurrency
        while (readyQueue.length > 0 && runningPromises.size < maxConcurrency && !isCancelled()) {
          const nodeId = readyQueue.shift()!;
          const node = nodeMap.get(nodeId);
          if (!node || nodeStatus.get(nodeId) === 'blocked') continue;

          const startTime = Date.now();
          nodeStatus.set(nodeId, 'running');
          onEvent({
            workflowId,
            nodeId,
            status: 'running',
            progress: 10,
          });

          // Giải quyết inputs từ các node cha
          const resolvedInputs: ResolvedInputs = {};
          for (const inc of incomingEdges.get(nodeId) || []) {
            const parentOut = nodeOutputs.get(inc.source);
            if (parentOut && inc.targetHandle) {
              const val = inc.sourceHandle ? parentOut[inc.sourceHandle] : parentOut;
              resolvedInputs[inc.targetHandle] = val;
            }
          }

          // Last-frame chaining injection tự động
          if (!resolvedInputs['init_frame'] && globalLastFrameUrl) {
            resolvedInputs['init_frame'] = globalLastFrameUrl;
          }

          const ctx: ExecutionContext = {
            workflowId,
            nodeId,
            tempDir,
            exportDir,
            onProgress: (percent: number) => {
              onEvent({
                workflowId,
                nodeId,
                status: 'running',
                progress: percent,
              });
            },
            isCancelled,
          };

          const taskPromise = this.executeSingleNode(node, resolvedInputs, ctx)
            .then((output) => {
              if (isCancelled()) return;

              nodeOutputs.set(nodeId, output);
              nodeStatus.set(nodeId, 'success');

              // Lưu last-frame nếu node có sinh ra
              if (output.last_frame || output.lastFrameUrl) {
                globalLastFrameUrl = output.last_frame || output.lastFrameUrl;
              }

              const durationMs = Date.now() - startTime;
              onEvent({
                workflowId,
                nodeId,
                status: 'success',
                progress: 100,
                thumbnailUrl: output.last_frame || output.lastFrameUrl || output.thumbnailUrl || output.image,
                outputUrl: output.video || output.outputUrl,
                outputData: output,
                durationMs,
              });

              // Kích hoạt các node con nếu đã giải quyết xong mọi phụ thuộc
              for (const edge of adjacency.get(nodeId) || []) {
                const childId = edge.target;
                const remaining = (pendingDependencies.get(childId) || 1) - 1;
                pendingDependencies.set(childId, remaining);

                if (remaining === 0 && nodeStatus.get(childId) !== 'blocked') {
                  readyQueue.push(childId);
                }
              }
            })
            .catch((err: any) => {
              console.error(`Lỗi thực thi node ${nodeId}:`, err);
              nodeStatus.set(nodeId, 'failed');
              onEvent({
                workflowId,
                nodeId,
                status: 'failed',
                error: err?.message || String(err),
                durationMs: Date.now() - startTime,
              });

              // Cô lập lỗi: đánh dấu tất cả các node con là blocked
              markDescendantsBlocked(nodeId);
            })
            .finally(() => {
              runningPromises.delete(nodeId);
            });

          runningPromises.set(nodeId, taskPromise);
        }

        // Chờ ít nhất một task hoàn thành trước khi duyệt tiếp
        if (runningPromises.size > 0) {
          await Promise.race(runningPromises.values());
        }
      }

      this.activeRuns.delete(workflowId);

      const allSuccess = Array.from(nodeStatus.values()).every((s) => s === 'success');
      return {
        success: allSuccess,
        outputs: Object.fromEntries(nodeOutputs),
      };
    } catch (e: any) {
      this.activeRuns.delete(workflowId);
      return {
        success: false,
        outputs: {},
        error: e?.message || String(e),
      };
    }
  }

  /**
   * Xử lý thực thi cho từng loại node cụ thể
   */
  private async executeSingleNode(
    node: { data: { nodeType: string; config: Record<string, any> } },
    inputs: ResolvedInputs,
    ctx: ExecutionContext
  ): Promise<NodeExecutionOutput> {
    const { nodeType, config } = node.data;
    const adapterRegistry = AdapterRegistry.getInstance();

    switch (nodeType) {
      case 'text-prompt':
        return {
          text: config.prompt || '',
          prompt: config.prompt || '',
          negativePrompt: config.negativePrompt || '',
        };

      case 'load-image':
        return {
          image: config.sourceUrl || '',
          aspectRatio: config.aspectRatio || '16:9',
        };

      case 'load-video':
        return {
          video: config.videoUrl || '',
        };

      case 'character-ref':
        return {
          character: config,
          face_image: config.referenceImageUrl || '',
          name: config.characterName || 'Nhân vật',
        };

      case 'scene-ref':
        return {
          scene: config,
          mood: config.lightingMood || '',
        };

      case 'camera-path':
        return {
          camera_control: config,
          motion: config.motionType || 'pan_right',
        };

      case 'google-flow-video':
      case 'kling-video': {
        const adapter = adapterRegistry.get('google-flow');
        let prompt = '';
        if (typeof inputs['prompt'] === 'string') {
          prompt = inputs['prompt'];
        } else if (inputs['prompt'] && typeof inputs['prompt'] === 'object') {
          prompt = inputs['prompt'].prompt || inputs['prompt'].text || '';
        }
        if (!prompt) {
          prompt = config.prompt || '';
        }

        // Tự động append Character lock vào prompt nếu có
        const charInput = inputs['character'] || (inputs['prompt'] && inputs['prompt'].character_locked ? inputs['prompt'] : null);
        if (charInput) {
          const charObj = charInput.character_locked || charInput.character || charInput;
          const charName = charObj.characterName || charObj.name || '';
          const charDesc = charObj.description || '';
          if (charName || charDesc) {
            prompt = `${prompt} [Consistent Character: ${charName}${charDesc ? ' - ' + charDesc : ''}]`.trim();
          }
        }

        // Tự động append Style lock nếu có
        if (inputs['style']) {
          const styleVal = inputs['style'].style_out || inputs['style'];
          prompt = `${prompt} ${styleVal}`.trim();
        }

        // Tự động append Scene continuity nếu có
        if (inputs['scene']) {
          const sceneVal = inputs['scene'].scene_out || inputs['scene'];
          const sceneName = sceneVal.sceneName || sceneVal.name || '';
          const mood = sceneVal.lightingMood || sceneVal.mood || '';
          if (sceneName || mood) {
            prompt = `${prompt} [Scene: ${sceneName}${mood ? ' - ' + mood : ''}]`.trim();
          }
        }

        // Tự động append Camera motion nếu có
        if (inputs['camera']) {
          const motion = inputs['camera'].motion || inputs['camera'].motionType;
          if (motion) {
            prompt = `${prompt} [Camera: ${motion}]`.trim();
          }
        }

        const initFrameUrl = inputs['init_frame'] || config.initFrameUrl;
        const durationSeconds = Number(config.durationSeconds || 5);
        const aspectRatio = config.aspectRatio || '16:9';
        const seed = config.seed ? Number(config.seed) : undefined;
        const modelVariant = config.modelVariant || 'veo-3.1-generate-preview';

        const result = await adapter.generateVideo(
          {
            prompt,
            initFrameUrl,
            durationSeconds,
            aspectRatio,
            seed,
            modelVariant,
          },
          ctx
        );

        return {
          video: result.videoUrl,
          last_frame: result.lastFrameUrl,
          duration: result.durationSeconds,
        };
      }

      case 'export-video': {
        const videoInput = inputs['video_in'] || inputs['video'];
        if (!videoInput || !fs.existsSync(videoInput)) {
          throw new Error('Không tìm thấy video đầu vào để xuất!');
        }

        const fileName = config.fileName || `VANHSUB_Output_${Date.now()}.mp4`;
        const destPath = path.join(ctx.exportDir, fileName);

        // Copy sang thư mục đích
        fs.copyFileSync(videoInput, destPath);

        return {
          exportedPath: destPath,
          video: destPath,
        };
      }

      case 'send-to-sub-mode': {
        const videoInput = inputs['video_in'] || inputs['video'];
        if (!videoInput || !fs.existsSync(videoInput)) {
          throw new Error('Không có video hợp lệ để chuyển sang Sub Mode!');
        }

        const taskName = config.taskName || `Video sinh từ Workflow (${new Date().toLocaleTimeString()})`;

        // Tự động tạo task mới trong TaskStore của Sub Mode
        const newTask = TaskStore.create({
          fileName: taskName,
          filePath: videoInput,
          workflow: 'full-dubbing',
          status: 'queued',
          progress: 0,
          stageDescription: 'Sẵn sàng phiên âm ASR & dịch thuật từ Workflow Mode',
        });

        return {
          taskId: newTask.id,
          task: newTask,
          video: videoInput,
        };
      }

      case 'trim': {
        const videoInput = inputs['video_in'] || inputs['video'];
        if (!videoInput || !fs.existsSync(videoInput)) {
          throw new Error('Không tìm thấy video đầu vào để cắt gọt (trim)!');
        }
        const startTime = Number(config.startTime ?? 0);
        const endTime = Number(config.endTime ?? 5);
        const outPath = path.join(ctx.tempDir, `trim_${ctx.nodeId}_${Date.now()}.mp4`);
        await VideoProcessor.trimVideo(videoInput, outPath, startTime, endTime, ctx);
        const dur = await VideoProcessor.getVideoDuration(outPath);
        return {
          video: outPath,
          video_out: outPath,
          duration: dur,
        };
      }

      case 'concat': {
        const videoA = inputs['video_a'];
        const videoB = inputs['video_b'];
        const list = [];
        if (videoA && fs.existsSync(videoA)) list.push(videoA);
        if (videoB && fs.existsSync(videoB)) list.push(videoB);
        if (list.length === 0) {
          throw new Error('Không có video hợp lệ nào được đưa vào node concat!');
        }
        const outPath = path.join(ctx.tempDir, `concat_${ctx.nodeId}_${Date.now()}.mp4`);
        await VideoProcessor.concatVideos(list, outPath, ctx);
        const dur = await VideoProcessor.getVideoDuration(outPath);
        return {
          video: outPath,
          video_out: outPath,
          duration: dur,
        };
      }

      case 'transition': {
        const videoA = inputs['video_a'];
        const videoB = inputs['video_b'];
        if (!videoA || !videoB) {
          return { video_out: videoA || videoB, video: videoA || videoB };
        }
        const outPath = path.join(ctx.tempDir, `transition_${ctx.nodeId}_${Date.now()}.mp4`);
        await VideoProcessor.applyTransition(
          videoA,
          videoB,
          outPath,
          {
            effect: config.effect || 'cross_dissolve',
            duration: Number(config.duration || 0.5),
          },
          ctx
        );
        const dur = await VideoProcessor.getVideoDuration(outPath);
        return {
          video: outPath,
          video_out: outPath,
          duration: dur,
          effect: config.effect || 'cross_dissolve',
        };
      }

      case 'color-match': {
        const videoTarget = inputs['video_target'] || inputs['video'];
        if (!videoTarget || !fs.existsSync(videoTarget)) {
          throw new Error('Không tìm thấy video cần chỉnh màu cho node color-match!');
        }
        const refImage = inputs['reference_image'] || inputs['image'] || '';
        const outPath = path.join(ctx.tempDir, `colormatch_${ctx.nodeId}_${Date.now()}.mp4`);
        await VideoProcessor.colorMatchVideo(videoTarget, refImage, outPath, Number(config.intensity || 0.75), ctx);
        return {
          video: outPath,
          video_out: outPath,
        };
      }

      case 'upscale': {
        const videoInput = inputs['video_in'] || inputs['video'];
        if (!videoInput || !fs.existsSync(videoInput)) {
          throw new Error('Không tìm thấy video đầu vào để upscale!');
        }
        const outPath = path.join(ctx.tempDir, `upscale_${ctx.nodeId}_${Date.now()}.mp4`);
        await VideoProcessor.upscaleVideo(videoInput, config.scaleFactor || '2x', outPath, ctx);
        return {
          video: outPath,
          video_out: outPath,
        };
      }

      case 'character-lock': {
        const charIn = inputs['character_in'] || config;
        const faceWeight = config.faceWeight ?? 0.9;
        const costumeLock = config.costumeLock ?? true;
        return {
          character_locked: {
            ...charIn,
            faceWeight,
            costumeLock,
            isLocked: true,
          },
          character: charIn,
        };
      }

      case 'style-lock': {
        const palette = config.colorPalette || 'teal_orange';
        const lens = config.lensType || 'anamorphic_35mm';
        const styleToken = `[Style: ${palette}, Lens: ${lens}, Cinematic 8k Color Grade]`;
        return {
          style_out: styleToken,
          colorPalette: palette,
          lensType: lens,
        };
      }

      case 'scene-continuity': {
        const sceneIn = inputs['scene_in'] || config;
        return {
          scene_out: {
            ...sceneIn,
            timeOfDay: config.timeOfDay || 'sunset',
          },
        };
      }

      case 'qc-check': {
        const shotA = inputs['shot_a'];
        const shotB = inputs['shot_b'];

        const qcRes = await QcEngine.evaluate(shotA, shotB, {
          faceSimilarityThreshold: Number(config.faceSimilarityThreshold || 85),
          colorTolerance: Number(config.colorTolerance || 15),
          autoReject: Boolean(config.autoReject),
        });

        if (config.autoReject && !qcRes.passed) {
          throw new Error(`QC Kiểm định không đạt: ${qcRes.details}`);
        }

        return {
          qc_passed: qcRes.passed,
          similarityScore: qcRes.score,
          colorDelta: qcRes.colorDelta,
          status: qcRes.status,
          details: qcRes.details,
        };
      }

      default:
        // Pass-through cho các node khác
        return {
          ...config,
          ...inputs,
        };
    }
  }
}
