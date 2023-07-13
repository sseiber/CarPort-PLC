import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import {
    GarageDoorStatus,
    GarageDoorAction,
    ICarPortServiceRequest,
    ICarPortServiceResponse
} from '../models/carportTypes';
import { GarageDoorController } from './garageDoorController';
import { CarportOpcuaServer } from './opcuaServer';

const ModuleName = 'carportService';

@service(ModuleName)
export class CarPortService {
    @inject('$server')
    private server: Server;

    private garageDoorControllers: GarageDoorController[];
    private opcuaServer: CarportOpcuaServer;

    public async init(): Promise<void> {
        this.server.log([ModuleName, 'info'], `CarPortService initialzation`);

        try {
            // this.garageDoorControllers = await this.initializeGarageDoorControllers();

            this.opcuaServer = await this.initializeOpcuaServer();
        }
        catch (ex) {
            this.server.log([ModuleName, 'error'], `An error occurred initializing the libgpiod library: ${ex.message}`);
        }
    }

    public async stopOpcuaServer(): Promise<void> {
        if (this.opcuaServer) {
            this.server.log([ModuleName, 'info'], '☮︎ Stopping opcua server');

            await this.opcuaServer.stop();
        }

        this.server.log(['shutdown', 'info'], `⏏︎ Server stopped`);
    }

    public async control(controlRequest: ICarPortServiceRequest): Promise<ICarPortServiceResponse> {
        const response: ICarPortServiceResponse = {
            succeeded: true,
            message: 'The request succeeded',
            status: GarageDoorStatus.Unknown
        };

        this.server.log([ModuleName, 'info'], `Carport request for garageDoorId ${controlRequest.garageDoorId}, action ${controlRequest.action} was received`);

        try {
            let message;

            switch (controlRequest.action) {
                case GarageDoorAction.Actuate:
                    response.status = await this.garageDoorControllers[controlRequest.garageDoorId].actuate();
                    break;

                case GarageDoorAction.Open:
                    response.status = await this.garageDoorControllers[controlRequest.garageDoorId].open();
                    break;

                case GarageDoorAction.Close:
                    response.status = await this.garageDoorControllers[controlRequest.garageDoorId].close();
                    break;

                case GarageDoorAction.Check:
                    response.status = await this.garageDoorControllers[controlRequest.garageDoorId].check();
                    break;

                case GarageDoorAction.StartMeasurment:
                    await this.garageDoorControllers[controlRequest.garageDoorId].start();
                    response.message = `Garage door distance measurement started...`;
                    break;

                case GarageDoorAction.StopMeasurement:
                    await this.garageDoorControllers[controlRequest.garageDoorId].stop();
                    response.message = `Garage door distance measurement stopped`;
                    break;

                default:
                    message = `Carport request for garageDoorId ${controlRequest.garageDoorId}, action ${controlRequest.action} is not recognized`;
                    break;
            }

            response.message = message || `Carport request for garageDoorId ${controlRequest.garageDoorId}, action ${controlRequest.action} was processed with status ${response.status}`;

            this.server.log([ModuleName, 'info'], response.message);
        }
        catch (ex) {
            response.succeeded = false;
            response.message = `Carport request for garageDoorId ${controlRequest.garageDoorId}, action ${controlRequest.action} failed with exception: ${ex.message}`;

            this.server.log([ModuleName, 'error'], response.message);
        }

        return response;
    }

    private async initializeGarageDoorControllers(): Promise<GarageDoorController[]> {
        this.server.log([ModuleName, 'info'], `initializeGarageDoorControllers`);

        const garageDoorControllers: GarageDoorController[] = [];

        try {
            const garageDoorControllerConfigs = this.server.settings.app.carport.garageDoorControllerConfigs;

            this.server.log([ModuleName, 'info'], `Garage controller configuration:\n${JSON.stringify(garageDoorControllerConfigs)}\n`);

            this.server.log([ModuleName, 'info'], `Creating garage controllers`);
            let garageDoorId = 0;
            for (const garageDoorControllerConfig of garageDoorControllerConfigs) {
                const garageDoorController = new GarageDoorController(this.server, garageDoorId++, garageDoorControllerConfig);

                await garageDoorController.init();

                garageDoorControllers.push(garageDoorController);
            }
        }
        catch (ex) {
            this.server.log([ModuleName, 'error'], `An error occurred in initializeGarageDoorControllers: ${ex.message}`);
        }

        return garageDoorControllers;
    }

    private async initializeOpcuaServer(): Promise<CarportOpcuaServer> {
        let opcuaServer: CarportOpcuaServer;

        try {
            this.server.log([ModuleName, 'info'], `initializeOpcuaServer`);

            this.server.log([ModuleName, 'info'], `Initializing server...`);
            opcuaServer = new CarportOpcuaServer(this.server);

            await opcuaServer.start();

            this.server.log([ModuleName, 'info'], `Server started with endpoint: ${opcuaServer.getEndpoint()}`);
        }
        catch (ex) {
            this.server.log([ModuleName, 'error'], `An error occurred in initializeOpcuaServer: ${ex.message}`);
        }

        return opcuaServer;
    }
}
