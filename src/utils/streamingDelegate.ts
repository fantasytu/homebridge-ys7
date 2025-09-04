import type {
  API,
  AudioRecordingCodec,
  CameraController,
  CameraControllerOptions,
  CameraStreamingDelegate,
  HAP,
  PrepareStreamCallback,
  PrepareStreamRequest,
  PrepareStreamResponse,
  SnapshotRequest,
  SnapshotRequestCallback,
  StartStreamRequest,
  StreamingRequest,
  StreamRequestCallback,
  VideoInfo,
} from 'homebridge';

import { PickPortOptions, ResolutionInfo, SessionInfo, VideoConfig, FRAGMENTS_LENGTH, PREBUFFER_LENGTH } from '../settings.js';
import type { Logger } from './logger.js';

import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createSocket, Socket } from 'node:dgram';
import { env } from 'node:process';

import {
  APIEvent,
  AudioRecordingCodecType,
  AudioRecordingSamplerate,
  AudioStreamingCodecType,
  AudioStreamingSamplerate,
  StreamRequestTypes,
} from 'homebridge';
import { pickPort } from 'pick-port';

import { FfmpegProcess } from './ffmpeg.js';
import { RecordingDelegate } from './recordingDelegate.js';

import { Device } from '../@types/devices.js';

export interface ActiveSession {
  mainProcess?: FfmpegProcess
  returnProcess?: FfmpegProcess
  timeout?: NodeJS.Timeout
  socket?: Socket
}

export class StreamingDelegate implements CameraStreamingDelegate {
  private readonly hap: HAP;
  private readonly log: Logger;
  private readonly device: Device;
  private readonly videoConfig!: VideoConfig;
  private readonly videoProcessor: string = 'ffmpeg';
  private snapshotPromise?: Promise<Buffer>;
  private readonly api: API;

  readonly controller: CameraController;
  recordingDelegate: RecordingDelegate | null = null;

  // keep track of sessions
  pendingSessions: Map<string, SessionInfo> = new Map();
  ongoingSessions: Map<string, ActiveSession> = new Map();
  timeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(log: Logger, api: API, device: Device, videoConfig: VideoConfig ,hap: HAP) {
    this.log = log;
    this.hap = hap;
    this.api = api;
    this.device = device;
    this.videoConfig = videoConfig;

    api.on(APIEvent.SHUTDOWN, () => {
      for (const session in this.ongoingSessions) {
        this.stopStream(session);
      }
    });

    const recordingCodecs: AudioRecordingCodec[] = [];

    const samplerate: AudioRecordingSamplerate[] = [];
    for (const sr of [AudioRecordingSamplerate.KHZ_32]) {
      samplerate.push(sr);
    }

    for (const type of [AudioRecordingCodecType.AAC_LC]) {
      const entry: AudioRecordingCodec = {
        type,
        bitrateMode: 0,
        samplerate,
        audioChannels: 1,
      };
      recordingCodecs.push(entry);
    }
    this.recordingDelegate = new RecordingDelegate(this.log, this.api, this.device, this.hap, this.videoProcessor, this.videoConfig);

    const options: CameraControllerOptions = {
      cameraStreamCount: 2, // HomeKit requires at least 2 streams, but 1 is also just fine
      delegate: this,
      streamingOptions: {
        supportedCryptoSuites: [hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
        video: {
          resolutions: [
            [320, 180, 30],
            [320, 240, 15], // Apple Watch requires this configuration
            [320, 240, 30],
            [480, 270, 30],
            [480, 360, 30],
            [640, 360, 30],
            [640, 480, 30],
            [1280, 720, 30],
            [1280, 960, 30],
            [1920, 1080, 30],
            [1600, 1200, 30],
          ],
          codec: {
            profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
            levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0],
          },
        },
        audio: {
          twoWayAudio: false,
          codecs: [
            {
              type: AudioStreamingCodecType.AAC_ELD,
              samplerate: AudioStreamingSamplerate.KHZ_16,
            },
          ],
        },
      },
      recording: /*! this.recording ? undefined : */ {
        options: {
          prebufferLength: PREBUFFER_LENGTH,
          overrideEventTriggerOptions: [hap.EventTriggerOption.MOTION, hap.EventTriggerOption.DOORBELL],
          mediaContainerConfiguration: [{
            type: 0,
            fragmentLength: FRAGMENTS_LENGTH,
          }],
          video: {
            type: hap.VideoCodecType.H264,
            parameters: {
              levels: [hap.H264Level.LEVEL3_1, hap.H264Level.LEVEL3_2, hap.H264Level.LEVEL4_0],
              profiles: [hap.H264Profile.BASELINE, hap.H264Profile.MAIN, hap.H264Profile.HIGH],
            },
            resolutions: [
              [320, 180, 30],
              [320, 240, 15], // Apple Watch requires this configuration
              [320, 240, 30],
              [480, 270, 30],
              [480, 360, 30],
              [640, 360, 30],
              [640, 480, 30],
              [1280, 720, 30],
              [1280, 960, 30],
              [1920, 1080, 30],
              [1600, 1200, 30],
            ],
          },
          audio: {
            codecs: recordingCodecs,

          },
        },
        delegate: this.recordingDelegate!,
      },
    };
    this.controller = new hap.CameraController(options);
    if (this.videoConfig.prebuffer) {
      this.recordingDelegate?.startPreBuffer();
    }
  }

  private determineResolution(request: SnapshotRequest | VideoInfo): ResolutionInfo {
    const resInfo: ResolutionInfo = {
      width: request.width,
      height: request.height,
    };
    const filters: Array<string> = [];
    const noneFilter = filters.indexOf('none');
    if (noneFilter >= 0) {
      filters.splice(noneFilter, 1);
    }
    resInfo.snapFilter = filters.join(',');
    if ((noneFilter < 0) && (resInfo.width > 0 || resInfo.height > 0)) {
      const widthExpr = resInfo.width > 0 ? `'min(${resInfo.width},iw)'` : 'iw';
      const heightExpr = resInfo.height > 0 ? `'min(${resInfo.height},ih)'` : 'ih';
      resInfo.resizeFilter = `scale=${widthExpr}:${heightExpr}:force_original_aspect_ratio=decrease`;
      filters.push(resInfo.resizeFilter);
      filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2'); // Force to fit encoder restrictions
    }

    if (filters.length > 0) {
      resInfo.videoFilter = filters.join(',');
    }

    return resInfo;
  }

  async fetchSnapshot(snapFilter?: string): Promise<Buffer> {
    this.snapshotPromise = new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const ffmpegArgs = `-i ${this.videoConfig.stream.url}`
        + ` -frames:v 1${snapFilter ? ` -filter:v ${snapFilter}` : ''}`
        + ' -f mjpeg -hide_banner -loglevel error pipe:1';

      this.log.debug(
        `Snapshot command: ${this.videoProcessor} ${ffmpegArgs}`,
        this.device.name,
      );
      const ffmpeg = spawn(this.videoProcessor, ffmpegArgs.split(/\s+/), { env });

      let snapshotBuffer = Buffer.alloc(0);

      ffmpeg.stdout.on('data', (data) => {
        snapshotBuffer = Buffer.concat([snapshotBuffer, data]);
      });

      ffmpeg.on('error', (error: Error) => {
        reject(new Error(`FFmpeg process creation failed: ${error.message}`));
      });

      ffmpeg.stderr.on('data', (data) => {
        data.toString().split('\n').forEach((line: string) => {
          if (line.length > 0) {
            this.log.error(line, `${this.device.name}] [Snapshot`);
          }
        });
      });

      ffmpeg.on('close', () => {
        if (snapshotBuffer.length > 0) {
          resolve(snapshotBuffer);
        } else {
          reject(new Error('Failed to fetch snapshot.'));
        }

        setTimeout(() => {
          this.snapshotPromise = undefined;
        }, 3 * 1000); // Expire cached snapshot after 3 seconds

        const runtime = (Date.now() - startTime) / 1000;
        let message = `Fetching snapshot took ${runtime} seconds.`;
        if (runtime < 5) {
          this.log.debug(message, this.device.name);
        } else {
          if (runtime < 22) {
            this.log.warn(message, this.device.name);
          } else {
            message += ' The request has timed out and the snapshot has not been refreshed in HomeKit.';
            this.log.error(message, this.device.name);
          }
        }
      });
    });
    return this.snapshotPromise;
  }

  resizeSnapshot(snapshot: Buffer, resizeFilter?: string): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const ffmpegArgs = '-i pipe:' // Resize
        + ` -frames:v 1${resizeFilter ? ` -filter:v ${resizeFilter}` : ''
        } -f image2 -`;

      this.log.debug(`Resize command: ${this.videoProcessor} ${ffmpegArgs}`, this.device.name);
      const ffmpeg = spawn(this.videoProcessor, ffmpegArgs.split(/\s+/), { env });

      let resizeBuffer = Buffer.alloc(0);
      ffmpeg.stdout.on('data', (data) => {
        resizeBuffer = Buffer.concat([resizeBuffer, data]);
      });
      ffmpeg.on('error', (error: Error) => {
        reject(new Error(`FFmpeg process creation failed: ${error.message}`));
      });
      ffmpeg.on('close', () => {
        resolve(resizeBuffer);
      });
      ffmpeg.stdin.end(snapshot);
    });
  }

  async handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): Promise<void> {
    const resolution = this.determineResolution(request);

    try {
      const cachedSnapshot = !!this.snapshotPromise;

      this.log.debug(`Snapshot requested: ${request.width} x ${request.height}`, this.device.name);

      const snapshot = await (this.snapshotPromise || this.fetchSnapshot(resolution.snapFilter));

      this.log.debug(
        `Sending snapshot: ${
          resolution.width > 0 ? resolution.width : 'native'
        } x ${
          resolution.height > 0 ? resolution.height : 'native'
        }${cachedSnapshot ? ' (cached)' : ''}`,
        this.device.name,
      );

      const resized = await this.resizeSnapshot(snapshot, resolution.resizeFilter);
      callback(undefined, resized);
    } catch (err) {
      this.log.error(err as string, this.device.name);
      callback(err as Error);
    }
  }

  async prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): Promise<void> {
    const ipv6 = request.addressVersion === 'ipv6';

    const options: PickPortOptions = {
      type: 'udp',
      ip: ipv6 ? '::' : '0.0.0.0',
      reserveTimeout: 15,
    };
    const videoReturnPort = await pickPort(options);
    const videoSSRC = this.hap.CameraController.generateSynchronisationSource();
    const audioReturnPort = await pickPort(options);
    const audioSSRC = this.hap.CameraController.generateSynchronisationSource();

    const sessionInfo: SessionInfo = {
      address: request.targetAddress,
      ipv6,

      videoPort: request.video.port,
      videoReturnPort,
      videoCryptoSuite: request.video.srtpCryptoSuite,
      videoSRTP: Buffer.concat([request.video.srtp_key, request.video.srtp_salt]),
      videoSSRC,

      audioPort: request.audio.port,
      audioReturnPort,
      audioCryptoSuite: request.audio.srtpCryptoSuite,
      audioSRTP: Buffer.concat([request.audio.srtp_key, request.audio.srtp_salt]),
      audioSSRC,
    };

    const response: PrepareStreamResponse = {
      video: {
        port: videoReturnPort,
        ssrc: videoSSRC,

        srtp_key: request.video.srtp_key,
        srtp_salt: request.video.srtp_salt,
      },
      audio: {
        port: audioReturnPort,
        ssrc: audioSSRC,

        srtp_key: request.audio.srtp_key,
        srtp_salt: request.audio.srtp_salt,
      },
    };

    this.pendingSessions.set(request.sessionID, sessionInfo);
    callback(undefined, response);
  }

  handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
    switch (request.type) {
    case StreamRequestTypes.START:
      this.startStream(request, callback);
      break;
    case StreamRequestTypes.RECONFIGURE:
      this.log.debug(
        `Received request to reconfigure: ${request.video.width} x ${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps`,
        this.device.name,
      );
      callback();
      break;
    case StreamRequestTypes.STOP:
      this.stopStream(request.sessionID);
      callback();
      break;
    }
  }

  private startStream(request: StartStreamRequest, callback: StreamRequestCallback): void {
    const sessionInfo = this.pendingSessions.get(request.sessionID);
    if (sessionInfo) {
      const vcodec = 'libx264';
      const mtu = request.video.mtu || 1316;

      const resolution = this.determineResolution(request.video);

      const fps = request.video.fps;
      const videoBitrate = request.video.max_bit_rate;

      this.log.debug(
        `Video stream requested: ${request.video.width} x ${request.video.height}, ${request.video.fps} fps, ${request.video.max_bit_rate} kbps`,
        this.device.name,
      );
      this.log.debug(
        `Starting video stream: ${
          resolution.width > 0 ? resolution.width : 'native'
        } x ${
          resolution.height > 0 ? resolution.height : 'native'
        }, ${fps > 0 ? fps : 'native'} fps, ${
          videoBitrate > 0 ? videoBitrate : '???'
        } kbps`,
        this.device.name,
      );

      let ffmpegArgs = `-i ${this.videoConfig.stream.url}`;

      ffmpegArgs // Video
        += ' -an -sn -dn'
        + ` -codec:v ${vcodec}`
        + ' -pix_fmt yuv420p'
        + ' -profile:v baseline'
        + ' -level:v 3.1'
        + `${fps > 0 ? ` -r ${fps}` : ''}`
        + `${resolution.videoFilter ? ` -filter:v ${resolution.videoFilter}` : ''}`
        + `${videoBitrate > 0 ? ` -b:v ${videoBitrate}k` : ''}`
        + ` -payload_type ${request.video.pt}`;

      ffmpegArgs // Video Stream
        += ` -ssrc ${sessionInfo.videoSSRC}`
        + ' -f rtp'
        + ' -srtp_out_suite AES_CM_128_HMAC_SHA1_80'
        + ` -srtp_out_params ${sessionInfo.videoSRTP.toString('base64')}`
        + ` srtp://${sessionInfo.address}:${sessionInfo.videoPort}`
        + `?rtcpport=${sessionInfo.videoPort}&pkt_size=${mtu}`;

      // Audio upstream (talk) is supported via separate return process below

      ffmpegArgs += ' -loglevel level -progress pipe:1';

      const activeSession: ActiveSession = {};

      activeSession.socket = createSocket(sessionInfo.ipv6 ? 'udp6' : 'udp4');
      activeSession.socket.on('error', (err: Error) => {
        this.log.error(`Socket error: ${err.message}`, this.device.name);
        this.stopStream(request.sessionID);
      });
      activeSession.socket.on('message', () => {
        if (activeSession.timeout) {
          clearTimeout(activeSession.timeout);
        }
        activeSession.timeout = setTimeout(() => {
          this.log.debug('Device appears to be inactive. Stopping stream.', this.device.name);
          this.controller.forceStopStreamingSession(request.sessionID);
          this.stopStream(request.sessionID);
        }, request.video.rtcp_interval * 5 * 1000);
      });
      activeSession.socket.bind(sessionInfo.videoReturnPort);

      activeSession.mainProcess = new FfmpegProcess(this.device.name, request.sessionID, this.videoProcessor, ffmpegArgs, this.log, false, this, callback);

      /*
       * Two-way audio (commented out as requested). Keep for future use.
       * To re-enable: remove this comment block and set twoWayAudio: true above.
       *
       * const enableTwoWayAudio = true;
       * if (enableTwoWayAudio) {
       *   const ffmpegReturnArgs
       *     = '-hide_banner'
       *       + ' -protocol_whitelist pipe,udp,rtp,file,crypto'
       *       + ' -f sdp'
       *       + ' -c:a libfdk_aac'
       *       + ' -i pipe:'
       *       + ' -loglevel level';
       *
       *   const ipVer = sessionInfo.ipv6 ? 'IP6' : 'IP4';
       *
       *   const sdpReturnAudio
       *     = 'v=0\r\n'
       *       + `o=- 0 0 IN ${ipVer} ${sessionInfo.address}\r\n`
       *       + 's=Talk\r\n'
       *       + `c=IN ${ipVer} ${sessionInfo.address}\r\n`
       *       + 't=0 0\r\n'
       *       + `m=audio ${sessionInfo.audioReturnPort} RTP/AVP 110\r\n`
       *       + 'b=AS:24\r\n'
       *       + 'a=rtpmap:110 MPEG4-GENERIC/16000/1\r\n'
       *       + 'a=rtcp-mux\r\n'
       *       + 'a=fmtp:110 '
       *       + 'profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; '
       *       + 'config=F8F0212C00BC00\r\n'
       *       + `a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:${sessionInfo.audioSRTP.toString('base64')}\r\n`;
       *   const returnProc = new FfmpegProcess(
       *     `${this.device.name}] [Two-way`,
       *     request.sessionID,
       *     this.videoProcessor,
       *     ffmpegReturnArgs,
       *     this.log,
       *     false,
       *     this,
       *   );
       *   activeSession.returnProcess = returnProc;
       *   returnProc.stdin.end(sdpReturnAudio);
       * }
       */

      this.ongoingSessions.set(request.sessionID, activeSession);
      this.pendingSessions.delete(request.sessionID);
    } else {
      this.log.error('Error finding session information.', this.device.name);
      callback(new Error('Error finding session information'));
    }
  }

  public stopStream(sessionId: string): void {
    const session = this.ongoingSessions.get(sessionId);
    if (session) {
      if (session.timeout) {
        clearTimeout(session.timeout);
      }
      try {
        session.socket?.close();
      } catch (err) {
        this.log.error(`Error occurred closing socket: ${err}`, this.device.name);
      }
      try {
        session.mainProcess?.stop();
      } catch (err) {
        this.log.error(`Error occurred terminating main FFmpeg process: ${err}`, this.device.name);
      }
      try {
        session.returnProcess?.stop();
      } catch (err) {
        this.log.error(`Error occurred terminating two-way FFmpeg process: ${err}`, this.device.name);
      }
    }
    this.ongoingSessions.delete(sessionId);
    this.log.debug('Stopped video stream.', this.device.name);
  }
}
