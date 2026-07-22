export interface WitnessCosignature {
  witness_did: string;
  signature_hex: string;
  timestamp: string;
}

export interface WitnessQuorumCheck {
  threshold: number;
  witnesses: WitnessCosignature[];
}

export function verifyWitnessQuorum(quorum: WitnessQuorumCheck): boolean {
  if (!quorum || quorum.witnesses.length < quorum.threshold) {
    return false;
  }
  const uniqueWitnesses = new Set(quorum.witnesses.map((w) => w.witness_did));
  return uniqueWitnesses.size >= quorum.threshold;
}
