import YS7Request from './request.js'; 

import type { YS7PlatformConfig } from '../settings.js';

import { Logger } from '../utils/logger.js';

import { Endpoints } from './endpoints.js';

enum StreamProtocol {
  EZOPEN = 1,
  HLS = 2,
  RTMP = 3,
  FLV = 4,
}

enum ExpireTime {
  ONE_HOUR = 3600,
  ONE_DAY = 86400,
  ONE_WEEK = 604800,
}

export enum VideoEncodeType {
  H264 = 0,
  H265 = 1,
}

export enum SimpleDefenceStatus {
  DISABLED = 0,
  ENABLED = 1
}

export enum DefenceStatus {
  NIGHT_MODE = 0,
  ENABLED = 1,
  HOME_MODE = 8,
  AWAY_MODE = 16,
}

export enum LightStatus {
  OFF = 0,
  ON = 1
}

export enum ChargingStates {
  NOT_CHARGING = '0',
  CHARGING = '1',
  FULLY_CHARGED = '2',
  NO_BATTERY = '3',
  BROKEN = '4',
}

/**
 * EZVIZ API client for interacting with EZVIZ services
 */
export class YS7Api {
  private log: Logger;
  private request: YS7Request;

  constructor(config: YS7PlatformConfig, log: Logger) {
    this.log = log;
    this.request = new YS7Request(log!, config);
  }

  async getCameras() {
    this.log.debug('Fetching camera list');
    return await this.request.request(Endpoints.DEVICE_LIST);
  }

  async getCameraInfo(deviceSerial: string) {
    this.log.debug(`Fetching info for camera: ${deviceSerial}`);
    return await this.request.request(Endpoints.DEVICE_INFO, { deviceSerial: deviceSerial });
  }

  async getCameraStatus(deviceSerial: string) {
    this.log.debug(`Fetching status for camera: ${deviceSerial}`);
    return await this.request.request(Endpoints.DEVICE_STATUS, { deviceSerial: deviceSerial });
  }

  async getCameraChannels(deviceSerial: string) {
    this.log.debug(`Fetching channels for camera: ${deviceSerial}`);
    return await this.request.request(Endpoints.DEVICE_CHANNEL, { deviceSerial: deviceSerial });
  }

  async getCameraCapacities(deviceSerial: string) {
    this.log.debug(`Fetching capacities for camera: ${deviceSerial}`);
    return await this.request.request(Endpoints.CAPACITIES, { deviceSerial: deviceSerial });
  }

  async getStreamAddress(deviceSerial: string, channelNo: number = 1, videoEncodeType: VideoEncodeType = VideoEncodeType.H264) {
    this.log.debug(`Fetching stream address for camera: ${deviceSerial}, channel: ${channelNo}`);
    return await this.request.request(
      Endpoints.STREAM, 
      {
        deviceSerial: deviceSerial, 
        channelNo: channelNo,
        protocol: StreamProtocol.HLS,
        expireTime: ExpireTime.ONE_DAY, 
        videoEncodeType: videoEncodeType,
      },
    );
  }

  private async setDefence(deviceSerial: string, defence: number) {
    this.log.debug(`Setting defence for camera: ${deviceSerial} to ${defence}`);
    return await this.request.request(Endpoints.DEVICE_DEFENCE, { deviceSerial: deviceSerial, isDefence: defence });
  }

  async enableDefence(deviceSerial: string) {
    this.setDefence(deviceSerial, SimpleDefenceStatus.ENABLED);
  }
  
  async disableDefence(deviceSerial: string) {
    this.setDefence(deviceSerial, SimpleDefenceStatus.DISABLED);
  }

  async setDefenceNightMode(deviceSerial: string) {
    this.setDefence(deviceSerial, DefenceStatus.NIGHT_MODE);
  }

  async setDefenceAwayMode(deviceSerial: string) {
    this.setDefence(deviceSerial, DefenceStatus.AWAY_MODE);
  }

  async setDefenceHomeMode(deviceSerial: string) {
    this.setDefence(deviceSerial, DefenceStatus.HOME_MODE);
  }

  private async setLightStatus(deviceSerial: string, status: LightStatus) {
    this.log.debug(`Setting light for camera: ${deviceSerial} to ${status === 1 ? 'on' : 'off'}`);
    return await this.request.request(Endpoints.DEVICE_LIGHT, { deviceSerial: deviceSerial, enable: status });
  }

  async turnLightOn(deviceSerial: string) {
    this.setLightStatus(deviceSerial, LightStatus.ON);
  }
  
  async turnLightOff(deviceSerial: string) {
    this.setLightStatus(deviceSerial, LightStatus.OFF);
  }

  async getLightStatus(deviceSerial: string) {
    this.log.debug(`Fetching light status for camera: ${deviceSerial}`);
    return await this.request.request(Endpoints.DEVICE_LIGHT_STATUS, { deviceSerial: deviceSerial });
  }

  async enableEncryption(deviceSerial: string) {
    this.log.debug(`Enabling encryption for camera: ${deviceSerial}`);
    return await this.request.request(Endpoints.DEVICE_ENCRYPTION_ON, { deviceSerial: deviceSerial });
  }

  async disableEncryption(deviceSerial: string) {
    this.log.debug(`Disabling encryption for camera: ${deviceSerial}`);
    return await this.request.request(Endpoints.DEVICE_ENCRYPTION_OFF, { deviceSerial: deviceSerial });
  }

  async getChargingState(deviceSerial: string) {
    this.log.debug(`Fetching charging status for camera: ${deviceSerial}`);
    try {
      return await this.request.request(Endpoints.DEVICE_CHARGING_STATE, { deviceSerial: deviceSerial }, 'GET');
    } catch (error) {
      this.log.warn(`Failed to fetch charging state for ${deviceSerial}, returning default NOT_CHARGING state`);
      return { valueInfo: { powerStatus: ChargingStates.NOT_CHARGING } };
    }
  }

}
