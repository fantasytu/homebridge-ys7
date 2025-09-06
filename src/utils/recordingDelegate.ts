import type { ChildProcess } from 'node:child_process';
import type { Server } from 'node:net';
import type { Readable } from 'node:stream';

import type {
  API,
  CameraController,
  CameraRecordingConfiguration,
  CameraRecordingDelegate,
  HAP,
  HDSProtocolSpecificErrorReason,
  RecordingPacket,
} from 'homebridge';

import type { Logger } from './logger.js';
import type { Mp4Session } from '../settings.js';

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { env } from 'node:process';

import { APIEvent, AudioRecordingCodecType, H264Level, H264Profile } from 'homebridge';

import { PreBuffer } from './prebuffer.js';

import { MP4Atom, FFMpegFragmentedMP4Session, PREBUFFER_LENGTH } from '../settings.js';

import { Device, Stream } from '../@types/devices.js';

export async function readLength(readable: Readable, length: number): Promise<Buffer> {
  if (!length) {
    return Buffer.alloc(0);
  }

  {
    const ret = readable.read(length);
    if (ret) {
      return ret as Buffer;
    }
  }

  return new Promise((resolve, reject) => {
    const onReadable = (): void => {
      const ret = readable.read(length) as Buffer | null;
      if (ret) {
        readable.removeAllListeners();
        resolve(ret);
      }
    };

    const onError = (err: Error): void => {
      readable.removeAllListeners();
      reject(err);
    };

    readable.on('readable', onReadable);
    readable.on('error', onError);
  });
}

export async function* parseFragmentedMP4(readable: Readable): AsyncGenerator<MP4Atom> {
  while (true) {
    const header = await readLength(readable, 8);
    const length = header.readInt32BE(0) - 8;
    const type = header.slice(4).toString();
    const data = await readLength(readable, length);

    yield {
      header,
      length,
      type,
      data,
    };
  }
}

export async function listenServer(server: Server, log: Logger): Promise<number> {
  let isListening = false;
  while (!isListening) {
    const port = 10000 + Math.round(Math.random() * 30000);
    server.listen(port);
    try {
      await once(server, 'listening');
      isListening = true;
      const address = server.address();
      if (address && typeof address === 'object' && 'port' in address) {
        return (address as { port: number }).port;
      }
      throw new Error('Failed to get server address');
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      log.error(`Error while listening to the server: ${err.message}`);
    }
  }
  return 0;
}

export class RecordingDelegate implements CameraRecordingDelegate {
  updateRecordingActive(active: boolean): Promise<void> {
    this.log.debug(`Recording active status changed to: ${active}`, this.device.name);
    return Promise.resolve();
  }

  updateRecordingConfiguration(): Promise<void> {
    this.log.debug('Recording configuration updated', this.device.name);
    return Promise.resolve();
  }

  async *handleRecordingStreamRequest(streamId: number): AsyncGenerator<RecordingPacket, void, unknown> {
    this.log.debug(`Recording stream request received for stream ID: ${streamId}`, this.device.name);
    yield {} as RecordingPacket;
  }

  closeRecordingStream(streamId: number, reason: HDSProtocolSpecificErrorReason | undefined): void {
    this.log.debug(`Recording stream closed for stream ID: ${streamId}, reason: ${reason}`, this.device.name);
  }

  private readonly hap: HAP;
  private readonly log: Logger;
  private readonly device: Device;
  private readonly getStream: () => Promise<Stream>;
  private process!: ChildProcess;

  private readonly videoProcessor;
  readonly controller?: CameraController;
  private preBufferSession?: Mp4Session;
  private preBuffer?: PreBuffer;

  constructor(log: Logger, api: API, device:Device, hap: HAP, videoProcessor: string, getStream: () => Promise<Stream>) {
    this.log = log;
    this.hap = hap;
    this.device = device;
    this.videoProcessor = videoProcessor;
    this.getStream = getStream;

    api.on(APIEvent.SHUTDOWN, () => {
      if (this.preBufferSession) {
        this.preBufferSession.process?.kill();
        this.preBufferSession.server?.close();
      }
    });
  }

  async startPreBuffer(): Promise<void> {
    this.log.debug(`start prebuffer ${this.device.name}`);
    if (!this.preBuffer) {
      const stream = await this.getStream();
      if (stream?.url) {
        const input = `-i ${stream.url}`;
        this.preBuffer = new PreBuffer(this.log, input, this.device.name, this.videoProcessor);
        if (!this.preBufferSession) {
          this.preBufferSession = await this.preBuffer.startPreBuffer();
        }
      }
    }
  }

  async * handleFragmentsRequests(configuration: CameraRecordingConfiguration): AsyncGenerator<Buffer, void, unknown> {
    this.log.debug('video fragments requested', this.device.name);

    const iframeIntervalSeconds = 4;

    const audioArgs: Array<string> = [
      '-acodec',
      'libfdk_aac',
      ...(configuration.audioCodec.type === AudioRecordingCodecType.AAC_LC
        ? ['-profile:a', 'aac_low']
        : ['-profile:a', 'aac_eld']),
      '-ar',
      `${configuration.audioCodec.samplerate}k`,
      '-b:a',
      `${configuration.audioCodec.bitrate}k`,
      '-ac',
      `${configuration.audioCodec.audioChannels}`,
    ];

    const profile = configuration.videoCodec.parameters.profile === H264Profile.HIGH
      ? 'high'
      : configuration.videoCodec.parameters.profile === H264Profile.MAIN ? 'main' : 'baseline';

    const level = configuration.videoCodec.parameters.level === H264Level.LEVEL4_0
      ? '4.0'
      : configuration.videoCodec.parameters.level === H264Level.LEVEL3_2 ? '3.2' : '3.1';

    const videoArgs: Array<string> = [
      '-an',
      '-sn',
      '-dn',
      '-codec:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',

      '-profile:v',
      profile,
      '-level:v',
      level,
      '-b:v',
      `${configuration.videoCodec.parameters.bitRate}k`,
      '-force_key_frames',
      `expr:eq(t,n_forced*${iframeIntervalSeconds})`,
      '-r',
      configuration.videoCodec.resolution[2].toString(),
    ];

    const ffmpegInput: Array<string> = [];

    if (this.preBuffer) {
      const fragmentLen = configuration.mediaContainerConfiguration.fragmentLength ?? PREBUFFER_LENGTH;
      const input: Array<string> = await this.preBuffer.getVideo(fragmentLen);
      ffmpegInput.push(...input);
    } else {
      const stream = await this.getStream();
      if (stream?.url) {
        ffmpegInput.push('-i', stream.url);
      }
    }

    this.log.debug('Start recording...', this.device.name);

    const session = await this.startFFMPegFragmetedMP4Session(
      this.videoProcessor,
      ffmpegInput,
      audioArgs,
      videoArgs,
    );
    this.log.debug('Recording started', this.device.name);

    const { socket, cp, generator } = session;
    let pending: Array<Buffer> = [];
    let filebuffer: Buffer = Buffer.alloc(0);
    try {
      for await (const box of generator) {
        const { header, type, length, data } = box;

        pending.push(header, data);

        if (type === 'moov' || type === 'mdat') {
          const fragment = Buffer.concat(pending);
          filebuffer = Buffer.concat([filebuffer, Buffer.concat(pending)]);
          pending = [];
          yield fragment;
        }
        this.log.debug(`mp4 box type ${type} and lenght: ${length}`, this.device.name);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.log.debug(`Recoding completed. ${err.message}`, this.device.name);
    } finally {
      socket.destroy();
      cp.kill();
    }
  }

  async startFFMPegFragmetedMP4Session(
    ffmpegPath: string,
    ffmpegInput: Array<string>,
    audioOutputArgs: Array<string>,
    videoOutputArgs: Array<string>,
  ): Promise<FFMpegFragmentedMP4Session> {
    return new Promise((resolve) => {
      const server = createServer((socket) => {
        server.close();
        async function* generator(): AsyncGenerator<MP4Atom> {
          while (true) {
            const header = await readLength(socket, 8);
            const length = header.readInt32BE(0) - 8;
            const type = header.slice(4).toString();
            const data = await readLength(socket, length);

            yield {
              header,
              length,
              type,
              data,
            };
          }
        }
        const cp = this.process;
        resolve({
          socket,
          cp,
          generator: generator(),
        });
      });

      listenServer(server, this.log).then((serverPort) => {
        const args: Array<string> = [];

        args.push(...ffmpegInput);

        // args.push(...audioOutputArgs);

        args.push('-f', 'mp4');
        args.push(...videoOutputArgs);
        args.push('-fflags', '+genpts', '-reset_timestamps', '1');
        args.push(
          '-movflags',
          'frag_keyframe+empty_moov+default_base_moof',
          `tcp://127.0.0.1:${serverPort}`,
        );

        this.log.debug(`${ffmpegPath} ${args.join(' ')}`, this.device.name);

        const debug = false;

        const stdioValue = debug ? 'pipe' : 'ignore';
        this.process = spawn(ffmpegPath, args, { env, stdio: stdioValue });
        const cp = this.process;

        if (debug) {
          if (cp.stdout) {
            cp.stdout.on('data', (data: Buffer) => this.log.debug(data.toString(), this.device.name));
          }
          if (cp.stderr) {
            cp.stderr.on('data', (data: Buffer) => this.log.debug(data.toString(), this.device.name));
          }
        }
      });
    });
  }
}
