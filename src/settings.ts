import type { ChildProcess } from 'child_process';
import type { PlatformIdentifier, PlatformName, SRTPCryptoSuites } from 'homebridge';
import type { Server, Socket } from 'net';
import { defaultFfmpegPath } from '@homebridge/camera-utils';
import { Type } from 'pick-port';
import { StreamResponse } from './@types/devices.js';

export const PLATFORM_NAME = 'YS7Platform';

export const PLUGIN_NAME = '@fantasytu/homebridge-ys7';

export const ffmpegPathString = defaultFfmpegPath as unknown as string;

export const defaultPrebufferDuration = 15000;
  
export const PREBUFFER_LENGTH = 4000;
export const FRAGMENTS_LENGTH = 4000;

export interface AutomationReturn {
  error: boolean
  message: string
  cooldownActive?: boolean
}

export interface YS7PlatformConfig {
  platform: PlatformName | PlatformIdentifier
  name?: string
  appKey: string
  appSecret: string
  videoProcessor?: string
  skipOfflineDevices?: boolean
  skipEncryptedDevices?: boolean
  pollingInterval?: number
}

export interface VideoConfig {
  stream: StreamResponse
  maxStreams?: number
  ffmpegOptions?: string[]
  prebufferDuration?: number
  prebuffer?: boolean
}

export interface FfmpegProgress {
  frame: number
  fps: number
  stream_q: number
  bitrate: number
  total_size: number
  out_time_us: number
  out_time: string
  dup_frames: number
  drop_frames: number
  speed: number
  progress: string
}
export interface PrebufferFmp4 {
  atom: MP4Atom
  time: number
}

export interface Mp4Session {
  server: Server
  process: ChildProcess
}

export interface SessionInfo {
    address: string // address of the HAP controller
    ipv6: boolean
  
    videoPort: number
    videoReturnPort: number
    videoCryptoSuite: SRTPCryptoSuites // should be saved if multiple suites are supported
    videoSRTP: Buffer // key and salt concatenated
    videoSSRC: number // rtp synchronisation source
  
    audioPort: number
    audioReturnPort: number
    audioCryptoSuite: SRTPCryptoSuites
    audioSRTP: Buffer
    audioSSRC: number
  }
  
export interface ResolutionInfo {
    width: number
    height: number
    videoFilter?: string
    snapFilter?: string
    resizeFilter?: string
  }

export interface MP4Atom {
    header: Buffer
    length: number
    type: string
    data: Buffer
  }
  
export interface FFMpegFragmentedMP4Session {
    socket: Socket
    cp: ChildProcess
    generator: AsyncGenerator<MP4Atom>
  }

export interface PickPortOptions {
    type: Type;
    ip?: string;
    minPort?: number;
    maxPort?: number;
    reserveTimeout?: number;
}