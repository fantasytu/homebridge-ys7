import { Logger } from './logger.js';
import { WebhookMessageHeader, WebhookMessageResponse, WEBHOOK_HEADER_SIGNATURE, WEBHOOK_HEADER_TIMESTAMP } from '../@types/webhook.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';


export class Webhook {
  private readonly log: Logger;
  private server?: http.Server;
  private process?: (header: WebhookMessageHeader, data: Record<string, unknown>) => Promise<void>;

  constructor(log: Logger, 
    port: number, 
    path: string, 
    secret: string, 
    process?: (header: WebhookMessageHeader, data: Record<string, unknown>) => Promise<void>) {
    this.log = log;
    this.process = process;
    
    this.startServer(port, path, secret);
  }

  public verifySignature(secret: string, payload: string, signature: string): boolean {
    try {
      const expected = createHmac('sha1', secret).update(payload, 'utf8').digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(signature);
      if (a.length !== b.length) {
        return false;
      }
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private startServer(port: number, path: string, secret?: string): void {
    if (this.server) {
      this.server.close();
    }
    
    this.server = http.createServer(async (req, res) => {
      try {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        if (req.url !== path) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }

        const chunks: Uint8Array[] = [];
        req.on('data', (chunk) => chunks.push(chunk));

        req.on('end', async () => {
          try {
            const rawBody = Buffer.concat(chunks);

            // HmacSHA1 verification if configured
            if (secret) {
              const timestamp = req.headers[WEBHOOK_HEADER_TIMESTAMP] as number | undefined;
              const signature = req.headers[WEBHOOK_HEADER_SIGNATURE] as number | undefined;
              if (timestamp && signature) {
                const valid = this.verifySignature(secret, rawBody.toString('utf8') + timestamp, String(signature));
                if (!valid) {
                  this.log.warn('Invalid webhook signature');
                  res.statusCode = 401;
                  res.end('Invalid signature');
                  return;
                }
              }
            }

            const response = JSON.parse(rawBody.toString('utf8')) as WebhookMessageResponse;
            const body = response.body;
            const header = response.header as WebhookMessageHeader;
            
            // Notify platform about new data
            if (this.process) {
              await this.process(header, body);
            }

            // Return only messageId
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              messageId: header.messageId,
            }));
          } catch (e) {
            this.log.error(`Webhook parse error: ${(e as Error).message}`);
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              messageId: 'unknown',
              status: 'error',
              message: 'Bad Request',
            }));
          }
        });
      } catch (e) {
        this.log.error(`Webhook error: ${(e as Error).message}`);
        res.statusCode = 500;
        res.end('Internal Error');
      }
    });

    this.server.listen(port, 'localhost', () => {
      this.log.info(`Webhook listening on localhost:${port}${path}`);
    });
  }

  public close(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  }
}