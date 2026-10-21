import React from 'react';
import type {AiStudioFlowEngineConfig} from '../../types/aiStudio';
import {studioMediaReadiness,OFFICIAL_IMAGE_MODELS,OFFICIAL_VIDEO_MODELS} from '../../../shared/officialMediaConfig';

export default function MediaRouteSettings({value,onChange,projectId}:{value:AiStudioFlowEngineConfig;onChange:(value:AiStudioFlowEngineConfig)=>void;projectId?:string}) {
  const route=['official_api','manual'].includes(value.engine||'')?value.engine:'rpc';
  const patch=(fields:Partial<AiStudioFlowEngineConfig>)=>onChange({...value,...fields});
  const readiness=studioMediaReadiness(value,projectId);
  return <div className="space-y-3 rounded border border-border bg-bg p-3 text-xs">
    <label className="block">Nguồn media
      <select aria-label="Nguồn media" value={route} onChange={e=>patch({engine:e.target.value,officialConsent:false,officialConsentProjectId:undefined,...(e.target.value==='official_api'?{officialImageModel:OFFICIAL_IMAGE_MODELS[0],officialVideoModel:OFFICIAL_VIDEO_MODELS[0],officialVideoMode:'t2v',officialRequestLimit:value.officialRequestLimit||1}:{})})} className="mt-1 w-full rounded border border-border bg-surface p-2">
        <option value="rpc">Legacy Flow — chưa nghiệm thu lại</option><option value="official_api">Official Gemini API — có thể tính phí</option><option value="manual">Manual Import — không gọi generation</option>
      </select>
    </label>
    {route==='official_api'&&<>
      <label className="block">API key media riêng<input aria-label="API key media official" type="password" autoComplete="off" value={value.apiKey||''} onChange={e=>patch({apiKey:e.target.value})} className="mt-1 w-full rounded border border-border bg-surface p-2"/></label>
      <label className="block">Model ảnh (T2I)<select aria-label="Model ảnh official" value={value.officialImageModel||''} onChange={e=>patch({officialImageModel:e.target.value})} className="mt-1 w-full rounded border border-border bg-surface p-2"><option value="">Chọn model</option>{OFFICIAL_IMAGE_MODELS.map(m=><option key={m}>{m}</option>)}</select></label>
      <label className="block">Model video<select aria-label="Model video official" value={value.officialVideoModel||''} onChange={e=>patch({officialVideoModel:e.target.value})} className="mt-1 w-full rounded border border-border bg-surface p-2"><option value="">Chọn model</option>{OFFICIAL_VIDEO_MODELS.map(m=><option key={m}>{m}</option>)}</select></label>
      <label className="block">Cảnh video trong storyboard<select aria-label="Tác vụ video official" value={value.officialVideoMode||'t2v'} onChange={e=>patch({officialVideoMode:e.target.value as 't2v'|'i2v'})} className="mt-1 w-full rounded border border-border bg-surface p-2"><option value="t2v">T2V — từ prompt</option><option value="i2v">I2V — dùng ảnh đã nhập riêng cho scene</option></select></label>
      <label className="block">Giới hạn request cho episode (tính cả receipt chưa đối soát)<input aria-label="Giới hạn request official" type="number" min={1} max={20} value={value.officialRequestLimit||1} onChange={e=>patch({officialRequestLimit:Number(e.target.value)})} className="mt-1 w-full rounded border border-border bg-surface p-2"/></label>
      <label className="flex gap-2"><input aria-label="Cho phép trim clip official" type="checkbox" checked={value.officialAllowTrim===true} onChange={e=>patch({officialAllowTrim:e.target.checked})}/>Cho phép cắt clip dài hơn scene (kể cả scene dưới 3 giây). Clip ngắn hơn chỉ được giữ khung cuối khi chọn riêng tại scene.</label>
      <p className="text-amber-300">Giới hạn request KHÔNG phải giới hạn USD. Giá tham khảo 720p khoảng $0.10/giây video output (3–10 giây), chưa gồm input và output khác. Tổng tiền chưa có hard cap tự động. <a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">Bảng giá Google</a></p>
      <label className="block">Phạm vi chi phí được duyệt (ghi chú, không phải hard cap)<input aria-label="Phạm vi chi phí official" maxLength={200} value={value.officialBudgetNote||''} onChange={e=>patch({officialBudgetNote:e.target.value,officialCostAcknowledged:false})} className="mt-1 w-full rounded border border-border bg-surface p-2"/></label>
      <label className="flex gap-2"><input aria-label="Xác nhận chưa có hard cap USD" type="checkbox" checked={value.officialCostAcknowledged===true} onChange={e=>patch({officialCostAcknowledged:e.target.checked})}/>Tôi duyệt phạm vi chi phí đã ghi và hiểu ứng dụng chưa chặn được tổng tiền USD.</label>
      <label className="flex gap-2"><input aria-label="Cho phép API có phí cho project này" type="checkbox" disabled={!projectId} checked={!!projectId&&value.officialConsent===true&&value.officialConsentProjectId===projectId} onChange={e=>patch({officialConsent:e.target.checked,officialConsentProjectId:e.target.checked?projectId:undefined})}/>Tôi cho phép API có thể tính phí trong giới hạn trên cho project này.</label>
      <p>Scene ảnh dùng T2I; scene video dùng mode đã chọn. Video yêu cầu 720p, scene tối đa 10 giây; không điều khiển FPS/duration chính xác hoặc first/last-frame. I2V gửi đúng file tham chiếu, không hứa khung đầu giống pixel.</p>
    </>}
    <p role="status">Media: {readiness.status} · Chưa Live verified</p>
    {readiness.reasons.map(reason=><p key={reason} className="text-amber-300">{reason}</p>)}
    <p className="text-text-muted">Lưu cấu hình trước khi tạo episode mới. Episode cũ giữ snapshot; không tự chuyển route hoặc gửi lại submission bất định.</p>
  </div>;
}
