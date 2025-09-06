export interface Device {
    id: string;
    serial: string;
    name: string;
    model: string;
    status: number;
    defence: number;
    firmware: string;
    category: string;
    capacities: Map<string, string>;
}

export interface DeviceResponse {
    id: string;
    deviceSerial: string;
    deviceName: string;
    deviceType: string;
    status: number;
    defence: number;
    deviceVersion: string;
    addTime: number;
    updateTime: number;
    parentCategory: string;
    riskLevel: number;
    netAddress: string;
}

export interface Stream {
  id: string
  url: string
  expireTime: string
}

export enum DeviceStatus {
    ONLINE = 1,
    OFFLINE = 0
}

export enum DeviceEncryptionStatus {
    UNENCRYPTED = 0,
    ENCRYPTED = 1
}

export enum SupportedDeviceCategories {
    CAMERA = 'Camera',
    Battery_Camera = 'BatteryCamera',
}

export enum Capacity {
    DEFENCE = 'support_defence',
    INDICATOR = 'support_device_light',
    BATTERY = 'support_battery_manage',
    MICROPHONE = 'support_talk',
    ENCRYPTION = 'support_encrypt'
}