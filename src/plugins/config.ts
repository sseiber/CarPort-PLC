import {
    envSchema,
    JSONSchemaType
} from 'env-schema';
import {
    FastifyInstance,
    FastifyPluginCallback,
    HookHandlerDoneFunction
} from 'fastify';
import fp from 'fastify-plugin';
import {
    resolve as pathResolve
} from 'node:path';
import * as fse from 'fs-extra';
import { getDirname, exMessage } from '../utils/index.js';
import { IGarageDoorControllerConfig } from '../models/index.js';

export const PluginName = 'config';

interface ICarportPlcEnv {
    NODE_ENV: string;
    LOG_LEVEL: string;
    PORT: string;
    carportPlcStorage: string;
    configFile: string;
}

interface ICarportConfig {
    env: ICarportPlcEnv;
    controllerConfigs: IGarageDoorControllerConfig[];
}

const configSchema: JSONSchemaType<ICarportPlcEnv> = {
    type: 'object',
    properties: {
        NODE_ENV: {
            type: 'string',
            default: 'development'
        },
        LOG_LEVEL: {
            type: 'string',
            default: 'info'
        },
        PORT: {
            type: 'string',
            default: '9092'
        },
        carportPlcStorage: {
            type: 'string',
            default: 'storage'
        },
        configFile: {
            type: 'string',
            default: ''
        }
    },
    required: [
        'NODE_ENV',
        'LOG_LEVEL',
        'PORT',
        'carportPlcStorage',
        'configFile'
    ]
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface IConfigPluginOptions { }

const configPlugin: FastifyPluginCallback<IConfigPluginOptions> = (server: FastifyInstance, _options: IConfigPluginOptions, done: HookHandlerDoneFunction): void => {
    server.log.info({ tags: [PluginName] }, `Registering...`);

    try {
        const envConfig = envSchema<ICarportPlcEnv>({
            schema: configSchema,
            data: process.env,
            dotenv: {
                path: pathResolve(getDirname(import.meta.url), `../configs/${process.env.NODE_ENV}.env`)
            }
        });

        for (const key of Object.keys(envConfig)) {
            if (!envConfig[key]) {
                return done(new Error(`envConfig missing required value for: ${key}`));
            }
        }

        const storageRoot = envConfig.carportPlcStorage
            ? pathResolve(__dirname, '..', envConfig.carportPlcStorage)
            : '/rpi-gd/data';

        const garageDoorControllerConfig: IGarageDoorControllerConfig[] = fse.readJsonSync(pathResolve(storageRoot, 'garageDoorControllerConfig.json')) as IGarageDoorControllerConfig[];
        if (!Array.isArray(garageDoorControllerConfig)) {
            throw new Error('Error: Invalid Carport garage door configuration detected');
        }

        server.decorate(PluginName, {
            env: envConfig,
            controllerConfigs: garageDoorControllerConfig
        });

        return done();
    }
    catch (ex) {
        server.log.error({ tags: [PluginName] }, `registering failed: ${exMessage(ex)}`);

        return done(ex as Error);
    }
};

declare module 'fastify' {
    interface FastifyInstance {
        [PluginName]: ICarportConfig;
    }
}

export default fp(configPlugin, {
    fastify: '5.x',
    name: PluginName
});
