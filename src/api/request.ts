import querystring from 'querystring';

import { Logger } from '../utils/logger.js';

import { Endpoints } from './endpoints.js';

import { YS7PlatformConfig } from '../settings.js';

import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';

import { ResponseCodes, ErrorMessages } from './errors.js';

export default class YS7Request {
  private readonly log: Logger;
  private config: YS7PlatformConfig;
  private readonly instance : AxiosInstance;
  private tokenInfo = { accessToken: '', expireTime: 0 };

  constructor(log: Logger, config: YS7PlatformConfig) {
    this.log = log;
    this.config = config;
    this.instance = axios.create({
      baseURL: Endpoints.EZVIZ_BASE_URL,
      timeout: 10000,
    });
    this._initInterceptors();
  }

  async request(path: Endpoints, data?: Record<string, string | number | boolean>, method: string = 'POST') {
    this.log.debug(`Getting ${path} with data: ${querystring.stringify(data)}`);

    const dataWithToken = { ...data, accessToken: this.tokenInfo.accessToken };

    const response = await this.instance({
      method,
      headers: method === 'GET' ? dataWithToken : { 'Content-Type': 'application/x-www-form-urlencoded' },
      url: path,
      data: method === 'POST' ? querystring.stringify(dataWithToken) : undefined,
    });

    return response.data;
  }

  isLogin() {
    return this.tokenInfo.accessToken.length > 0;
  }

  isTokenExpired() {
    return (this.tokenInfo.expireTime - 60 * 1000 <= new Date().getTime());
  }

  async refreshTokenIfNeeded() {
    if (this.isLogin() || !this.isTokenExpired()) {
      return;
    }

    this.log.debug('Getting accessToken');
    const response = await axios.post(
      Endpoints.EZVIZ_BASE_URL + Endpoints.GET_TOKEN,
      querystring.stringify({ appKey: this.config.appKey, appSecret: this.config.appSecret }),
    );
    
    this.tokenInfo = response.data.data;

    this.log.debug(`accessToken refreshed: ${JSON.stringify(this.tokenInfo)}`);
  }

  _initInterceptors() {
    this.instance.defaults.headers.post['Content-Type'] = 'application/x-www-form-urlencoded';

    this.instance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        this.log.debug(`Requesting ${config.method?.toUpperCase()} ${config.url}`);

        await this.refreshTokenIfNeeded();

        config.headers.accessToken = this.tokenInfo.accessToken;
        config.data = { ...querystring.parse(config.data), accessToken: this.tokenInfo.accessToken };

        return config;
      },
      (error) => {
        return Promise.reject(error);
      },
    );

    this.instance.interceptors.response.use(
      (response: AxiosResponse) => {

        const data = response.data.result ?? response.data;

        if (data && (data.code === ResponseCodes.SUCCESS || data.code === ResponseCodes.SUCCESS2)) {
          return data;
        }
        
        this.log.error(`${ErrorMessages.API_ERROR}, code = ${data.code}, msg = ${data.msg}`);

        return Promise.reject(response.data);
      },
      (error) => {
        this.log.error(`${ErrorMessages.API_ERROR}, error = ${error}`);
        return Promise.reject(error.response || error.message || error.toString());
      },
    );
  }
}