import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import {
    IObserveRequest,
    IObserveResponse,
    GarageDoorStatus,
    GarageDoorAction,
    ICarPortServiceRequest,
    ICarPortServiceResponse
} from '../models/carportTypes';
import { GarageDoorController } from './garageDoorController';

const ModuleName = 'carportService';

@service(ModuleName)
export class CarPortService {
    @inject('$server')
    private server: Server;

    private garageDoorControllers: GarageDoorController[];

    public async init(): Promise<void> {
        this.server.log([ModuleName, 'info'], `CarPortService initialzation`);

        try {
            this.garageDoorControllers = await this.initializeGarageDoorControllers();
        }
        catch (ex) {
            this.server.log([ModuleName, 'error'], `An error occurred initializing the garage door controller: ${ex.message}`);
        }
    }

    public async observe(observeRequest: IObserveRequest): Promise<IObserveResponse> {
        const response: IObserveResponse = {
            succeeded: true,
            message: 'The request succeeded',
            status: 'OK'
        };

        this.server.log([ModuleName, 'info'], `Carport request for garageDoorId ${observeRequest.garageDoorId}, targets:\n${JSON.stringify(observeRequest.observeTargets, null, 4)})}`);

        try {
            let message;

            response.status = await this.garageDoorControllers[observeRequest.garageDoorId].observe(observeRequest.observeTargets);
            response.message = message || `Carport request for garageDoorId ${observeRequest.garageDoorId} was processed with status ${response.status}`;

            this.server.log([ModuleName, 'info'], response.message);
        }
        catch (ex) {
            response.succeeded = false;
            response.message = `Carport request for garageDoorId ${observeRequest.garageDoorId} failed with exception: ${ex.message}`;

            this.server.log([ModuleName, 'error'], response.message);
        }

        return response;
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
}
