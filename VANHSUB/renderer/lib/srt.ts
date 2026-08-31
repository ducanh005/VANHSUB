// Re-export từ main/lib/srt.ts — nguồn thật duy nhất để cả main process
// (translator) và renderer (editor) dùng chung parser/serializer SRT.
// ts-loader của nextron chỉ compile thư mục main/, nên file gốc phải nằm ở đó.
export * from '../../main/lib/srt';


