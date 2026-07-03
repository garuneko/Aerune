const { app } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_UPLOAD_BYTES = 100000000;
const activeJobs = new Map();
const ffmpegChecks = new Map();
const FORBIDDEN_FFMPEG_FLAGS = [
    '--enable-gpl',
    '--enable-nonfree',
    '--enable-libx264',
    '--enable-libx265',
    '--enable-libfdk-aac'
];

function bundledFfmpegPath() {
    if (process.env.AERUNE_FFMPEG_PATH) return process.env.AERUNE_FFMPEG_PATH;
    const platformDir = `${process.platform}-${process.arch}`;
    const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'bin', 'ffmpeg', platformDir, exe);
    }
    return path.join(__dirname, 'vendor', 'ffmpeg', platformDir, exe);
}

function assertInsideTemp(dir) {
    const resolved = path.resolve(dir || '');
    const tmp = path.resolve(os.tmpdir());
    if (!resolved.startsWith(tmp + path.sep) || !path.basename(resolved).startsWith('aerune-video-')) {
        throw new Error('Refusing to clean an unexpected directory.');
    }
}

function runProcess(exe, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(exe, args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const job = options.jobId ? activeJobs.get(options.jobId) : null;
        if (job) job.child = child;

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', chunk => {
            const text = chunk.toString();
            stdout += text;
            options.onStdout?.(text);
        });
        child.stderr.on('data', chunk => {
            stderr += chunk.toString();
            if (stderr.length > 12000) stderr = stderr.slice(-12000);
        });
        child.on('error', reject);
        child.on('close', code => {
            if (job?.cancelled) {
                const err = new Error('Video compression cancelled.');
                err.name = 'AbortError';
                reject(err);
                return;
            }
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
        });
    });
}

function runProbeProcess(exe, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(exe, args, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', () => resolve({ stdout, stderr }));
    });
}

function ffmpegPlatformKey() {
    return `${process.platform}-${process.arch}`;
}

function hasEncoder(encoders, name) {
    return new RegExp(`(^|\\s)${name}(\\s|$)`).test(encoders);
}

function validateLgplBuild(buildconf, encoders) {
    const hit = FORBIDDEN_FFMPEG_FLAGS.find(flag => buildconf.includes(flag));
    if (hit) throw new Error(`Bundled FFmpeg is not LGPL-safe for Aerune: ${hit}`);
    for (const encoder of ['libx264', 'libx265']) {
        if (hasEncoder(encoders, encoder)) throw new Error(`Bundled FFmpeg exposes forbidden encoder: ${encoder}`);
    }
}

function encoderSmokeArgs(encoder, outputPath) {
    const args = [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-f', 'lavfi',
        '-i', 'color=c=black:s=32x32:d=0.15',
        '-an',
        '-vf', 'format=yuv420p',
        '-frames:v', '4',
        '-c:v', encoder
    ];
    if (encoder === 'h264_videotoolbox') args.push('-allow_sw', '1');
    args.push('-f', 'mp4', outputPath);
    return args;
}

async function encoderWorks(ffmpegPath, encoder) {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aerune-video-encoder-'));
    const outputPath = path.join(tempDir, `${encoder}.mp4`);
    try {
        await runProcess(ffmpegPath, encoderSmokeArgs(encoder, outputPath));
        return fs.existsSync(outputPath);
    } catch {
        return false;
    } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

async function selectWindowsEncoder(ffmpegPath, encoders) {
    if (hasEncoder(encoders, 'h264_mf') && await encoderWorks(ffmpegPath, 'h264_mf')) {
        return 'h264_mf';
    }
    if (hasEncoder(encoders, 'libopenh264')) {
        return 'libopenh264';
    }
    throw new Error('Bundled FFmpeg does not include a usable Windows H.264 encoder (h264_mf or libopenh264).');
}

async function ensureFfmpegCapabilities(ffmpegPath) {
    const platformKey = ffmpegPlatformKey();
    const cacheKey = `${platformKey}:${ffmpegPath}`;
    if (ffmpegChecks.has(cacheKey)) return ffmpegChecks.get(cacheKey);

    const check = (async () => {
        if (!fs.existsSync(ffmpegPath)) {
            throw new Error(`Bundled FFmpeg was not found: ${ffmpegPath}`);
        }
        if (platformKey !== 'darwin-arm64' && platformKey !== 'win32-x64') {
            throw new Error('Local video compression supports macOS arm64 and Windows x64 only.');
        }

        const [buildRes, encoderRes, hwaccelRes] = await Promise.all([
            runProcess(ffmpegPath, ['-hide_banner', '-buildconf']),
            runProcess(ffmpegPath, ['-hide_banner', '-encoders']),
            runProcess(ffmpegPath, ['-hide_banner', '-hwaccels'])
        ]);
        const buildconf = `${buildRes.stdout}\n${buildRes.stderr}`;
        const encoders = `${encoderRes.stdout}\n${encoderRes.stderr}`;
        const hwaccels = `${hwaccelRes.stdout}\n${hwaccelRes.stderr}`;
        validateLgplBuild(buildconf, encoders);

        if (platformKey === 'darwin-arm64') {
            if (!hasEncoder(encoders, 'h264_videotoolbox')) {
                throw new Error('Bundled FFmpeg does not include h264_videotoolbox.');
            }
            if (!hwaccels.includes('videotoolbox')) {
                throw new Error('Bundled FFmpeg does not include VideoToolbox hwaccel support.');
            }
            return { encoder: 'h264_videotoolbox', platformKey };
        }

        return {
            encoder: await selectWindowsEncoder(ffmpegPath, encoders),
            platformKey
        };
    })();
    ffmpegChecks.set(cacheKey, check);
    return check;
}

function parseProbeMetadata(rawText) {
    const text = String(rawText || '');
    const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    const duration = durationMatch
        ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
        : 0;
    let width = 0;
    let height = 0;
    const videoLine = text.split(/\r?\n/).find(line => line.includes('Video:')) || '';
    for (const match of videoLine.matchAll(/\b(\d{2,5})x(\d{2,5})\b/g)) {
        const w = Number(match[1]);
        const h = Number(match[2]);
        if (w >= 32 && h >= 32) {
            width = w;
            height = h;
            break;
        }
    }
    if (!duration || !width || !height) {
        throw new Error('Video metadata could not be read.');
    }
    return { width, height, duration };
}

async function probeVideo(_event, options = {}) {
    const ffmpegPath = bundledFfmpegPath();
    await ensureFfmpegCapabilities(ffmpegPath);
    const inputPath = options.inputPath;
    if (!inputPath || !fs.existsSync(inputPath)) throw new Error('Input video file was not found.');
    const result = await runProbeProcess(ffmpegPath, ['-hide_banner', '-nostdin', '-i', inputPath]);
    return parseProbeMetadata(`${result.stdout}\n${result.stderr}`);
}

function bitratePlan(duration, attempt) {
    const targetBits = attempt.targetBytes * 8;
    const audioBits = attempt.audioBitrate * duration;
    const muxOverheadBits = targetBits * 0.05;
    const videoBps = Math.max(450000, Math.floor((targetBits - audioBits - muxOverheadBits) / duration));
    return {
        videoBps,
        maxrate: Math.floor(videoBps * 1.35),
        bufsize: Math.floor(videoBps * 2)
    };
}

function videoEncoderArgs(encoder, bitrates) {
    const args = ['-c:v', encoder];
    if (encoder === 'h264_videotoolbox') {
        args.push('-allow_sw', '1', '-profile:v', 'main');
    } else if (encoder === 'libopenh264') {
        args.push('-profile:v', 'main');
    }
    args.push(
        '-b:v', String(bitrates.videoBps),
        '-maxrate', String(bitrates.maxrate),
        '-bufsize', String(bitrates.bufsize),
        '-tag:v', 'avc1'
    );
    return args;
}

function ffmpegArgs(inputPath, outputPath, attempt, duration, encoder) {
    const bitrates = bitratePlan(duration, attempt);
    return [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i', inputPath,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-vf', `scale='min(${attempt.maxSide},iw)':'min(${attempt.maxSide},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p`,
        '-fpsmax', '30',
        ...videoEncoderArgs(encoder, bitrates),
        '-c:a', 'aac',
        '-b:a', `${Math.round(attempt.audioBitrate / 1000)}k`,
        '-ac', '2',
        '-ar', '48000',
        '-movflags', '+faststart',
        '-progress', 'pipe:1',
        '-stats_period', '0.25',
        outputPath
    ];
}

function parseProgressChunk(state, chunk) {
    state.buffer += chunk;
    const lines = state.buffer.split(/\r?\n/);
    state.buffer = lines.pop() || '';
    for (const line of lines) {
        const idx = line.indexOf('=');
        if (idx === -1) continue;
        const key = line.slice(0, idx);
        const value = line.slice(idx + 1);
        if (key === 'out_time_ms') {
            const micros = Number(value);
            if (Number.isFinite(micros)) state.outTimeSeconds = micros / 1000000;
        } else if (key === 'out_time_us') {
            const micros = Number(value);
            if (Number.isFinite(micros)) state.outTimeSeconds = micros / 1000000;
        } else if (key === 'progress') {
            state.emit?.(value);
        }
    }
}

async function compressVideo(event, options = {}) {
    const ffmpegPath = bundledFfmpegPath();
    const capabilities = await ensureFfmpegCapabilities(ffmpegPath);

    const jobId = options.jobId || `video-${Date.now()}`;
    const duration = Math.max(1, Number(options.duration || 0));
    const maxBytes = Number(options.maxBytes || MAX_UPLOAD_BYTES);
    const inputPath = options.inputPath;
    if (!inputPath || !fs.existsSync(inputPath)) throw new Error('Input video file was not found.');

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aerune-video-'));
    const attempts = [
        { targetBytes: 95000000, maxSide: 1280, audioBitrate: 128000 },
        { targetBytes: 90000000, maxSide: 960, audioBitrate: 128000 },
        { targetBytes: 75000000, maxSide: 720, audioBitrate: 96000 }
    ];

    activeJobs.set(jobId, { child: null, cancelled: false, tempDir });
    try {
        for (let i = 0; i < attempts.length; i++) {
            const attempt = attempts[i];
            const outputPath = path.join(tempDir, `aerune-video-${i + 1}.mp4`);
            const progressState = {
                buffer: '',
                outTimeSeconds: 0,
                emit: () => {
                    const progress = Math.max(0, Math.min(0.99, progressState.outTimeSeconds / duration));
                    event.sender.send('video-compress-progress', { jobId, attempt: i + 1, progress });
                }
            };
            event.sender.send('video-compress-progress', { jobId, attempt: i + 1, progress: 0 });
            await runProcess(ffmpegPath, ffmpegArgs(inputPath, outputPath, attempt, duration, capabilities.encoder), {
                jobId,
                onStdout: chunk => parseProgressChunk(progressState, chunk)
            });
            const stat = await fs.promises.stat(outputPath);
            event.sender.send('video-compress-progress', { jobId, attempt: i + 1, progress: 1, size: stat.size });
            if (stat.size <= maxBytes) {
                return {
                    outputPath,
                    tempDir,
                    size: stat.size,
                    attempt: i + 1,
                    maxSide: attempt.maxSide,
                    name: 'aerune-video.mp4'
                };
            }
        }
        throw new Error('Compressed video still exceeds the Bluesky 100MB limit.');
    } catch (error) {
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        throw error;
    } finally {
        activeJobs.delete(jobId);
    }
}

function cancelCompression(jobId) {
    const job = activeJobs.get(jobId);
    if (!job) return false;
    job.cancelled = true;
    if (job.child && !job.child.killed) {
        job.child.kill('SIGTERM');
        setTimeout(() => {
            if (job.child && !job.child.killed) job.child.kill('SIGKILL');
        }, 2000);
    }
    return true;
}

async function cleanupCompression(tempDir) {
    assertInsideTemp(tempDir);
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    return true;
}

async function cleanupAllActiveJobs() {
    const jobs = Array.from(activeJobs.values());
    for (const job of jobs) {
        job.cancelled = true;
        if (job.child && !job.child.killed) job.child.kill('SIGTERM');
        if (job.tempDir) {
            await fs.promises.rm(job.tempDir, { recursive: true, force: true }).catch(() => {});
        }
    }
    activeJobs.clear();
}

module.exports = {
    bundledFfmpegPath,
    probeVideo,
    compressVideo,
    cancelCompression,
    cleanupCompression,
    cleanupAllActiveJobs
};
