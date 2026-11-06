import { describe, expect, it, vi } from 'vitest';
import { analyzeCapturedPhoto } from './photoAnalysis';
import type { AnalyzeResult } from '../types/schemas';

const hostedResult: AnalyzeResult = {
  source: 'hosted_vision',
  detected: [],
  pipeline: [],
};

const input = {
  imageDataUrl: 'data:image/jpeg;base64,abc',
  uploadId: 'upload-1',
  imageHash: 'b'.repeat(64),
  localOnly: false,
  online: true,
};

describe('photo analysis routing', () => {
  it('uses the exact precomputed reference without invoking either vision analyzer', async () => {
    const analyzeLocally = vi.fn();
    const analyzeHosted = vi.fn();

    const outcome = await analyzeCapturedPhoto(
      { ...input, originalImageHash: 'ef7f927b231a8fc9600145f57d5e81217a36fa54e4ab89d7596190258a76c4f6' },
      analyzeLocally,
      analyzeHosted,
    );

    expect(outcome.method).toBe('precomputed_reference');
    expect(outcome.result.source).toBe('precomputed_reference');
    expect(outcome.result.detected.map((item) => item.name)).toContain('Thai green curry');
    expect(analyzeLocally).not.toHaveBeenCalled();
    expect(analyzeHosted).not.toHaveBeenCalled();
  });

  it('preserves local-to-hosted fallback for an unknown image', async () => {
    const localError = new Error('Local model unavailable');
    const analyzeLocally = vi.fn().mockRejectedValue(localError);
    const analyzeHosted = vi.fn().mockResolvedValue(hostedResult);

    const outcome = await analyzeCapturedPhoto(
      { ...input, originalImageHash: 'f'.repeat(64) },
      analyzeLocally,
      analyzeHosted,
    );

    expect(outcome).toEqual({ method: 'hosted', result: hostedResult });
    expect(analyzeLocally).toHaveBeenCalledOnce();
    expect(analyzeHosted).toHaveBeenCalledWith(input.imageDataUrl, input.uploadId, input.imageHash);
  });

  it('does not call hosted analysis after local failure while offline', async () => {
    const localError = new Error('Local model unavailable');
    const analyzeLocally = vi.fn().mockRejectedValue(localError);
    const analyzeHosted = vi.fn();

    await expect(analyzeCapturedPhoto(
      { ...input, online: false },
      analyzeLocally,
      analyzeHosted,
    )).rejects.toBe(localError);
    expect(analyzeHosted).not.toHaveBeenCalled();
  });
});
