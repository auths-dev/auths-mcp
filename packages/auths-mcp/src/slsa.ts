import * as fs from 'fs';
import * as crypto from 'crypto';

export interface SlsaStatement {
  _type: string;
  predicateType: string;
  subject: Array<{ name: string; digest: { sha256: string } }>;
  builder: { id: string };
}

export function verifySlsaProvenance(artifactPath: string, provenancePath: string): boolean {
  if (!fs.existsSync(artifactPath) || !fs.existsSync(provenancePath)) {
    return false;
  }

  const artifactBytes = fs.readFileSync(artifactPath);
  const calculatedSha = crypto.createHash('sha256').update(artifactBytes).digest('hex');

  const provenanceJson: SlsaStatement = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));

  const subject = provenanceJson.subject.find((s) => s.digest.sha256 === calculatedSha);
  return subject !== undefined;
}
