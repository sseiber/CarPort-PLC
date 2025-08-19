import {
    FastifyInstance,
    FastifyPluginCallback,
    HookHandlerDoneFunction
} from 'fastify';
import fp from 'fastify-plugin';
import {
    ICarportServiceRequest,
    IObserveRequest,
    GarageDoorAction,
    GarageDoorId1,
    GarageDoorStatus,
    IServiceResponse
} from '../models/index.js';
import { exMessage } from '../utils/index.js';
import { PluginName as ConfigPluginName } from '../plugins/config.js';
import { GarageDoorController } from './garageDoorController.js';

export const ServiceName = 'carportService';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ICarportServicePluginOptions { }

const carportServicePlugin: FastifyPluginCallback<ICarportServicePluginOptions> = (server: FastifyInstance, _options: ICarportServicePluginOptions, done: HookHandlerDoneFunction): void => {
    server.log.info({ tags: [ServiceName] }, `Registering...`);

    try {
        const carportService = new CarportService(server);

        server.decorate(ServiceName, carportService);
    }
    catch (ex) {
        server.log.error({ tags: [ServiceName] }, `registering failed: ${exMessage(ex)}`);

        return done(ex as Error);
    }

    return done();
};

class CarportService {
    private server: FastifyInstance;
    private garageDoorControllers: GarageDoorController[];

    constructor(server: FastifyInstance) {
        this.server = server;
        this.garageDoorControllers = [];
    }

    public async init(): Promise<void> {
        this.server.log.info({ tags: [ServiceName] }, `CarportService initialzation`);

        try {
            this.garageDoorControllers = await this.initializeGarageDoorControllers();
        }
        catch (ex) {
            this.server.log.error({ tags: [ServiceName] }, `An error occurred initializing the garage door controller: ${exMessage(ex)}`);
        }
    }

    public observe(observeRequest: IObserveRequest): IServiceResponse {
        const response: IServiceResponse = {
            succeeded: true,
            statusCode: 201,
            message: 'The request succeeded'
        };

        this.server.log.info({ tags: [ServiceName] }, `Carport request for garageDoorId ${observeRequest.garageDoorId}, targets:\n${JSON.stringify(observeRequest.observeTargets, null, 4)})}`);

        try {
            let message;

            response.succeeded = this.garageDoorControllers[observeRequest.garageDoorId].observe(observeRequest.observeTargets);
            response.message = message ?? `Carport request for garageDoorId ${observeRequest.garageDoorId} was processed.`;

            this.server.log.info({ tags: [ServiceName] }, response.message);
        }
        catch (ex) {
            response.succeeded = false;
            response.message = `Carport request for garageDoorId ${observeRequest.garageDoorId} failed with exception: ${exMessage(ex)}`;

            this.server.log.error({ tags: [ServiceName] }, response.message);
        }

        return response;
    }

    public async control(controlRequest: ICarportServiceRequest): Promise<IServiceResponse> {
        const response: IServiceResponse = {
            succeeded: true,
            statusCode: 201,
            message: 'The request succeeded',
            data: {
                status: GarageDoorStatus.Unknown
            }
        };

        this.server.log.info({ tags: [ServiceName] }, `Carport request for garageDoorId ${controlRequest.garageDoorId}, action ${controlRequest.action} was received`);

        try {
            let message;
            let status = GarageDoorStatus.Unknown;

            switch (controlRequest.action) {
                case GarageDoorAction.Actuate:
                    status = await this.garageDoorControllers[controlRequest.garageDoorId].actuate();
                    break;

                case GarageDoorAction.Open:
                    status = await this.garageDoorControllers[controlRequest.garageDoorId].open();
                    break;

                case GarageDoorAction.Close:
                    status = await this.garageDoorControllers[controlRequest.garageDoorId].close();
                    break;

                case GarageDoorAction.Check:
                    status = this.garageDoorControllers[controlRequest.garageDoorId].check();
                    break;

                case GarageDoorAction.StartMeasurement:
                    await this.garageDoorControllers[controlRequest.garageDoorId].startTFLunaMeasurement();
                    response.message = `Garage door distance measurement started...`;
                    break;

                case GarageDoorAction.StopMeasurement:
                    await this.garageDoorControllers[controlRequest.garageDoorId].stopTFLunaMeasurement();
                    response.message = `Garage door distance measurement stopped`;
                    break;

                case GarageDoorAction.GetMeasurement:
                    await this.garageDoorControllers[controlRequest.garageDoorId].getTFLunaMeasurement();
                    break;

                default:
                    message = `Carport request for garageDoorId ${controlRequest.garageDoorId}, action ${String(controlRequest.action)} is not recognized`;
                    break;
            }

            response.message = message ?? `Carport request for garageDoorId ${controlRequest.garageDoorId}, action ${controlRequest.action} was processed with status ${status}`;
            response.data = {
                status
            };

            this.server.log.info({ tags: [ServiceName] }, response.message);
        }
        catch (ex) {
            response.succeeded = false;
            response.statusCode = 500;
            response.message = `Carport request for garageDoorId ${controlRequest.garageDoorId}, action ${controlRequest.action} failed with exception: ${exMessage(ex)}`;

            this.server.log.error({ tags: [ServiceName] }, response.message);
        }

        return response;
    }

    private async initializeGarageDoorControllers(): Promise<GarageDoorController[]> {
        this.server.log.info({ tags: [ServiceName] }, `initializeGarageDoorControllers`);

        const garageDoorControllers: GarageDoorController[] = [];

        try {
            const garageDoorControllerConfigs = this.server.config.controllerConfigs;

            this.server.log.info({ tags: [ServiceName] }, `Garage controller configuration:\n${JSON.stringify(garageDoorControllerConfigs)}\n`);

            this.server.log.info({ tags: [ServiceName] }, `Creating garage controllers`);

            let garageDoorId = GarageDoorId1;
            for (const garageDoorControllerConfig of garageDoorControllerConfigs) {
                const garageDoorController = GarageDoorController.createGarageDoorController(this.server, garageDoorId++, garageDoorControllerConfig);

                await garageDoorController.init();

                garageDoorControllers.push(garageDoorController);
            }
        }
        catch (ex) {
            this.server.log.error({ tags: [ServiceName] }, `An error occurred in initializeGarageDoorControllers: ${exMessage(ex)}`);
        }

        return garageDoorControllers;
    }
}

declare module 'fastify' {
    interface FastifyInstance {
        [ServiceName]: CarportService;
    }
}

export default fp(carportServicePlugin, {
    fastify: '5.x',
    name: ServiceName,
    dependencies: [
        ConfigPluginName
    ]
});
