import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

const TEMP_FILES = [
  path.join(config.knowledgeBasePath, 'wechat_qrcode.png'),
];

export function cleanupRuntimeArtifacts(): void {
  for (const filePath of TEMP_FILES) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup only.
    }
  }
}
