import fastify, {
    FastifyInstance,
    FastifyServerOptions
} from 'fastify';
import autoload from '@fastify/autoload';
import sensible from '@fastify/sensible';
import { resolve as pathResolve } from 'node:path';
import configPlugin from './plugins/config.js';
import { getDirname, exMessage } from './utils/index.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface composeOptions extends FastifyServerOptions { }

const ModuleName = 'ComposeServer';

const composeServer = async (options: composeOptions = {}): Promise<FastifyInstance> => {
    try {
        const server = fastify(options);

        server.log.info({ tags: [ModuleName] }, `Registering plugins`);

        await server.register(configPlugin);
        await server.register(sensible);

        // server.log.info({ tags: [ModuleName] }, `🚀 Adding shared schema`);

        server.log.info({ tags: [ModuleName] }, `Registering services`);

        await server.register(autoload, {
            dir: pathResolve(getDirname(import.meta.url), 'services')
        });

        server.log.info({ tags: [ModuleName] }, `Registering routes`);

        await server.register(autoload, {
            dir: pathResolve(getDirname(import.meta.url), 'routes'),
            options: {
                prefix: '/api/v1'
            }
        });

        await server.ready();

        return server;
    }
    catch (ex) {
        throw new Error(`Failed to compose server instance: ${exMessage(ex)}`);
    }
};

export default composeServer;
