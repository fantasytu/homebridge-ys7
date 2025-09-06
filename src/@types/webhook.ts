// Ezviz Open Platform webhook message types
// Reference: https://open.ys7.com/help/571

export enum WebhookMessageType {
  // Per Ezviz docs
  Alarm = 'ys.alarm',
  OnOffLine = 'ys.onoffline',
  OpenIsapi = 'ys.open.isapi',
  Calling = 'ys.calling',
  OpenRam = 'ys.open.ram',
  Iot = 'ys.iot',
  OpenCloud = 'ys.open.cloud',
  DeviceSlaves = 'ys.device.slaves',
  DeviceStatus = 'ys.devicestatus'
}

export interface WebhookMessageResponse {
  body: Record<string, unknown>,
  header: WebhookMessageHeader
}

export interface WebhookMessageHeader {
  type: string,
  deviceId: string,
  channelNo: string,
  messageId: string,
  messageTime: number
}

// Webhook headers (Node lowers header names to lowercase)
export const WEBHOOK_HEADER_SIGNATURE = 'signature';
export const WEBHOOK_HEADER_TIMESTAMP = 't';