// import type { Buffer } from 'node:buffer';

import type { API, CharacteristicSetCallback, CharacteristicValue, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import type { AutomationReturn } from './settings.js';
import type { YS7PlatformConfig } from './settings.js';

import { APIEvent, CharacteristicEventTypes, PlatformAccessoryEvent } from 'homebridge';

import { PLUGIN_NAME, PLATFORM_NAME, VideoConfig } from './settings.js';

import { Logger } from './utils/logger.js';
import { StreamingDelegate } from './utils/streamingDelegate.js';

import { YS7Api, LightStatus, ChargingStates, DefenceStatus } from './api/api.js';

import { Device, DeviceResponse, DeviceEncryptionStatus, DeviceStatus, SupportedDeviceCategories, Capacity } from './@types/devices.js';

import { ErrorMessages } from './api/errors.js';

export class YS7Platform implements DynamicPlatformPlugin {
  private readonly log: Logger;
  private readonly api: API;
  private readonly config: YS7PlatformConfig;
  private readonly cachedAccessories: string[] = [];
  private readonly accessories: Map<string, PlatformAccessory> = new Map();
  private readonly motionTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly doorbellTimers: Map<string, NodeJS.Timeout> = new Map();
  private pollTimer?: NodeJS.Timeout;

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = new Logger(log);
    this.api = api;
    this.config = config as YS7PlatformConfig;

    api.on(APIEvent.DID_FINISH_LAUNCHING, this.didFinishLaunching.bind(this));
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Configuring cached bridged accessory...', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);

    this.cachedAccessories.push(accessory.UUID);
  }

  // configurate accessory information
  async configureInfoService(device:Device, accessory: PlatformAccessory) {
        
    const infoService = accessory.getService(this.api.hap.Service.AccessoryInformation);

    if (infoService) {
      infoService.setCharacteristic(this.api.hap.Characteristic.Manufacturer, 'Ezviz');
      infoService.setCharacteristic(this.api.hap.Characteristic.Model, device.model);
      infoService.setCharacteristic(this.api.hap.Characteristic.SerialNumber, device.serial);
      infoService.setCharacteristic(this.api.hap.Characteristic.FirmwareRevision, device.firmware);
    }
  }

  // configure hksv streaming
  async configureHKSV(device: Device, api:YS7Api, accessory: PlatformAccessory) {
    
    this.log.debug('get streaming url', device.name);
    const streamURL = await api.getStreamAddress(device.serial);

    const videoConfig: VideoConfig = {
      stream: streamURL,
      prebuffer: true,
    };

    const delegate = new StreamingDelegate(this.log, this.api, device, videoConfig, this.api.hap);

    accessory.configureController(delegate.controller);

    // add motion sensor after accessory.configureController. Secure Video creates it own linked motion service
    this.log.debug('add motion service', device.name);

    const motionSensorService = new this.api.hap.Service.MotionSensor(device.name);

    if (!accessory.getService(this.api.hap.Service.MotionSensor)) {
      accessory.addService(motionSensorService);
    } else {
      this.log.debug('found motion sensor service', device.name);
    }
  }

  async configureBatteryService(device: Device, api:YS7Api, accessory: PlatformAccessory) {
    const batteryService = new this.api.hap.Service.Battery(device.name);

    batteryService
      .getCharacteristic(this.api.hap.Characteristic.StatusLowBattery)
      .on(CharacteristicEventTypes.GET, async (callback: CharacteristicSetCallback) => {
        const status = (await api.getCameraStatus(device.serial)).battryStatus;
        if (status !== undefined) {
          if (status <= 20) {
            callback(null, this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
          } else {
            callback(null, this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
          }
        } else {
          callback(null, this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
        }
      });

    batteryService
      .getCharacteristic(this.api.hap.Characteristic.BatteryLevel)
      .on(CharacteristicEventTypes.GET, async (callback: CharacteristicSetCallback) => {
        const status = (await api.getCameraStatus(device.serial)).battryStatus;
        if (status !== undefined) {
          callback(null, status);
        } else {
          callback(null, 100);
        }
      });

    batteryService
      .getCharacteristic(this.api.hap.Characteristic.ChargingState)
      .on(CharacteristicEventTypes.GET, async (callback: CharacteristicSetCallback) => {
        const state = (await api.getChargingState(device.serial)).valueInfo.powerStatus;
        switch (state) {
        case ChargingStates.NOT_CHARGING, ChargingStates.FULLY_CHARGED:
          callback(null, this.api.hap.Characteristic.ChargingState.NOT_CHARGING);
          break;
        case ChargingStates.CHARGING:
          callback(null, this.api.hap.Characteristic.ChargingState.CHARGING);
          break;
        default:
          callback(null, this.api.hap.Characteristic.ChargingState.NOT_CHARGEABLE);
          break;
        }
      });

    if (!accessory.getService(this.api.hap.Service.Battery)) {
      accessory.addService(batteryService);
    } else {
      this.log.debug('found battery service', device.name);
    }
  }
  
  async configreIndicatorService(device: Device, api:YS7Api, accessory: PlatformAccessory) {
    const indicator = new this.api.hap.Service.Lightbulb(`${device.name} Indicator`);

    indicator
      .getCharacteristic(this.api.hap.Characteristic.On)
      .on(CharacteristicEventTypes.GET, async (callback: CharacteristicSetCallback) => {
        const status = (await api.getLightStatus(device.serial)).enable;
        callback(null, status === LightStatus.ON);
      })
      .on(CharacteristicEventTypes.SET, (state: CharacteristicValue, callback: CharacteristicSetCallback) => {
        if (state as boolean) {
          api.turnLightOn(device.serial);
        } else {
          api.turnLightOff(device.serial);
        }
        callback();
      });
      
    if (!accessory.getService(this.api.hap.Service.Lightbulb)) {
      accessory.addService(indicator);
    } else {
      this.log.debug('found indicator service', device.name);
    }
  }

  async configureDoorbellService(device: Device, api:YS7Api, accessory: PlatformAccessory) {
    const doorbell = new this.api.hap.Service.Doorbell(`${device.name} Doorbell`);

    if (!accessory.getService(this.api.hap.Service.Doorbell)) {
      accessory.addService(doorbell);
    } else {
      this.log.debug('found doorbell sensor service', device.name);
    }

    const doorbellTrigger = new this.api.hap.Service.Switch(`${device.name} Doorbell Trigger`, 'DoorbellTrigger');
    doorbellTrigger
      .getCharacteristic(this.api.hap.Characteristic.On)
      .on(CharacteristicEventTypes.SET, (state: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.doorbellHandler(accessory, state as boolean);
        callback();
      });
    accessory.addService(doorbellTrigger);
  }

  // TODO: add defence switch
  // async configureDefenceService(device: Device, api:YS7Api, accessory: PlatformAccessory) {
  // }

  async setupAccessory(api: YS7Api, accessory: PlatformAccessory): Promise<void> {
    accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
      this.log.debug('Identify requested.', accessory.displayName);
    });

    const device = accessory.context.device as Device;

    // determine camera features
    const cameraConfig = {
      battery: device.capacities.get(Capacity.BATTERY) === '1',
      indicator: device.capacities.get(Capacity.INDICATOR) === '1',
      // defence: capacities.get(Capacities.DEFENCE) === 1,
      // talk: capacities.get(Capacities.MICROPHONE) === 1,
      doorbell: undefined,
    };

    this.configureInfoService(device, accessory);

    await this.configureHKSV(device, api, accessory);

    if (cameraConfig.battery) { 
      await this.configureBatteryService(device, api, accessory);
    }

    if (cameraConfig.doorbell) {
      await this.configureDoorbellService(device, api, accessory);
    }

    if (cameraConfig.indicator) {
      await this.configreIndicatorService(device, api, accessory);
    }
  }

  private doorbellHandler(accessory: PlatformAccessory, active = true): AutomationReturn {
    const doorbell = accessory.getService(this.api.hap.Service.Doorbell);
    if (doorbell) {
      this.log.debug(`Switch doorbell ${active ? 'on.' : 'off.'}`, accessory.displayName);
      const timeout = this.doorbellTimers.get(accessory.UUID);
      if (timeout) {
        clearTimeout(timeout);
        this.doorbellTimers.delete(accessory.UUID);
      }
      const doorbellTrigger = accessory.getServiceById(this.api.hap.Service.Switch, 'DoorbellTrigger');
      if (active) {
        doorbell.updateCharacteristic(this.api.hap.Characteristic.ProgrammableSwitchEvent, this.api.hap.Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
        if (doorbellTrigger) {
          doorbellTrigger.updateCharacteristic(this.api.hap.Characteristic.On, true);
          const timeoutConfig = 1;
          const timer = setTimeout(() => {
            this.log.debug('Doorbell handler timeout.', accessory.displayName);
            this.doorbellTimers.delete(accessory.UUID);
            doorbellTrigger.updateCharacteristic(this.api.hap.Characteristic.On, false);
          }, timeoutConfig * 1000);
          this.doorbellTimers.set(accessory.UUID, timer);
        }
        return {
          error: false,
          message: 'Doorbell switched on.',
        };
      } else {
        if (doorbellTrigger) {
          doorbellTrigger.updateCharacteristic(this.api.hap.Characteristic.On, false);
        }
        return {
          error: false,
          message: 'Doorbell switched off.',
        };
      }
    } else {
      return {
        error: true,
        message: 'Doorbell is not enabled for this camera.',
      };
    }
  }

  private motionHandler(accessory: PlatformAccessory, active = true, minimumTimeout = 0): AutomationReturn {
    const motionSensor = accessory.getService(this.api.hap.Service.MotionSensor);
    if (motionSensor) {
      this.log.debug(`Switch motion detect ${active ? 'on.' : 'off.'}`, accessory.displayName);
      const timeout = this.motionTimers.get(accessory.UUID);
      if (timeout) {
        clearTimeout(timeout);
        this.motionTimers.delete(accessory.UUID);
      }
      const motionTrigger = accessory.getServiceById(this.api.hap.Service.Switch, 'MotionTrigger');
      if (active) {
        motionSensor.updateCharacteristic(this.api.hap.Characteristic.MotionDetected, true);
        if (motionTrigger) {
          motionTrigger.updateCharacteristic(this.api.hap.Characteristic.On, true);
        }
        // if (!timeout && config?.motionDoorbell) {
        //   this.doorbellHandler(accessory, true);
        // }
        let timeoutConfig = 1;
        if (timeoutConfig < minimumTimeout) {
          timeoutConfig = minimumTimeout;
        }
        if (timeoutConfig > 0) {
          const timer = setTimeout(() => {
            this.log.debug('Motion handler timeout.', accessory.displayName);
            this.motionTimers.delete(accessory.UUID);
            motionSensor.updateCharacteristic(this.api.hap.Characteristic.MotionDetected, false);
            if (motionTrigger) {
              motionTrigger.updateCharacteristic(this.api.hap.Characteristic.On, false);
            }
          }, timeoutConfig * 1000);
          this.motionTimers.set(accessory.UUID, timer);
        }
        return {
          error: false,
          message: 'Motion switched on.',
          cooldownActive: !!timeout,
        };
      } else {
        motionSensor.updateCharacteristic(this.api.hap.Characteristic.MotionDetected, false);
        if (motionTrigger) {
          motionTrigger.updateCharacteristic(this.api.hap.Characteristic.On, false);
        }
        // if (config?.motionDoorbell) {
        //   this.doorbellHandler(accessory, false);
        // }
        return {
          error: false,
          message: 'Motion switched off.',
        };
      }
    } else {
      return {
        error: true,
        message: 'Motion is not enabled for this camera.',
      };
    }
  }

  private async formatDevices(api: YS7Api, devices: DeviceResponse[]): Promise<Device[]> {
    const formatedDevices: Device[] = [];
    const shouldSkipOffline = this.config.skipOfflineDevices ?? false;
    
    for (const device of devices) {
      // check encryption status
      const deviceInfo = await api.getCameraInfo(device.deviceSerial);

      if (deviceInfo.isEncrypt === DeviceEncryptionStatus.ENCRYPTED) {
        api.disableEncryption(device.deviceSerial);
        this.log.info('Turning off encryption for homekit streaming', device.deviceName);
      }

      // filter unsupported, offline and encrypted devices
      const capacitiesObject = JSON.parse(deviceInfo.supportExt);
      const supported = device.parentCategory && Object.values(SupportedDeviceCategories).includes(device.parentCategory as SupportedDeviceCategories);
      const skipOffline = shouldSkipOffline && device.status === DeviceStatus.OFFLINE;

      if (!supported) {
        this.log.info(`${ErrorMessages.UNSUPPORTED_DEVICE_CATEGORY} ${device.parentCategory} : ${device.deviceName}`);
      }
      
      if (skipOffline) {
        this.log.info(`${ErrorMessages.OFFLINE_DEVICE}: ${device.deviceName}`);
      }

      formatedDevices.push({
        id: this.api.hap.uuid.generate(device.id),
        serial: device.deviceSerial,
        name: device.deviceName,
        model: device.deviceType,
        status: device.status as DeviceStatus,
        defence: device.defence as DefenceStatus,
        firmware: [...device.deviceVersion.matchAll(/\d+/g)].map(a => parseInt(a[0])).join('.'),
        category: device.parentCategory,
        capacities: new Map<string, string>(Object.entries(capacitiesObject)),
      } as Device);
    }

    return formatedDevices;
  }

  async discoverDevices(api: YS7Api) {
    const cameras = await api.getCameras();

    if (!cameras) {
      this.log.error(ErrorMessages.NO_DEVICE);
      return;
    }

    const devices = await this.formatDevices(api, cameras);
    this.log.debug(`Found ${devices.length} devices`);

    for (const device of devices) {
      const existingAccessory = this.accessories.get(device.id);
      if (existingAccessory) {
        this.log.debug(`Restoring existing ${device.category} from cache: ${existingAccessory.displayName}`);
        existingAccessory.context.device = device;
        this.setupAccessory(api, existingAccessory);
      } else {
        this.log.debug(`Adding new ${device.category}: ${device.name}`);
        const accessory = new this.api.platformAccessory(device.name, device.id);
        accessory.context.device = device;
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(accessory.UUID, accessory);
        this.setupAccessory(api, accessory);
      }

      this.cachedAccessories.push(device.id);
    }

    // Remove accessories that are no longer available
    for (const [, accessory] of this.accessories) {
      if (!this.cachedAccessories.includes(accessory.UUID)) {
        this.log.debug('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  async didFinishLaunching(): Promise<void> {
    const ys7API = new YS7Api(this.config, this.log);
    await this.discoverDevices(ys7API);

    // polling
    this.startPolling(ys7API);
  }

  private startPolling(api: YS7Api) {
    const intervalSeconds = Math.max(10, this.config.pollingInterval ?? 60);
    
    this.log.debug(`Starting polling every ${intervalSeconds}s`);

    this.pollTimer = setInterval(() => {
      this.pollOnce(api).catch(err => this.log.error('Polling error', String(err)));
    }, intervalSeconds * 1000);
  }

  private async pollOnce(api: YS7Api): Promise<void> {
    for (const [, accessory] of this.accessories) {
      const device = accessory.context.device as Device;
      if (!device) {
        continue;
      }
      await this.pollBatteryForAccessory(api, accessory, device);
      await this.pollIndicatorForAccessory(api, accessory, device);
    }
  }

  private async pollBatteryForAccessory(api: YS7Api, accessory: PlatformAccessory, device: Device): Promise<void> {
    const batteryService = accessory.getService(this.api.hap.Service.Battery);

    if (!batteryService) {
      return;
    }

    try {
      const status = (await api.getCameraStatus(device.serial)).battryStatus;
      if (status !== undefined) {
        batteryService.updateCharacteristic(this.api.hap.Characteristic.BatteryLevel, status);
        const low = status <= 20
          ? this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
          : this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        batteryService.updateCharacteristic(this.api.hap.Characteristic.StatusLowBattery, low);
        this.log.debug(`Updating battery level: ${status}`);
      }
    } catch {
      this.log.debug('Failed to poll battery status', accessory.displayName);
    }

    try {
      const state = (await api.getChargingState(device.serial)).valueInfo.powerStatus;
      switch (state) {
      case ChargingStates.NOT_CHARGING:
      case ChargingStates.FULLY_CHARGED:
        batteryService.updateCharacteristic(this.api.hap.Characteristic.ChargingState, this.api.hap.Characteristic.ChargingState.NOT_CHARGING);
        break;
      case ChargingStates.CHARGING:
        batteryService.updateCharacteristic(this.api.hap.Characteristic.ChargingState, this.api.hap.Characteristic.ChargingState.CHARGING);
        break;
      default:
        batteryService.updateCharacteristic(this.api.hap.Characteristic.ChargingState, this.api.hap.Characteristic.ChargingState.NOT_CHARGEABLE);
        break;
      }
      this.log.debug(`Updating charging state: ${state}`);
    } catch {
      this.log.debug('Failed to poll charging state', accessory.displayName);
    }
  }

  private async pollIndicatorForAccessory(api: YS7Api, accessory: PlatformAccessory, device: Device): Promise<void> {
    const indicatorService = accessory.getService(this.api.hap.Service.Lightbulb);

    if (!indicatorService) {
      return;
    }

    try {
      const status = (await api.getLightStatus(device.serial)).enable;
      indicatorService.updateCharacteristic(this.api.hap.Characteristic.On, status === LightStatus.ON);
      this.log.debug(`Updating indicator status: ${status}`);
    } catch {
      this.log.debug('Failed to poll indicator status', accessory.displayName);
    }
  }
}
