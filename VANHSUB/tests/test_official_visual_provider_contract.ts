import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OfficialGeminiVisualProvider } from '../main/ai-studio/providers/OfficialGeminiVisualProvider';
import type { VisualGenerationRequest } from '../main/ai-studio/providers/VisualProviderRouter';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'official-contract-'));
  try {
    const image = Buffer.from('89504e470d0a1a0a00000000', 'hex');
    const video = Buffer.concat([Buffer.alloc(4),Buffer.from('ftypisom'),Buffer.alloc(20)]);
    const input = path.join(root, 'reference.png'); fs.writeFileSync(input,image);
    const req: VisualGenerationRequest = { idempotencyKey:'contract',mediaType:'image',prompt:'Contract only',aspectRatio:'16:9',targetPath:path.join(root,'image.png'),apiKey:'fixture-key' };
    let posts = 0, validated = 0;
    const provider = new OfficialGeminiVisualProvider((async (url: any, options: any) => {
      assert(!String(url).includes('fixture-key'));
      assert.equal(options.headers['x-goog-api-key'],'fixture-key');
      assert.equal(options.redirect,'error');
      const body = options.body && JSON.parse(options.body);
      if (options.method === 'POST') posts++;
      if (String(url).includes(':generateContent')) return Response.json({ candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:image.toString('base64')}}]}}] });
      if (String(url).includes(':predictLongRunning')) {
        assert.equal(body.instances[0].image.bytesBase64Encoded,image.toString('base64'));
        assert.equal(body.parameters.durationSeconds,4); assert.equal(body.parameters.resolution,'720p');
        return Response.json({name:'models/veo-3.1-fast-generate-preview/operations/contract',done:true,response:{generateVideoResponse:{generatedSamples:[{video:{uri:'https://generativelanguage.googleapis.com/v1beta/files/contract:download?alt=media'}}]}}});
      }
      return new Response(video);
    }) as typeof fetch, async file => { assert(fs.statSync(file).size > 0); validated++; });
    assert.equal((await provider.generate(req)).state,'COMPLETED');
    assert.deepEqual(fs.readFileSync(req.targetPath!),image);
    await assert.rejects(provider.generate(req),/OUTPUT_ALREADY_EXISTS/);
    const videoReq = {...req,mediaType:'video' as const,durationSeconds:4,referenceImage:input,targetPath:path.join(root,'video.mp4')};
    assert.equal((await provider.generate(videoReq)).state,'COMPLETED');
    assert.equal(validated,2); assert.equal(posts,2);
    // Restart/uncertain POST: keep the reservation and do not charge twice.
    let failedPosts=0;
    const failed = new OfficialGeminiVisualProvider((async()=>{failedPosts++;throw new Error('fixture timeout');}) as typeof fetch);
    const uncertain={...videoReq,targetPath:path.join(root,'uncertain.mp4')};
    await assert.rejects(failed.generate(uncertain),/timeout/);
    await assert.rejects(failed.generate(uncertain),/EXISTING_SUBMISSION/); assert.equal(failedPosts,1);
    const aborted=new AbortController();aborted.abort();
    await assert.rejects(provider.generate({...req,targetPath:path.join(root,'cancel.png'),signal:aborted.signal}));
    assert(!fs.existsSync(path.join(root,'cancel.png.operation.json')));
    const untrusted = new OfficialGeminiVisualProvider((async()=>Response.json({name:'operations/test',done:true,response:{generateVideoResponse:{generatedSamples:[{video:{uri:'https://evil.invalid/file'}}]}}})) as typeof fetch);
    await assert.rejects(untrusted.generate({...videoReq,targetPath:path.join(root,'untrusted.mp4')}),/UNTRUSTED_MEDIA_URI/);
    const race = new OfficialGeminiVisualProvider((async()=>Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:image.toString('base64')}}]}}]})) as typeof fetch, async()=>{fs.writeFileSync(path.join(root,'race.png'),'previous output');});
    await assert.rejects(race.generate({...req,targetPath:path.join(root,'race.png')}));
    assert.equal(fs.readFileSync(path.join(root,'race.png'),'utf8'),'previous output');
    console.log('PASS: official API offline contract; exact I2V bytes, bounded explicit routes, ambiguous submission guard, cancel, host isolation and no output overwrite. NOT live provider acceptance.');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
