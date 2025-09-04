export enum Endpoints {
    // bsae url
    EZVIZ_BASE_URL = 'https://open.ys7.com',
    // token endpoints
    GET_TOKEN = '/api/lapp/token/get',
    // device endpoints
    DEVICE_LIST = '/api/lapp/device/list',
    DEVICE_INFO = '/api/v3/device/searchDeviceInfo',
    DEVICE_STATUS = '/api/lapp/device/status/get',
    DEVICE_CHANNEL = '/api/lapp/device/camera/list',
    // device control endpoints
    DEVICE_DEFENCE = '/api/lapp/device/defence/set',
    DEVICE_LIGHT = '/api/lapp/device/light/switch/set',
    DEVICE_LIGHT_STATUS = '/api/lapp/device/light/switch/status',
    DEVICE_ENCRYPTION_ON = '/api/lapp/device/encrypt/on',
    DEVICE_ENCRYPTION_OFF = '/api/lapp/device/encrypt/off',
    DEVICE_CHARGING_STATE = '/api/v3/device/power/status/get',
    // capacity endpoints
    CAPACITIES = '/api/lapp/device/capacity',
    // snapshot endpoint
    SNAPSHOT = '/api/lapp/device/capture',
    // stream endpoint
    STREAM = '/api/lapp/v2/live/address/get'
}