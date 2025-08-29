import {
    FastifyInstance,
    FastifyPluginAsync
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
import { GarageDoorController } from './garageDoorController.js';
import { PluginName as ConfigPluginName } from '../plugins/config.js';

export const ServiceName = 'carportService';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ICarportServicePluginOptions { }

const carportServicePlugin: FastifyPluginAsync<ICarportServicePluginOptions> = async (server: FastifyInstance, _options: ICarportServicePluginOptions): Promise<void> => {
    server.log.info({ tags: [ServiceName] }, `Registering...`);

    try {
        const carportService = await CarportService.createCarportService(server);

        server.decorate(ServiceName, carportService);
    }
    catch (ex) {
        server.log.error({ tags: [ServiceName] }, `registering failed: ${exMessage(ex)}`);

        throw ex;
    }
};

class CarportService {
    public static async createCarportService(server: FastifyInstance): Promise<CarportService> {
        server.log.info({ tags: [ServiceName] }, `initializeGarageDoorControllers`);

        const garageDoorControllers: GarageDoorController[] = [];

        try {
            const garageDoorControllerConfigs = server.config.controllerConfigs;

            server.log.info({ tags: [ServiceName] }, `Garage controller configuration:\n${JSON.stringify(garageDoorControllerConfigs)}\n`);

            server.log.info({ tags: [ServiceName] }, `Creating garage controllers`);

            let garageDoorId = GarageDoorId1;
            for (const garageDoorControllerConfig of garageDoorControllerConfigs) {
                const garageDoorController = GarageDoorController.createGarageDoorController(server, garageDoorId++, garageDoorControllerConfig);

                await garageDoorController.init();

                garageDoorControllers.push(garageDoorController);
            }

            return new CarportService(server, garageDoorControllers);
        }
        catch (ex) {
            server.log.error({ tags: [ServiceName] }, `An error occurred in initializeGarageDoorControllers: ${exMessage(ex)}`);

            throw ex;
        }
    }

    private server: FastifyInstance;
    private garageDoorControllers: GarageDoorController[];

    constructor(server: FastifyInstance, garageDoorControllers: GarageDoorController[]) {
        this.server = server;
        this.garageDoorControllers = garageDoorControllers;
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
            response.statusCode = 500;
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
