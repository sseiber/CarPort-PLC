import {
    FastifyInstance,
    FastifyPluginAsync
} from 'fastify';
import fp from 'fastify-plugin';
import {
    IServiceReply,
    IServiceResponseSchema,
    IServiceErrorMessageSchema,
    IObserveRequest,
    IObserveRequestSchema,
    ICarportServiceRequest,
    ICarportServiceRequestSchema
} from '../models/index.js';
import { exMessage } from '../utils/index.js';
import { ServiceName as CarportServiceName } from '../services/carport.js';

const RouteName = 'carportRouter';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ICarportRouterOptions { }

const carportRouterPlugin: FastifyPluginAsync<ICarportRouterOptions> = async (server: FastifyInstance, options: ICarportRouterOptions): Promise<void> => {
    server.log.info({ tags: [RouteName] }, `registering...`);

    // This internal register provides a way to pass the 'prefix' option into a plugin wrapped route
    await server.register(async (serverRoute, _routeOptions) => {
        try {
            serverRoute.route<{ Body: IObserveRequest; Reply: IServiceReply }>({
                method: 'POST',
                url: '/observe',
                schema: {
                    body: IObserveRequestSchema,
                    response: {
                        201: IServiceResponseSchema,
                        '4xx': IServiceErrorMessageSchema,
                        '5xx': IServiceErrorMessageSchema
                    }
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${RouteName}: ${request.method} ${request.url}`);

                    // NOTE: parameter validation is done by the schema validation

                    const observeRequest = request.body;

                    try {
                        const observeResponse = serverRoute.carportService.observe(observeRequest);

                        return response.status(201).send(observeResponse);
                    }
                    catch (ex) {
                        throw serverRoute.httpErrors.badRequest(exMessage(ex));
                    }
                }
            });

            serverRoute.route<{ Body: ICarportServiceRequest; Reply: IServiceReply }>({
                method: 'POST',
                url: '/control',
                schema: {
                    body: ICarportServiceRequestSchema,
                    response: {
                        201: IServiceResponseSchema,
                        '4xx': IServiceErrorMessageSchema,
                        '5xx': IServiceErrorMessageSchema
                    }
                },
                handler: async (request, response) => {
                    serverRoute.log.info({ tags: [RouteName] }, `${RouteName}: ${request.method} ${request.url}`);

                    // NOTE: parameter validation is done by the schema validation

                    const controlRequest = request.body;

                    try {
                        const controlResponse = await serverRoute.carportService.control(controlRequest);

                        return response.status(201).send(controlResponse);
                    }
                    catch (ex) {
                        throw serverRoute.httpErrors.badRequest(exMessage(ex));
                    }
                }
            });
        }
        catch (ex) {
            serverRoute.log.error({ tags: [RouteName] }, `registering routes failed: ${exMessage(ex)}`);

            throw new Error(`Failed to register ${RouteName} ${exMessage(ex)}`);
        }

        return Promise.resolve();
    }, options);
};

export default fp(carportRouterPlugin, {
    fastify: '5.x',
    name: RouteName,
    dependencies: [
        CarportServiceName
    ]
});
