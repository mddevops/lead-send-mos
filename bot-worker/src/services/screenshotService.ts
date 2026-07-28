import { Page } from 'playwright';
import { uploadScreenshot } from './laravelApi';

export async function captureAndUploadScreenshot(params: {
  page: Page;
  runId?: number;
  filename: string;
  disk?: string;
  fullPage?: boolean;
  quality?: number;
}): Promise<string> {
  const quality = Math.max(1, Math.min(100, params.quality ?? 80));
  const useJpeg = typeof params.quality === 'number';
  const screenshotType = useJpeg ? 'jpeg' : 'png';

  const buffer = await params.page.screenshot({
    fullPage: params.fullPage ?? true,
    type: screenshotType,
    quality: useJpeg ? quality : undefined,
  });

  const base64 = `data:image/${screenshotType};base64,${buffer.toString('base64')}`;
  const uploaded = await uploadScreenshot({
    run_id: params.runId,
    filename: params.filename,
    disk: params.disk,
    base64,
  });

  return uploaded.path;
}
