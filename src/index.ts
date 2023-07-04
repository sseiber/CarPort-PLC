import { IGarageDoorControllerConfig } from './models/carportTypes';
import { resolve as pathResolve } from 'path';
import * as dotenv from 'dotenv';
dotenv.config({
    path: `${pathResolve(__dirname, '..', 'configs', 'envConfig')}.env`
});

import { manifest } from './manifest';
import { compose, ComposeOptions } from 'spryly';
import * as os from 'os';
import { forget } from './utils';

declare module '@hapi/hapi' {
    interface ServerOptionsApp {
        carport?: IGarageDoorControllerConfig[];
    }
}

const composeOptions: ComposeOptions = {
    relativeTo: __dirname,
    logCompose: {
        serializers: {
            req: (req: any) => {
                return `${(req.method || '').toUpperCase()} ${req.headers?.host} ${req.url}`;
            },
            res: (res: any) => {
                return `${res.statusCode} ${res.raw?.statusMessage}`;
            },
            tags: (tags: any) => {
                return `[${tags}]`;
            },
            responseTime: (responseTime: any) => {
                return `${responseTime}ms`;
            },
            err: (error: any) => {
                return error;
            }
        },
        redact: ['req.headers.authorization'],
        transport: {
            target: 'pino-pretty',
            options: {
                colorize: true,
                messageFormat: '{tags} {data} {req} {res} {responseTime}',
                translateTime: 'SYS:yyyy-mm-dd"T"HH:MM:sso',
                ignore: 'pid,hostname,tags,data,req,res,responseTime'
            }
        }
    }
};

// process.on('unhandledRejection', (e: any) => {
/* eslint-disable */
//     console.log(['startup', 'error'], `Excepction on startup... ${e.message}`);
//     console.log(['startup', 'error'], e.stack);
/* eslint-enable */
// });

async function start() {
    const carportServiceConfigs = JSON.parse(process.env.CARPORT_SERVICE_CONFIG);
    if (!Array.isArray(carportServiceConfigs)) {
        throw new Error('Error: Invalid CarPort Service environment options detected');
    }

    const server = await compose(manifest(carportServiceConfigs), composeOptions);

    const stopServer = async () => {
        server.log(['shutdown', 'info'], '☮︎ Stopping hapi server');
        await server.stop({ timeout: 10000 });

        server.log(['shutdown', 'info'], `⏏︎ Server stopped`);
        process.exit(0);
    };

    process.on('SIGINT', stopServer);
    process.on('SIGTERM', stopServer);

    server.log(['startup', 'info'], `🚀 Starting HAPI server instance...`);
    await server.start();

    server.log(['startup', 'info'], `✅ CarPort Service started`);
    server.log(['startup', 'info'], `🌎 ${server.info.uri}`);
    server.log(['startup', 'info'], ` > Hapi version: ${server.version}`);
    server.log(['startup', 'info'], ` > Plugins: [${Object.keys(server.registrations).join(', ')}]`);
    server.log(['startup', 'info'], ` > Machine: ${os.platform()}, ${os.cpus().length} core, ` +
        `freemem=${(os.freemem() / 1024 / 1024).toFixed(0)}mb, totalmem=${(os.totalmem() / 1024 / 1024).toFixed(0)}mb`);
}

forget(start);
