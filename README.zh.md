<div align="center">

  <div style="padding: 100px 0;">
    <img src="assets/homebridge-color-round.svg" alt="Homebridge" height="90" style="vertical-align: middle;" />
    &nbsp;&nbsp;&nbsp;&nbsp;
    <img src="assets/ezviz.svg" alt="萤石 EZVIZ" height="90" style="vertical-align: middle;" />
  </div>

  <h1>Homebridge YS7</h1>
  <p>Homebridge 的萤石（EZVIZ/萤石云，YS7）摄像头插件，支持 HKSV，电池/指示灯轮询，配置简单。</p>

  <p>
    <a href="README.md">English</a>
    ·
    <a href="https://github.com/fantasytu/homebridge-ys7/issues">问题反馈</a>
  </p>

  <p>
    <a href="https://www.npmjs.com/package/homebridge-ys7"><img src="https://img.shields.io/npm/v/homebridge-ys7.svg?color=cb3837&logo=npm" alt="npm 版本" /></a>
    <a href="https://www.npmjs.com/package/homebridge-ys7"><img src="https://img.shields.io/npm/dm/homebridge-ys7.svg" alt="npm 下载量" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache--2.0-blue.svg" alt="许可证: Apache-2.0" /></a>
    <a href="https://github.com/fantasytu/homebridge-ys7"><img src="https://img.shields.io/badge/Homebridge-Plugin-7783ff?logo=homebridge" alt="homebridge 插件" /></a>
    <a href="https://github.com/sponsors/fantasytu"><img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-ff69b4" alt="赞助" /></a>
  </p>
</div>

### 功能特性

- 支持兼容机型的 HKSV 录像
- 可选的电池服务（电量、低电量、充电状态）
- 可选的指示灯作为 Lightbulb 服务（开/关）
- 可配置的轮询，定期刷新电池与指示灯状态
- 可配置跳过不支持或离线设备

### 环境要求

- Node.js 18+（推荐）以及已运行的 Homebridge
- 萤石开放平台 App Key 与 App Secret

### 安装

```bash
npm i -g @fantasytu/homebridge-ys7
```

### 配置

在 Homebridge 的 `config.json` 中添加：

```json
{
  "platforms": [
    {
      "platform": "YS7Platform",
      "name": "YS7Platform",
      "appKey": "YOUR_APP_KEY",
      "appSecret": "YOUR_APP_SECRET",
      "videoProcessor": "ffmpeg",
      "skipOfflineDevices": true,
      "pollingInterval": 60
    }
  ]
}
```

字段说明：

- `platform`（必填）：固定为 `YS7Platform`
- `appKey`（必填）：萤石开放平台 App Key
- `appSecret`（必填）：萤石开放平台 App Secret
- `videoProcessor`（可选）：ffmpeg 的路径或名称，默认 `ffmpeg`
- `skipOfflineDevices`（可选）：跳过被报告为离线的摄像头，默认 `true`
- `pollingInterval`（可选）：轮询间隔（秒），默认 `60`，最小 `10`

### 工作原理

- 启动后通过萤石 API 发现摄像头；
- 对支持的设备，配置 HKSV，并添加运动检测、电池、指示灯等服务；
- 后台定时器每隔 `pollingInterval` 秒轮询设备状态，更新 HomeKit 特征值。

### 常见问题

- 确认 `appKey`/`appSecret` 正确并与萤石账号绑定；
- 直播/录像失败时，检查是否已安装 ffmpeg，`videoProcessor` 路径是否正确；
- 提高 Homebridge 日志级别，并检查网络/防火墙是否阻断萤石接口访问。

### 致谢

- 基于 Homebridge 生态与社区；
- 萤石/YS7 API 的使用受其服务条款约束。

### 许可证

MIT


