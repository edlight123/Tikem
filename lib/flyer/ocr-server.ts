/**
 * Read the words off a flyer image, on the server: Tesseract.js (English +
 * French models; they cover Kreyòl's letters) over a greyscale copy made by
 * sharp. Free: no API, no per-read cost, nothing leaves our function.
 *
 * Server side on purpose. In the browser the reader is ~7 MB of WebAssembly
 * and language data on the organizer's first read, which is a lot of mobile
 * data in Haiti, and the app (React Native) cannot run it at all without a
 * native module. One route serves both, so the app gets it over the air.
 *
 * The language data ships inside the function (next.config
 * outputFileTracingIncludes names the files: tracing cannot see a path built
 * at runtime). One worker is kept per warm instance; a cold start pays ~1s to
 * load the models.
 */
import { access, copyFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { OcrLine } from '@/lib/flyer/parse'

type Worker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>

/** The gzipped models, as published by @tesseract.js-data (read off disk, never fetched). */
const modelPath = (lang: 'eng' | 'fra') =>
  path.join(process.cwd(), 'node_modules', '@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`)

/**
 * tesseract.js takes ONE folder for every language (and its "language as
 * data" form is broken in v7: the bytes end up in a file name), while the two
 * models ship in two packages. Copy them side by side into the instance's
 * writable temp dir once; a warm instance reuses the copy.
 */
async function stagedModels(): Promise<string> {
  const dir = path.join(os.tmpdir(), 'tikem-tessdata')
  await mkdir(dir, { recursive: true })
  for (const lang of ['eng', 'fra'] as const) {
    const dest = path.join(dir, `${lang}.traineddata.gz`)
    try {
      await access(dest)
    } catch {
      await copyFile(modelPath(lang), dest)
    }
  }
  return dir
}

let workerPromise: Promise<Worker> | null = null

async function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const [{ createWorker }, langPath] = await Promise.all([import('tesseract.js'), stagedModels()])
    // A local langPath: tesseract.js reads the files, never its CDN default.
    const worker = await createWorker(['eng', 'fra'], 1, { langPath, cacheMethod: 'none', gzip: true })
    // Sparse text: a flyer is scattered words over art, not a page of prose.
    // The default page mode drops the big headline on most posters.
    await worker.setParameters({ tessedit_pageseg_mode: '11' as any })
    return worker
  })().catch((e) => {
    workerPromise = null
    throw e
  })
  return workerPromise
}

/** Greyscale, at most 1400px wide: faster, and Tesseract reads poster type better smaller. */
async function prepare(image: Buffer): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  return sharp(image, { limitInputPixels: 50_000_000, failOn: 'error' })
    .rotate()
    .greyscale()
    .resize({ width: 1400, withoutEnlargement: true })
    .png()
    .toBuffer()
}

/** A read that takes longer than this fails instead of holding the function to its limit. */
const READ_DEADLINE_MS = 25_000

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // A worker that died (e.g. a core file missing) never answers: drop it
      // so the next read starts a fresh one.
      workerPromise = null
      reject(new Error('flyer read timed out'))
    }, ms)
  })
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer))
}

export async function ocrFlyer(image: Buffer): Promise<OcrLine[]> {
  const [worker, png] = await withDeadline(Promise.all([getWorker(), prepare(image)]), READ_DEADLINE_MS)
  const { data } = await withDeadline(worker.recognize(png, {}, { blocks: true } as any), READ_DEADLINE_MS)
  const lines: OcrLine[] = []
  for (const block of (data as any).blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        lines.push({
          text: String(line.text || ''),
          height: Math.max(0, line.bbox.y1 - line.bbox.y0),
          confidence: Number(line.confidence) || 0,
        })
      }
    }
  }
  if (!lines.length && data.text) {
    for (const text of data.text.split('\n')) lines.push({ text, height: 20, confidence: data.confidence })
  }
  return lines
}

/** Stop the warm worker (tests; a serverless instance just freezes it). */
export async function terminateFlyerReader(): Promise<void> {
  const pending = workerPromise
  workerPromise = null
  if (pending) await (await pending).terminate()
}
