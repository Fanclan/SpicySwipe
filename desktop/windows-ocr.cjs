'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
function failure(message, code) { const error = new Error(message); error.code = code; return error; }
function canceled(signal) { if (signal?.aborted) throw failure('Local OCR was canceled.', 'OCR_ABORTED'); }
function windowsText(stdout) {
  let result;
  try { result = JSON.parse(stdout.replace(/^\uFEFF/, '')); } catch { throw failure('Windows OCR returned an invalid result.', 'OCR_RESULT'); }
  if (result?.ok !== true) throw failure(result?.code === 'unsupported' ? 'Windows OCR has no installed supported recognizer language. Install an OCR language in Windows Settings.' : 'Windows OCR could not read this image.', result?.code === 'unsupported' ? 'OCR_UNSUPPORTED' : 'OCR_RESULT');
  return result.text;
}
async function readPngText(png, { signal, timeoutMs = 10000, platform = process.platform, execFile = childProcess.execFile, tempRoot = os.tmpdir() } = {}) {
  if (platform !== 'win32' && platform !== 'linux') throw failure('Local OCR is supported on Windows and Linux.', 'OCR_UNSUPPORTED');
  if (!Buffer.isBuffer(png) || png.length < 33 || png.length > 2 * 1024 * 1024 || !png.subarray(0, 8).equals(PNG) || png.toString('ascii', 12, 16) !== 'IHDR') throw failure('Local OCR requires a bounded cropped PNG image.', 'OCR_INPUT');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 8 * 1024 * 1024) throw failure('Local OCR PNG dimensions exceed the supported image size.', 'OCR_INPUT');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 15000) throw failure('Local OCR timeout must be 500–15000 milliseconds.', 'OCR_INPUT');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw failure('Local OCR requires a valid cancellation signal.', 'OCR_INPUT');
  canceled(signal);
  let directory;
  try {
    directory = await fs.mkdtemp(path.join(tempRoot, 'spicyswipe-ocr-'));
    canceled(signal);
    const imagePath = path.join(directory, 'crop.png');
    await fs.writeFile(imagePath, png, { flag: 'wx', mode: 0o600 });
    canceled(signal);
    const windows = platform === 'win32';
    const executable = windows ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '/usr/bin/tesseract';
    const args = windows
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname.replace(/([\\/])app\.asar(?=[\\/]|$)/, '$1app.asar.unpacked'), 'windows-ocr.ps1'), '-ImagePath', imagePath]
      : [imagePath, 'stdout', '-l', 'eng', '--psm', '6'];
    const stdout = await new Promise((resolve, reject) => {
      execFile(executable, args, { shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 65536, encoding: 'utf8', signal }, (error, output) => {
        if (signal?.aborted || error?.name === 'AbortError') reject(failure('Local OCR was canceled.', 'OCR_ABORTED'));
        else if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') reject(failure('Local OCR output exceeded its size limit.', 'OCR_RESULT'));
        else if (error?.killed || error?.code === 'ETIMEDOUT') reject(failure('Local OCR timed out.', 'OCR_TIMEOUT'));
        else if (error) reject(failure(windows ? 'Windows OCR is unavailable. Check the Windows OCR language installation.' : 'Local OCR failed. Check the Tesseract installation and English language data.', 'OCR_UNSUPPORTED'));
        else resolve(output);
      });
    });
    canceled(signal);
    if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 65536) throw failure('Local OCR returned an invalid result.', 'OCR_RESULT');
    const text = windows ? windowsText(stdout) : stdout;
    if (typeof text !== 'string' || text.length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw failure('Local OCR returned invalid text.', 'OCR_RESULT');
    return text;
  } finally {
    // The child is terminated on abort/timeout. Retry cleanup briefly if Windows is still releasing the PNG.
    if (directory) await fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}
module.exports = { readPngText };
