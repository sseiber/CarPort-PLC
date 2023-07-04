import { service, inject } from 'spryly';
import { Server } from '@hapi/hapi';
import {
    IGarageDoorControllerConfig,
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

    private garageDoorControllerConfigs: IGarageDoorControllerConfig[];
    private garageDoorControllers: GarageDoorController[];

    public async init(): Promise<void> {
        this.server.log([ModuleName, 'info'], `CarPortService initialzation`);

        this.garageDoorControllers = [];

        try {
            this.garageDoorControllerConfigs = this.server.settings.app.carport;

            this.server.log([ModuleName, 'info'], `Garage controller configuration:\n${JSON.stringify(this.garageDoorControllerConfigs)}\n`);

            this.server.log([ModuleName, 'info'], `Creating garage controllers`);
            let garageDoorId = 0;
            for (const garageDoorControllerConfig of this.garageDoorControllerConfigs) {
                const garageDoorController = new GarageDoorController(this.server, garageDoorId++, garageDoorControllerConfig);

                await garageDoorController.init();

                this.garageDoorControllers.push(garageDoorController);
            }
        }
        catch (ex) {
            this.server.log([ModuleName, 'error'], `An error occurred initializing the libgpiod library: ${ex.message}`);
        }
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
}
