export enum ResponseCodes {
    SUCCESS = '200',
    SUCCESS2 = '20020',
    // token errors
    PARAMETER_ERROR = '10001',
    APPKEY_ERROR = '10005',
    APPKEY_NOT_EXIST = '10017',
    APPKEY_APPSECRET_NOT_MATCH = '10030',
    INVALID_DATA = '49999',

    // device errors
}

export enum ErrorMessages {
    // token errors
    API_ERROR = 'API error',
    
    // device errors
    NO_DEVICE = 'No device found',
    UNSUPPORTED_DEVICE_CATEGORY = 'Device skipped due to unsupported device category',
    OFFLINE_DEVICE = 'Offline device skipped',
    ENCRYPTED_DEVICE = 'Encrypted device skipped',
}