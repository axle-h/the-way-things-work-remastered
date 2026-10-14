import { open, type FileHandle } from 'node:fs/promises';
import type { BlockSource } from '@twtw/formats';

/** A {@link BlockSource} over a file on disk, read with positioned reads. Close it when done. */
export interface FileBlockSource extends BlockSource {
  close(): Promise<void>;
}

export async function openFileSource(path: string): Promise<FileBlockSource> {
  const handle: FileHandle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    return {
      size,
      async read(offset, length) {
        const buffer = new Uint8Array(length);
        let done = 0;
        while (done < length) {
          const { bytesRead } = await handle.read(buffer, done, length - done, offset + done);
          if (bytesRead === 0) throw new Error(`${path}: unexpected end of file at ${offset + done}`);
          done += bytesRead;
        }
        return buffer;
      },
      close: () => handle.close(),
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
