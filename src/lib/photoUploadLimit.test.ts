import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, reservePhotoUpload } from './api';

const storageValues = new Map<string, string>();

const localStorageMock: Storage = {
  get length() {
    return storageValues.size;
  },
  clear: () => storageValues.clear(),
  getItem: (key) => storageValues.get(key) ?? null,
  key: (index) => Array.from(storageValues.keys())[index] ?? null,
  removeItem: (key) => storageValues.delete(key),
  setItem: (key, value) => storageValues.set(key, value),
};

describe('offline photo upload limit', () => {
  beforeEach(() => {
    storageValues.clear();
    storageValues.set('nv_auth', JSON.stringify({
      email: 'offline@example.com',
      localOnly: true,
    }));
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    });
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it('allows two photos and blocks the next with reset and plan details', async () => {
    await reservePhotoUpload('photo-one', 'a'.repeat(64));
    await reservePhotoUpload('photo-two', 'b'.repeat(64));

    await expect(reservePhotoUpload('photo-three', 'c'.repeat(64))).rejects.toMatchObject({
      status: 429,
      code: 'photo_upload_limit_reached',
      message: expect.stringContaining('Paid plans are coming soon.'),
    } satisfies Partial<ApiError>);
  });

  it('allows retrying the same reservation but rejects reusing its ID for another photo', async () => {
    await reservePhotoUpload('same-upload', 'a'.repeat(64));
    await expect(reservePhotoUpload('same-upload', 'a'.repeat(64))).resolves.toBeUndefined();

    await expect(reservePhotoUpload('same-upload', 'b'.repeat(64))).rejects.toMatchObject({
      status: 409,
    } satisfies Partial<ApiError>);
  });
});
