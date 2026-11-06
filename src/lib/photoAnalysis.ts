import type { AnalyzeResult, UserProfile } from '../types/schemas';
import { createPrecomputedPhotoResult, findPrecomputedPhotoReference } from './precomputedPhotoReferences';

type LocalAnalyzer = (
  imageDataUrl: string,
  profile?: UserProfile,
) => Promise<{ result: AnalyzeResult; model: string }>;

type HostedAnalyzer = (
  imageDataUrl: string,
  uploadId?: string,
  imageHash?: string,
) => Promise<AnalyzeResult>;

interface PhotoAnalysisInput {
  imageDataUrl: string;
  originalImageHash?: string;
  uploadId: string;
  imageHash: string;
  profile?: UserProfile;
  localOnly: boolean;
  online: boolean;
}

export type PhotoAnalysisOutcome =
  | { method: 'precomputed_reference'; result: AnalyzeResult }
  | { method: 'on_device'; model: string; result: AnalyzeResult }
  | { method: 'hosted'; result: AnalyzeResult };

export async function analyzeCapturedPhoto(
  input: PhotoAnalysisInput,
  analyzeLocally: LocalAnalyzer,
  analyzeHosted: HostedAnalyzer,
): Promise<PhotoAnalysisOutcome> {
  const reference = input.originalImageHash
    ? findPrecomputedPhotoReference(input.originalImageHash)
    : null;
  if (reference) {
    return {
      method: 'precomputed_reference',
      result: createPrecomputedPhotoResult(reference),
    };
  }

  try {
    const local = await analyzeLocally(input.imageDataUrl, input.profile);
    return { method: 'on_device', model: local.model, result: local.result };
  } catch (error) {
    if (input.localOnly || !input.online) throw error;
    return {
      method: 'hosted',
      result: await analyzeHosted(input.imageDataUrl, input.uploadId, input.imageHash),
    };
  }
}
