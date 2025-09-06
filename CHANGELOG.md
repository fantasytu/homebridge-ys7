# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2025-09-06

### Added
- Webhook support for Ezviz device events
  - HTTP server listening on configurable localhost port and path
  - HMAC-SHA1 signature verification using body + timestamp
  - Support for alarm events (motion, doorbell) and device status updates
- TypeScript definitions for Ezviz webhook payloads
  - `WebhookMessageType` enum with official Ezviz message types
  - `EzvizAlarmType` enum with specific alarm codes from documentation
  - Complete webhook payload interfaces and types
- Configuration schema reorganization
  - Grouped settings into logical sections (Credentials, Devices, Data Updates)
  - Added polling and webhook sub-groups under Data Updates
  - Added descriptions for appKey and appSecret fields

### Changed
- Webhook configuration now uses `webhookPort` and `webhookPath` instead of `webhookEnable`
- Polling can be disabled by setting `pollingInterval` to 0
- Configuration schema layout improved for better user experience

### Technical Details
- Webhook server validates HMAC-SHA1 signatures using `Signature` and `T` headers
- Motion events trigger HomeKit motion sensors
- Doorbell events trigger HomeKit doorbell services
- Webhook can be disabled by leaving `webhookPort` and `webhookPath` empty

## [1.1.0] - 2025-09-04

### Added
- Enhanced ffmpeg input handling for HTTPS HLS streams
  - Added protocol whitelist for HTTPS support
  - Added user-agent header for better compatibility
- Configurable polling interval for device data updates
  - Default 60 seconds, can be disabled by setting to 0
  - Updates battery, indicator, and other device status

### Fixed
- Fixed "Error opening input: No such file or directory" for HTTPS m3u8 streams
- Corrected ffmpeg executable path to use `ffmpeg-for-homebridge`
- Improved URL quoting in ffmpeg arguments

### Technical Details
- Added `-protocol_whitelist file,http,https,tcp,tls,crypto` to ffmpeg arguments
- Added `-user_agent HomebridgeYS7` for better stream compatibility
- Ensured proper URL escaping for complex HTTPS URLs
